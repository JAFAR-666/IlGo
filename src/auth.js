const crypto = require("crypto");
const { query } = require("./db");

const AUTH_SECRET = process.env.AUTH_SECRET || "verbix-dev-secret";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);

async function registerUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);

  if (!name?.trim() || !normalizedEmail || !password?.trim()) {
    throw new Error("Name, email, and password are required.");
  }

  const existingUser = await query("SELECT id FROM users WHERE email = $1 LIMIT 1", [normalizedEmail]);

  if (existingUser.rowCount > 0) {
    throw new Error("An account with that email already exists.");
  }

  const user = {
    id: `user_${crypto.randomUUID()}`,
    name: name.trim(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [user.id, user.name, user.email, user.password_hash, user.created_at]);

  return sanitizeUser(user);
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const result = await query("SELECT * FROM users WHERE email = $1 LIMIT 1", [normalizedEmail]);
  const user = result.rows[0];

  if (!user || !verifyPassword(password || "", user.password_hash)) {
    throw new Error("Invalid email or password.");
  }

  return sanitizeUser(user);
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

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at || user.createdAt,
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

module.exports = {
  registerUser,
  loginUser,
  createToken,
  getUserFromToken,
};
