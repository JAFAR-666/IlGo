const crypto = require("crypto");
const { query, withTransaction } = require("./db");

const AUTH_SECRET = process.env.AUTH_SECRET || "verbix-dev-secret";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

async function registerUser({
  name,
  email,
  mobile,
  role = "customer",
  serviceSlug,
  hourlyRate,
  latitude,
  longitude,
  documents = [],
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = normalizeMobile(mobile);
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "admin") {
    throw new Error("Admin accounts are managed separately.");
  }

  if (!name?.trim() || !normalizedEmail || !normalizedMobile) {
    throw new Error("Name, email, and mobile number are required.");
  }

  if (normalizedRole === "worker" && (!serviceSlug || !hourlyRate || latitude === undefined || longitude === undefined)) {
    throw new Error("Worker registration needs service, rate, and location details.");
  }

  if (normalizedRole === "worker" && !documents.length) {
    throw new Error("Workers must upload Aadhaar or supporting documents before verification.");
  }

  const existingUser = await query(
    "SELECT id FROM users WHERE email = $1 AND role = $2 LIMIT 1",
    [normalizedEmail, normalizedRole]
  );

  if (existingUser.rowCount > 0) {
    throw new Error("An account with that email already exists for this role.");
  }

  const userId = `user_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const verificationStatus = normalizedRole === "worker" ? "pending" : "verified";
  const workerProfileId = normalizedRole === "worker" ? `worker_${crypto.randomUUID()}` : null;

  const createdUser = await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO users (
        id, name, email, mobile, role, verification_status, worker_profile_id, password_hash, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
    `, [
      userId,
      name.trim(),
      normalizedEmail,
      normalizedMobile,
      normalizedRole,
      verificationStatus,
      workerProfileId,
      hashPassword(normalizedMobile),
      now,
    ]);

    if (normalizedRole === "worker") {
      await client.query(`
        INSERT INTO workers (
          id, user_id, name, skill_slug, hourly_rate, rating, latitude, longitude, is_available, completed_jobs
        ) VALUES (
          $1, $2, $3, $4, $5, 5.0, $6, $7, FALSE, 0
        )
      `, [
        workerProfileId,
        userId,
        name.trim(),
        serviceSlug,
        Number(hourlyRate),
        Number(latitude),
        Number(longitude),
      ]);

      for (const document of documents) {
        await client.query(`
          INSERT INTO worker_documents (
            id, user_id, worker_id, doc_type, file_name, mime_type, file_data, status, uploaded_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, 'pending', $8
          )
        `, [
          `doc_${crypto.randomUUID()}`,
          userId,
          workerProfileId,
          document.docType || "aadhaar",
          document.fileName || "document",
          document.mimeType || "application/octet-stream",
          document.fileData || "",
          now,
        ]);
      }
    }

    const result = await client.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
    return result.rows[0];
  });

  return sanitizeUser(createdUser);
}

async function loginUser({ role = "customer", email, password }) {
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);

  if (normalizedRole !== "admin") {
    throw new Error("Customers and workers must use OTP login.");
  }

  if (!password?.trim()) {
    throw new Error("Admin password is required.");
  }

  const result = await query(
    "SELECT * FROM users WHERE email = $1 AND role = 'admin' LIMIT 1",
    [normalizedEmail]
  );
  const user = result.rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error("Invalid admin credentials.");
  }

  return sanitizeUser(user);
}

