const crypto = require("crypto");
const { query } = require("./db");

async function getBootstrapData() {
  const [servicesResult, workersResult] = await Promise.all([
    query("SELECT id, slug, name, description, base_price FROM services_catalog ORDER BY base_price ASC"),
    query(`
      SELECT w.id, w.user_id, w.name, w.skill_slug, w.hourly_rate, w.rating, w.latitude, w.longitude, w.is_available, w.completed_jobs,
             u.mobile, u.verification_status
      FROM workers w
      LEFT JOIN users u ON u.id = w.user_id
      WHERE COALESCE(u.verification_status, 'verified') = 'verified'
      ORDER BY w.rating DESC, w.completed_jobs DESC, w.name ASC
    `),
  ]);

  return {
    services: servicesResult.rows.map(mapService),
    workers: workersResult.rows.map((worker) => mapWorker(worker, null, null)),
  };
}

async function listWorkers({ serviceSlug, latitude, longitude }) {
  const result = await query(`
    SELECT w.id, w.user_id, w.name, w.skill_slug, w.hourly_rate, w.rating, w.latitude, w.longitude, w.is_available, w.completed_jobs,
           u.mobile, u.verification_status
    FROM workers w
    LEFT JOIN users u ON u.id = w.user_id
    WHERE ($1::text IS NULL OR w.skill_slug = $1)
      AND COALESCE(u.verification_status, 'verified') = 'verified'
    ORDER BY w.is_available DESC, w.rating DESC, w.completed_jobs DESC, w.name ASC
  `, [serviceSlug || null]);

  return result.rows.map((worker) => mapWorker(worker, latitude, longitude));
}

