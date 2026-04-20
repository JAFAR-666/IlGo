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

      CREATE TABLE IF NOT EXISTS services_catalog (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        base_price NUMERIC(10, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        skill_slug TEXT NOT NULL REFERENCES services_catalog(slug) ON DELETE CASCADE,
        hourly_rate NUMERIC(10, 2) NOT NULL,
        rating NUMERIC(3, 2) NOT NULL,
        latitude NUMERIC(9, 6) NOT NULL,
        longitude NUMERIC(9, 6) NOT NULL,
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        completed_jobs INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        service_slug TEXT NOT NULL REFERENCES services_catalog(slug) ON DELETE RESTRICT,
        status TEXT NOT NULL,
        note TEXT,
        customer_latitude NUMERIC(9, 6) NOT NULL,
        customer_longitude NUMERIC(9, 6) NOT NULL,
        worker_latitude NUMERIC(9, 6) NOT NULL,
        worker_longitude NUMERIC(9, 6) NOT NULL,
        eta_minutes INTEGER NOT NULL,
        price_estimate NUMERIC(10, 2) NOT NULL,
        tracking_channel TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        tip NUMERIC(10, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workers_skill_slug ON workers(skill_slug);
      CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_worker_id ON bookings(worker_id);
      CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
    `);

    await client.query(`
      INSERT INTO services_catalog (id, slug, name, description, base_price)
      VALUES
        ('service_electrician', 'electrician', 'Electrician', 'Wiring fixes, fan installation, switchboard repair, and urgent electrical help.', 399),
        ('service_plumber', 'plumber', 'Plumber', 'Leak repair, tap fitting, drain support, and kitchen or bathroom plumbing.', 349),
        ('service_cleaner', 'cleaner', 'Home Cleaner', 'Deep cleaning for kitchens, living rooms, and move-in or move-out resets.', 299)
      ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          base_price = EXCLUDED.base_price
    `);

    await client.query(`
      INSERT INTO workers (id, name, skill_slug, hourly_rate, rating, latitude, longitude, is_available, completed_jobs)
      VALUES
        ('worker_aarav', 'Aarav Singh', 'electrician', 520, 4.8, 16.614800, 82.114900, TRUE, 128),
        ('worker_naina', 'Naina Reddy', 'plumber', 470, 4.9, 16.606100, 82.128400, TRUE, 143),
        ('worker_kiran', 'Kiran Das', 'cleaner', 320, 4.7, 16.621300, 82.105500, TRUE, 97),
        ('worker_isha', 'Isha Varma', 'electrician', 490, 4.6, 16.598200, 82.120700, TRUE, 88),
        ('worker_rehan', 'Rehan Ali', 'plumber', 430, 4.5, 16.612600, 82.101900, FALSE, 74)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          skill_slug = EXCLUDED.skill_slug,
          hourly_rate = EXCLUDED.hourly_rate,
          rating = EXCLUDED.rating,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          is_available = EXCLUDED.is_available,
          completed_jobs = EXCLUDED.completed_jobs
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