async function requestOtp({ role = "customer", email, mobile }) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "admin") {
    throw new Error("Admin login uses email and password.");
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = normalizeMobile(mobile);

  if (!normalizedEmail || !normalizedMobile) {
    throw new Error("Email and mobile number are required.");
  }

  const result = await query(
    "SELECT * FROM users WHERE email = $1 AND mobile = $2 AND role = $3 LIMIT 1",
    [normalizedEmail, normalizedMobile, normalizedRole]
  );
  const user = result.rows[0];

  if (!user) {
    throw new Error("No account found for that email and mobile number.");
  }

  if (normalizedRole === "worker" && user.verification_status !== "verified") {
    throw new Error("Worker verification is still pending. Please wait for admin approval.");
  }

  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  const otpId = `otp_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await query(
    "UPDATE auth_otps SET consumed_at = $1 WHERE user_id = $2 AND role = $3 AND consumed_at IS NULL",
    [new Date().toISOString(), user.id, normalizedRole]
  );

  await query(`
    INSERT INTO auth_otps (id, user_id, role, email, mobile, otp_hash, created_at, expires_at, consumed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
  `, [
    otpId,
    user.id,
    normalizedRole,
    normalizedEmail,
    normalizedMobile,
    hashOtp(otpCode),
    new Date().toISOString(),
    expiresAt,
  ]);

  return {
    otpId,
    expiresAt,
    demoOtp: otpCode,
  };
}

async function verifyOtpAndLogin({ role = "customer", email, mobile, otp }) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "admin") {
    throw new Error("Admin login does not use OTP.");
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = normalizeMobile(mobile);

  if (!normalizedEmail || !normalizedMobile || !String(otp || "").trim()) {
    throw new Error("Email, mobile number, and OTP are required.");
  }

  const result = await query(`
    SELECT auth_otps.*, users.*
    FROM auth_otps
    JOIN users ON users.id = auth_otps.user_id
    WHERE auth_otps.email = $1
      AND auth_otps.mobile = $2
      AND auth_otps.role = $3
      AND auth_otps.consumed_at IS NULL
      AND auth_otps.expires_at > $4
    ORDER BY auth_otps.created_at DESC
    LIMIT 1
  `, [normalizedEmail, normalizedMobile, normalizedRole, new Date().toISOString()]);

  const row = result.rows[0];

  if (!row || hashOtp(String(otp).trim()) !== row.otp_hash) {
    throw new Error("Invalid or expired OTP.");
  }

  if (normalizedRole === "worker" && row.verification_status !== "verified") {
    throw new Error("Worker verification is still pending. Please wait for admin approval.");
  }

  await query(
    "UPDATE auth_otps SET consumed_at = $1 WHERE id = $2",
    [new Date().toISOString(), row.id]
  );

  const user = sanitizeUser(row);
  const token = await createToken(user);
  return { user, token };
}

async function createToken(user) {
  const rawToken = crypto.randomBytes(48).toString("base64url");
  const sessionId = `auth_${crypto.randomUUID()}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(`
    INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
    VALUES ($1, $2, $3, $4, $5, NULL)
  `, [sessionId, user.id, hashToken(rawToken), createdAt.toISOString(), expiresAt.toISOString()]);

  return rawToken;
}

async function getUserFromToken(token) {
  if (!token) {
    return null;
  }

  try {
    const hashedToken = hashToken(token);
    const result = await query(`
      SELECT users.*
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.token_hash = $1
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.expires_at > $2
      LIMIT 1
    `, [hashedToken, new Date().toISOString()]);
    const row = result.rows[0];

    if (!row) {
      return null;
    }
    return sanitizeUser(row);
  } catch (error) {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || "").split(":");

  if (!salt || !originalHash) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(originalHash, "hex"));
}

function hashToken(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("hex");
}

function hashOtp(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role || "customer",
    verificationStatus: user.verification_status || "verified",
    workerProfileId: user.worker_profile_id || null,
    createdAt: user.created_at || user.createdAt,
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeMobile(mobile) {
  return String(mobile || "").replace(/\D/g, "").trim();
}

function normalizeRole(role) {
  const value = String(role || "customer").trim().toLowerCase();
  if (!["admin", "customer", "worker"].includes(value)) {
    throw new Error("Unsupported role.");
  }
  return value;
}

module.exports = {
  registerUser,
  loginUser,
  requestOtp,
  verifyOtpAndLogin,
  createToken,
  getUserFromToken,
};