async function createBooking({ customerId, serviceSlug, latitude, longitude, note }) {
  const [serviceResult, workersResult] = await Promise.all([
    query("SELECT * FROM services_catalog WHERE slug = $1 LIMIT 1", [serviceSlug]),
    query(`
      SELECT w.id, w.user_id, w.name, w.skill_slug, w.hourly_rate, w.rating, w.latitude, w.longitude, w.is_available, w.completed_jobs,
             u.mobile, u.verification_status
      FROM workers w
      LEFT JOIN users u ON u.id = w.user_id
      WHERE w.skill_slug = $1
        AND w.is_available = TRUE
        AND COALESCE(u.verification_status, 'verified') = 'verified'
    `, [serviceSlug]),
  ]);

  const service = serviceResult.rows[0];

  if (!service) {
    throw new Error("Requested service is not available.");
  }

  const rankedWorkers = workersResult.rows
    .map((worker) => mapWorker(worker, latitude, longitude))
    .sort((left, right) => left.matchScore - right.matchScore);

  const matchedWorker = rankedWorkers[0];

  if (!matchedWorker) {
    throw new Error("No available workers found nearby. Try again in a few minutes.");
  }

  const bookingId = `booking_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const estimate = Math.round(Number(service.base_price) + matchedWorker.hourlyRate * 0.35);
  const etaMinutes = Math.max(6, Math.round((matchedWorker.distanceKm || 1.5) * 4 + 5));

  await query(`
    INSERT INTO bookings (
      id, customer_id, worker_id, service_slug, status, note,
      customer_latitude, customer_longitude, worker_latitude, worker_longitude,
      eta_minutes, price_estimate, tracking_channel, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'requested', $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13, $14
    )
  `, [
    bookingId,
    customerId || null,
    matchedWorker.id,
    service.slug,
    (note || "").trim(),
    latitude,
    longitude,
    matchedWorker.latitude,
    matchedWorker.longitude,
    etaMinutes,
    estimate,
    `track_${bookingId}`,
    now,
    now,
  ]);

  return getBookingById(bookingId);
}

async function listBookingsForUser(userId) {
  const result = await query(`
    SELECT b.*, s.name AS service_name, s.description AS service_description, w.name AS worker_name,
           w.rating AS worker_rating, w.hourly_rate AS worker_hourly_rate
    FROM bookings b
    JOIN services_catalog s ON s.slug = b.service_slug
    JOIN workers w ON w.id = b.worker_id
    WHERE b.customer_id = $1
    ORDER BY b.updated_at DESC
  `, [userId]);

  return result.rows.map(mapBookingRow);
}

async function listWorkerJobs(workerId) {
  const result = await query(`
    SELECT b.*, s.name AS service_name, s.description AS service_description, w.name AS worker_name,
           w.rating AS worker_rating, w.hourly_rate AS worker_hourly_rate
    FROM bookings b
    JOIN services_catalog s ON s.slug = b.service_slug
    JOIN workers w ON w.id = b.worker_id
    WHERE b.worker_id = $1
    ORDER BY b.updated_at DESC
  `, [workerId]);

  return result.rows.map(mapBookingRow);
}

async function listPendingWorkers() {
  const result = await query(`
    SELECT u.id AS user_id, u.name AS user_name, u.email, u.mobile, u.verification_status, u.created_at,
           w.id AS worker_id, w.skill_slug, w.hourly_rate, w.latitude, w.longitude, w.is_available
    FROM users u
    JOIN workers w ON w.user_id = u.id
    WHERE u.role = 'worker'
      AND u.verification_status = 'pending'
    ORDER BY u.created_at ASC
  `);

  const items = [];

  for (const row of result.rows) {
    const documents = await listWorkerDocuments(row.user_id);
    items.push({
      userId: row.user_id,
      workerId: row.worker_id,
      name: row.user_name,
      email: row.email,
      mobile: row.mobile,
      skillSlug: row.skill_slug,
      hourlyRate: Number(row.hourly_rate),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      isAvailable: Boolean(row.is_available),
      verificationStatus: row.verification_status,
      createdAt: row.created_at,
      documents,
    });
  }

  return items;
}

async function listWorkerDocuments(userId) {
  const result = await query(`
    SELECT id, doc_type, file_name, mime_type, file_data, status, uploaded_at
    FROM worker_documents
    WHERE user_id = $1
    ORDER BY uploaded_at ASC
  `, [userId]);

  return result.rows.map((row) => ({
    id: row.id,
    docType: row.doc_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileData: row.file_data,
    status: row.status,
    uploadedAt: row.uploaded_at,
  }));
}

async function verifyWorker(userId) {
  const documents = await listWorkerDocuments(userId);

  if (!documents.length) {
    throw new Error("Worker cannot be verified without Aadhaar or supporting documents.");
  }

  await query(`
    UPDATE users
    SET verification_status = 'verified'
    WHERE id = $1 AND role = 'worker'
  `, [userId]);

  await query(`
    UPDATE worker_documents
    SET status = 'approved'
    WHERE user_id = $1
  `, [userId]);

  const result = await query(`
    SELECT u.id AS user_id, u.name AS user_name, u.email, u.mobile, u.verification_status, u.created_at,
           w.id AS worker_id, w.skill_slug, w.hourly_rate, w.latitude, w.longitude, w.is_available
    FROM users u
    JOIN workers w ON w.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `, [userId]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    workerId: row.worker_id,
    name: row.user_name,
    email: row.email,
    mobile: row.mobile,
    skillSlug: row.skill_slug,
    hourlyRate: Number(row.hourly_rate),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    isAvailable: Boolean(row.is_available),
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    documents: documents.map((doc) => ({ ...doc, status: "approved" })),
  };
}

async function getAdminDashboardStats() {
  const [userCounts, bookingCounts, paymentTotals, pendingDocumentCount] = await Promise.all([
    query(`
      SELECT role, verification_status, COUNT(*)::int AS count
      FROM users
      GROUP BY role, verification_status
    `),
    query(`
      SELECT status, COUNT(*)::int AS count
      FROM bookings
      GROUP BY status
    `),
    query(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_amount,
        COALESCE(SUM(tip), 0) AS total_tip
      FROM payments
      WHERE status = 'paid'
    `),
    query(`
      SELECT COUNT(*)::int AS count
      FROM worker_documents
      WHERE status = 'pending'
    `),
  ]);

  const summary = {
    customers: 0,
    verifiedWorkers: 0,
    pendingWorkers: 0,
    admins: 0,
    totalBookings: 0,
    activeBookings: 0,
    completedBookings: 0,
    paidRevenue: Number(paymentTotals.rows[0]?.total_amount || 0),
    paidTips: Number(paymentTotals.rows[0]?.total_tip || 0),
    pendingDocuments: Number(pendingDocumentCount.rows[0]?.count || 0),
  };

  for (const row of userCounts.rows) {
    if (row.role === "customer") {
      summary.customers += row.count;
    }
    if (row.role === "admin") {
      summary.admins += row.count;
    }
    if (row.role === "worker" && row.verification_status === "verified") {
      summary.verifiedWorkers += row.count;
    }
    if (row.role === "worker" && row.verification_status === "pending") {
      summary.pendingWorkers += row.count;
    }
  }

  for (const row of bookingCounts.rows) {
    summary.totalBookings += row.count;
    if (["requested", "accepted", "enroute", "arrived"].includes(row.status)) {
      summary.activeBookings += row.count;
    }
    if (["completed", "paid"].includes(row.status)) {
      summary.completedBookings += row.count;
    }
  }

  return summary;
}

async function getBookingById(bookingId) {
  const result = await query(`
    SELECT b.*, s.name AS service_name, s.description AS service_description, w.name AS worker_name,
           w.rating AS worker_rating, w.hourly_rate AS worker_hourly_rate,
           p.id AS payment_id, p.amount AS payment_amount, p.tip AS payment_tip, p.status AS payment_status
    FROM bookings b
    JOIN services_catalog s ON s.slug = b.service_slug
    JOIN workers w ON w.id = b.worker_id
    LEFT JOIN payments p ON p.booking_id = b.id
    WHERE b.id = $1
    ORDER BY p.created_at DESC NULLS LAST
    LIMIT 1
  `, [bookingId]);

  const row = result.rows[0];
  return row ? mapBookingRow(row) : null;
}

