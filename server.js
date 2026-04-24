const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createSession, evaluateTurnHeuristic } = require("./src/coach");
const { initDb } = require("./src/db");
const { evaluateTurnWithOpenAI, DEFAULT_MODEL } = require("./src/openaiCoach");
const { registerUser, loginUser, requestOtp, verifyOtpAndLogin, createToken, getUserFromToken } = require("./src/auth");
const { createStoredSession, getAnalyticsForUser, getHistoryForUser, savePracticeResult } = require("./src/dataStore");
const { connectRealtimeVoice, REALTIME_MODEL } = require("./src/realtime");
const {
  createBooking,
  createPayment,
  getAdminDashboardStats,
  getBookingById,
  getBootstrapData,
  listBookingsForUser,
  listPendingWorkers,
  listWorkerJobs,
  listWorkers,
  updateBookingStatus,
  updateWorkerAvailability,
  updateWorkerLocation,
  verifyWorker,
} = require("./src/ilgoStore");

const PORT = process.env.PORT || 3000;
const sessions = new Map();
const trackingStreams = new Map();

const clientBuildDir = path.join(__dirname, "dist");
const openAIEnabled = Boolean(process.env.OPENAI_API_KEY);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readTextBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function getAuthenticatedUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return getUserFromToken(token);
}

