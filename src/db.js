const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required. Railway Postgres provides this automatically.");
    }

    const sslEnabled = shouldUseSSL(connectionString);

    pool = new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    });
  }

  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  const client = await getPool().connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS practice_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        mode TEXT NOT NULL,
        mode_label TEXT NOT NULL,
        learner_level TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        topic TEXT NOT NULL,
        goal TEXT NOT NULL,
        evaluation_engine TEXT NOT NULL,
        session_kind TEXT NOT NULL DEFAULT 'practice',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS practice_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        role TEXT NOT NULL,
        response_text TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        filler_count INTEGER NOT NULL DEFAULT 0,
        clarity INTEGER,
        structure INTEGER,
        relevance INTEGER,
        confidence INTEGER,
        conciseness INTEGER,
        overall INTEGER,
        summary TEXT,
        strengths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        improvements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        follow_up_prompt TEXT,
        engine TEXT,
        warning TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_id ON practice_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_practice_turns_session_id ON practice_turns(session_id);
      CREATE INDEX IF NOT EXISTS idx_practice_turns_created_at ON practice_turns(created_at);
    `);
  } finally {
    client.release();
  }
}

function shouldUseSSL(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get("sslmode") === "disable") {
      return false;
    }
  } catch (error) {
    // Ignore parse failures and fall back to hosted defaults.
  }

  return process.env.PGSSL !== "disable";
}

module.exports = {
  getPool,
  initDb,
  query,
  withTransaction,
};