async function updateWorkerAvailability(workerId, isAvailable) {
  await query(`
    UPDATE workers
    SET is_available = $1
    WHERE id = $2
  `, [Boolean(isAvailable), workerId]);

  const result = await query(`
    SELECT w.id, w.user_id, w.name, w.skill_slug, w.hourly_rate, w.rating, w.latitude, w.longitude, w.is_available, w.completed_jobs,
           u.mobile, u.verification_status
    FROM workers w
    LEFT JOIN users u ON u.id = w.user_id
    WHERE w.id = $1
    LIMIT 1
  `, [workerId]);

  return result.rows[0] ? mapWorker(result.rows[0], null, null) : null;
}

async function updateWorkerLocation(workerId, { latitude, longitude, bookingId }) {
  await query(`
    UPDATE workers
    SET latitude = $1, longitude = $2
    WHERE id = $3
  `, [latitude, longitude, workerId]);

  if (bookingId) {
    await query(`
      UPDATE bookings
      SET worker_latitude = $1,
          worker_longitude = $2,
          status = CASE WHEN status = 'requested' THEN 'enroute' ELSE status END,
          updated_at = $3
      WHERE id = $4 AND worker_id = $5
    `, [latitude, longitude, new Date().toISOString(), bookingId, workerId]);
  }

  return getBookingById(bookingId);
}

async function updateBookingStatus(bookingId, workerId, status) {
  const nextStatus = normalizeStatus(status);
  const now = new Date().toISOString();

  await query(`
    UPDATE bookings
    SET status = $1, updated_at = $2
    WHERE id = $3 AND worker_id = $4
  `, [nextStatus, now, bookingId, workerId]);

  if (nextStatus === "completed") {
    await query(`
      UPDATE workers
      SET completed_jobs = completed_jobs + 1, is_available = TRUE
      WHERE id = $1
    `, [workerId]);
  }

  return getBookingById(bookingId);
}

async function createPayment({ bookingId, amount, tip }) {
  const paymentId = `payment_${crypto.randomUUID()}`;
  const value = Number(amount || 0);
  const tipValue = Number(tip || 0);

  await query(`
    INSERT INTO payments (id, booking_id, amount, tip, status, created_at)
    VALUES ($1, $2, $3, $4, 'paid', $5)
  `, [paymentId, bookingId, value, tipValue, new Date().toISOString()]);

  await query(`
    UPDATE bookings
    SET status = CASE WHEN status = 'completed' THEN status ELSE 'paid' END,
        updated_at = $1
    WHERE id = $2
  `, [new Date().toISOString(), bookingId]);

  return getBookingById(bookingId);
}

function mapService(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePrice: Number(row.base_price),
  };
}

function mapWorker(row, latitude, longitude) {
  const workerLatitude = Number(row.latitude);
  const workerLongitude = Number(row.longitude);
  const distanceKm =
    typeof latitude === "number" && typeof longitude === "number"
      ? haversineKm(latitude, longitude, workerLatitude, workerLongitude)
      : null;
  const hourlyRate = Number(row.hourly_rate);
  const rating = Number(row.rating);
  const matchScore =
    distanceKm === null
      ? null
      : Number((distanceKm * 0.6 + (1 / Math.max(rating, 1)) * 12 + hourlyRate * 0.1).toFixed(2));

  return {
    id: row.id,
    userId: row.user_id || null,
    name: row.name,
    skillSlug: row.skill_slug,
    hourlyRate,
    rating,
    mobile: row.mobile || null,
    verificationStatus: row.verification_status || "verified",
    latitude: workerLatitude,
    longitude: workerLongitude,
    isAvailable: Boolean(row.is_available),
    completedJobs: Number(row.completed_jobs || 0),
    distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
    matchScore,
  };
}

function mapBookingRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    workerId: row.worker_id,
    serviceSlug: row.service_slug,
    serviceName: row.service_name,
    serviceDescription: row.service_description,
    status: row.status,
    note: row.note || "",
    customerLatitude: Number(row.customer_latitude),
    customerLongitude: Number(row.customer_longitude),
    workerLatitude: Number(row.worker_latitude),
    workerLongitude: Number(row.worker_longitude),
    etaMinutes: Number(row.eta_minutes),
    priceEstimate: Number(row.price_estimate),
    worker: {
      id: row.worker_id,
      name: row.worker_name,
      rating: Number(row.worker_rating),
      hourlyRate: Number(row.worker_hourly_rate),
    },
    payment: row.payment_id
      ? {
          id: row.payment_id,
          amount: Number(row.payment_amount),
          tip: Number(row.payment_tip),
          status: row.payment_status,
        }
      : null,
    trackingChannel: row.tracking_channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["requested", "accepted", "enroute", "arrived", "completed", "paid"].includes(value)) {
    return value;
  }
  throw new Error("Unsupported booking status.");
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const angle =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

module.exports = {
  createBooking,
  createPayment,
  getAdminDashboardStats,
  getBookingById,
  getBootstrapData,
  listBookingsForUser,
  listPendingWorkers,
  listWorkerDocuments,
  listWorkerJobs,
  listWorkers,
  updateBookingStatus,
  updateWorkerAvailability,
  updateWorkerLocation,
  verifyWorker,
};
