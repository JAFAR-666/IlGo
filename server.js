const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createSession, evaluateTurnHeuristic } = require("./src/coach");
const { initDb } = require("./src/db");
const { evaluateTurnWithOpenAI, DEFAULT_MODEL } = require("./src/openaiCoach");
const { registerUser, loginUser, createToken, getUserFromToken } = require("./src/auth");
const { createStoredSession, getAnalyticsForUser, getHistoryForUser, savePracticeResult } = require("./src/dataStore");
const { connectRealtimeVoice, REALTIME_MODEL } = require("./src/realtime");

const PORT = process.env.PORT || 3000;
const sessions = new Map();

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
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

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        evaluationEngine: openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic",
        realtimeEngine: process.env.OPENAI_API_KEY ? `openai:${REALTIME_MODEL}` : "disabled",
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/app-config") {
      sendJson(res, 200, {
        brand: "Verbix",
        evaluationEngine: openAIEnabled ? `openai:${DEFAULT_MODEL}` : "heuristic",
        realtimeAvailable: Boolean(process.env.OPENAI_API_KEY),
        realtimeEngine: process.env.OPENAI_API_KEY ? `openai:${REALTIME_MODEL}` : "disabled",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/register") {
      const payload = await readBody(req);
      const user = await registerUser(payload);
      const token = await createToken(user);
      sendJson(res, 200, { user, token });
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/login") {
      const payload = await readBody(req);
      const user = await loginUser(payload);
      const token = await createToken(user);
      sendJson(res, 200, { user, token });
      return;
    }

    if (req.method === "GET" && req.url === "/api/auth/me") {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, { user });
      return;
    }

    if (req.method === "GET" && req.url === "/api/history") {
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

    if (req.method === "GET" && req.url === "/api/analytics") {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, await getAnalyticsForUser(user.id));
      return;
    }

    if (req.method === "POST" && req.url === "/api/session/start") {
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

    if (req.method === "POST" && req.url === "/api/session/respond") {
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

    if (req.method === "POST" && req.url === "/api/realtime/connect") {
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

    if (req.method === "POST" && req.url === "/api/realtime/score") {
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
    sendJson(res, 500, {
      error: "Server error",
      detail: error.message,
    });
  }
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Verbix running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