function requireRole(user, allowedRoles) {
  if (!user) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  if (!allowedRoles.includes(user.role)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
}

async function scoreTranscript(session, responseText, source = "realtime") {
  let result;

  if (openAIEnabled) {
    try {
      result = await evaluateTurnWithOpenAI(session, responseText || "");
    } catch (error) {
      result = evaluateTurnHeuristic(session, responseText || "");
      result.turn.engine = "heuristic-fallback";
      result.turn.warning = `OpenAI evaluation failed: ${error.message}`;
      result.session.coachPrompt = result.turn.feedback.followUpPrompt;
    }
  } else {
    result = evaluateTurnHeuristic(session, responseText || "");
    result.turn.engine = "heuristic";
  }

  result.turn.source = source;
  result.session.evaluationEngine = openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic";
  sessions.set(result.session.id, result.session);

  if (result.session.userId) {
    await savePracticeResult(result.session, result.turn);
  }

  return result;
}

function addTrackingStream(bookingId, res) {
  const current = trackingStreams.get(bookingId) || new Set();
  current.add(res);
  trackingStreams.set(bookingId, current);
}

function removeTrackingStream(bookingId, res) {
  const current = trackingStreams.get(bookingId);

  if (!current) {
    return;
  }

  current.delete(res);

  if (current.size === 0) {
    trackingStreams.delete(bookingId);
  }
}

function broadcastTracking(bookingId, payload) {
  const current = trackingStreams.get(bookingId);

  if (!current?.size) {
    return;
  }

  const body = `data: ${JSON.stringify(payload)}\n\n`;

  for (const stream of current) {
    stream.write(body);
  }
}

function serveStatic(req, res) {
  const rawPath = String(req.url || "").split("?")[0];
  const requestedPath = rawPath === "/" ? "/index.html" : rawPath;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(clientBuildDir, safePath);

  if (!filePath.startsWith(clientBuildDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        fs.readFile(path.join(clientBuildDir, "index.html"), (indexError, indexContent) => {
          if (indexError) {
            sendJson(res, 404, { error: "Frontend build not found. Run npm install and npm run build." });
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(indexContent);
        });
        return;
      }

      sendJson(res, 500, { error: "Failed to load resource" });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    withCors(res);
    const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const pathname = requestUrl.pathname;
    const parts = pathname.split("/").filter(Boolean);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        evaluationEngine: openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic",
        realtimeEngine: process.env.OPENAI_API_KEY ? `openai:${REALTIME_MODEL}` : "disabled",
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/app-config") {
      sendJson(res, 200, {
        brand: "IlGo",
        productTagline: "Instant home services with live worker tracking",
        deploymentTarget: "Railway or Render",
        adminEmail: process.env.ADMIN_EMAIL || "admin@ilgo.app",
        otpMode: "demo",
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/ilgo/bootstrap") {
      sendJson(res, 200, {
        brand: "IlGo",
        ...(await getBootstrapData()),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/ilgo/workers") {
      const serviceSlug = requestUrl.searchParams.get("service");
      const latitude = parseCoordinate(requestUrl.searchParams.get("latitude"));
      const longitude = parseCoordinate(requestUrl.searchParams.get("longitude"));

      sendJson(res, 200, {
        items: await listWorkers({ serviceSlug, latitude, longitude }),
      });
      return;
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "workers" && parts[4] === "jobs") {
      sendJson(res, 200, {
        items: await listWorkerJobs(parts[3]),
      });
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "workers" && parts[4] === "availability") {
      const payload = await readBody(req);
      sendJson(res, 200, {
        worker: await updateWorkerAvailability(parts[3], payload.isAvailable),
      });
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "workers" && parts[4] === "location") {
      const payload = await readBody(req);
      const booking = await updateWorkerLocation(parts[3], {
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        bookingId: payload.bookingId,
      });

      if (booking) {
        broadcastTracking(booking.id, { type: "location", booking });
      }

      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const payload = await readBody(req);
      const user = await registerUser(payload);
      const token = user.role === "worker" ? "" : await createToken(user);
      sendJson(res, 200, { user, token });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const payload = await readBody(req);
      const user = await loginUser(payload);
      const token = await createToken(user);
      sendJson(res, 200, { user, token });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/request-otp") {
      const payload = await readBody(req);
      sendJson(res, 200, await requestOtp(payload));
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/verify-otp") {
      const payload = await readBody(req);
      sendJson(res, 200, await verifyOtpAndLogin(payload));
      return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, { user });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/workers/pending") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["admin"]);
      sendJson(res, 200, { items: await listPendingWorkers() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/dashboard") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["admin"]);
      sendJson(res, 200, { stats: await getAdminDashboardStats() });
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "workers" && parts[4] === "verify") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["admin"]);
      sendJson(res, 200, { worker: await verifyWorker(parts[3]) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/history") {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, {
        items: await getHistoryForUser(user.id),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/analytics") {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, await getAnalyticsForUser(user.id));
      return;
    }

    if (req.method === "GET" && pathname === "/api/ilgo/bookings") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["customer", "admin"]);

      sendJson(res, 200, {
        items: await listBookingsForUser(user.id),
      });
      return;
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "bookings" && parts.length === 4) {
      const booking = await getBookingById(parts[3]);

      if (!booking) {
        sendJson(res, 404, { error: "Booking not found" });
        return;
      }

      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "POST" && pathname === "/api/ilgo/bookings") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["customer"]);

      const payload = await readBody(req);
      const booking = await createBooking({
        customerId: user.id,
        serviceSlug: payload.serviceSlug,
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        note: payload.note,
      });

      broadcastTracking(booking.id, { type: "booking-created", booking });
      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "bookings" && parts[4] === "status") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["worker", "admin"]);
      const payload = await readBody(req);
      const booking = await updateBookingStatus(parts[3], user.role === "admin" ? payload.workerId : user.workerProfileId, payload.status);
      broadcastTracking(parts[3], { type: "status", booking });
      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "bookings" && parts[4] === "pay") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["customer", "admin"]);
      const payload = await readBody(req);
      const booking = await createPayment({
        bookingId: parts[3],
        amount: payload.amount,
        tip: payload.tip,
      });
      broadcastTracking(parts[3], { type: "payment", booking });
      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "ilgo" && parts[2] === "track" && parts[3]) {
      const booking = await getBookingById(parts[3]);

      if (!booking) {
        sendJson(res, 404, { error: "Booking not found" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "snapshot", booking })}\n\n`);
      addTrackingStream(parts[3], res);
      req.on("close", () => removeTrackingStream(parts[3], res));
      return;
    }

    if (req.method === "GET" && pathname === "/api/worker/jobs") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["worker"]);
      sendJson(res, 200, { items: await listWorkerJobs(user.workerProfileId) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/worker/availability") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["worker"]);
      const payload = await readBody(req);
      sendJson(res, 200, {
        worker: await updateWorkerAvailability(user.workerProfileId, payload.isAvailable),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/worker/location") {
      const user = await getAuthenticatedUser(req);
      requireRole(user, ["worker"]);
      const payload = await readBody(req);
      const booking = await updateWorkerLocation(user.workerProfileId, {
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        bookingId: payload.bookingId,
      });
      if (booking) {
        broadcastTracking(booking.id, { type: "location", booking });
      }
      sendJson(res, 200, { booking });
      return;
    }

    if (req.method === "POST" && pathname === "/api/session/start") {
      const payload = await readBody(req);
      const session = createSession(payload);
      session.evaluationEngine = openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic";
      session.userId = (await getAuthenticatedUser(req))?.id || null;
      session.sessionKind = payload.sessionKind || "practice";
      await createStoredSession(session);
      sessions.set(session.id, session);
      sendJson(res, 200, session);
      return;
    }

    if (req.method === "POST" && pathname === "/api/session/respond") {
      const payload = await readBody(req);
      const session = sessions.get(payload.sessionId);

      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return;
      }

      const result = await scoreTranscript(session, payload.responseText || "", payload.source || "practice");
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/realtime/connect") {
      const user = await getAuthenticatedUser(req);
      const payload = await readBody(req);
      const realtimeSession = createSession({
        mode: payload.mode,
        learnerLevel: payload.learnerLevel,
        durationMinutes: 10,
        topic: payload.topic,
      });
      realtimeSession.id = payload.sessionId || `session_${crypto.randomUUID().slice(0, 8)}`;
      realtimeSession.userId = user?.id || null;
      realtimeSession.sessionKind = "realtime";
      realtimeSession.evaluationEngine = openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic";
      await createStoredSession(realtimeSession);
      sessions.set(realtimeSession.id, realtimeSession);
      const answer = await connectRealtimeVoice({
        sdp: payload.sdp || "",
        mode: payload.mode,
        topic: payload.topic,
        learnerLevel: payload.learnerLevel,
        userName: user?.name || payload.userName,
      });
      sendJson(res, 200, {
        ...answer,
        sessionId: realtimeSession.id,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/realtime/score") {
      const user = await getAuthenticatedUser(req);
      const payload = await readBody(req);
      const session = sessions.get(payload.sessionId);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (!session) {
        sendJson(res, 404, { error: "Realtime session not found" });
        return;
      }

      const result = await scoreTranscript(session, payload.responseText || "", "realtime");
      sendJson(res, 200, {
        score: result.turn.analysis.scores,
        feedback: result.turn.feedback,
        createdAt: result.turn.createdAt,
      });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: "Unknown route" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Server error",
      detail: error.message,
    });
  }
});

function parseCoordinate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`IlGo running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
