import React from "react";
const API_BASE_URL = "https://ilgo.onrender.com";
import { useEffect, useState } from "react";
import MapView from "./MapView.jsx";

const initialAuth = {
  name: "",
  email: "",
  password: "",
};

const initialBookingForm = {
  serviceSlug: "",
  latitude: "16.6115",
  longitude: "82.1182",
  note: "",
};

const tokenStorageKey = "ilgo_auth_token";

export default function App() {
  const [config, setConfig] = useState(null);
  const [catalog, setCatalog] = useState({ services: [], workers: [] });
  const [workerPreview, setWorkerPreview] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(initialAuth);
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey) || "");
  const [user, setUser] = useState(null);
  const [view, setView] = useState("customer");
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [bookings, setBookings] = useState([]);
  const [activeBooking, setActiveBooking] = useState(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [workerJobs, setWorkerJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson("/api/app-config")
      .then(setConfig)
      .catch((requestError) => setError(requestError.message));

    fetchJson("/api/ilgo/bootstrap")
      .then((data) => {
        setCatalog({ services: data.services || [], workers: data.workers || [] });
        setWorkerPreview(data.workers || []);
        setSelectedWorkerId((data.workers || [])[0]?.id || "");
        setBookingForm((current) => ({
          ...current,
          serviceSlug: current.serviceSlug || (data.services || [])[0]?.slug || "",
        }));
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (!token) {
      localStorage.removeItem(tokenStorageKey);
      setUser(null);
      setBookings([]);
      setActiveBooking(null);
      return;
    }

    localStorage.setItem(tokenStorageKey, token);
    fetchJson("/api/auth/me", { headers: authHeaders(token) })
      .then(async (data) => {
        setUser(data.user);
        await loadBookings(token);
      })
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        setToken("");
      });
  }, [token]);

  useEffect(() => {
    const latitude = Number(bookingForm.latitude);
    const longitude = Number(bookingForm.longitude);
    if (!bookingForm.serviceSlug || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    fetchJson(`/api/ilgo/workers?service=${encodeURIComponent(bookingForm.serviceSlug)}&latitude=${latitude}&longitude=${longitude}`)
      .then((data) => setWorkerPreview(data.items || []))
      .catch((requestError) => setError(requestError.message));
  }, [bookingForm.latitude, bookingForm.longitude, bookingForm.serviceSlug]);

  useEffect(() => {
    if (!selectedWorkerId) return;
    loadWorkerJobs(selectedWorkerId);
  }, [selectedWorkerId]);

  useEffect(() => {
    if (!activeBooking?.id) return undefined;
    const events = new EventSource(`/api/ilgo/track/${activeBooking.id}`);
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const nextBooking = payload.booking;
      if (!nextBooking) return;
      setActiveBooking(nextBooking);
      setBookings((current) => mergeBooking(current, nextBooking));
      setWorkerJobs((current) => mergeBooking(current, nextBooking));
    };
    events.onerror = () => events.close();
    return () => events.close();
  }, [activeBooking?.id]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const data = await fetchJson(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setToken(data.token);
      setUser(data.user);
      setAuthForm(initialAuth);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadBookings(activeToken = token) {
    if (!activeToken) return;
    const data = await fetchJson("/api/ilgo/bookings", { headers: authHeaders(activeToken) });
    setBookings(data.items || []);
    setActiveBooking((current) => {
      if (!current) return data.items?.[0] || null;
      return data.items?.find((item) => item.id === current.id) || current;
    });
  }

  async function loadWorkerJobs(workerId) {
    const data = await fetchJson(`/api/ilgo/workers/${workerId}/jobs`);
    setWorkerJobs(data.items || []);
  }

  async function handleCreateBooking(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const bookingResponse = await fetchJson("/api/ilgo/bookings", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          ...bookingForm,
          latitude: Number(bookingForm.latitude),
          longitude: Number(bookingForm.longitude),
        }),
      });
      setBookings((current) => [bookingResponse.booking, ...current.filter((item) => item.id !== bookingResponse.booking.id)]);
      setActiveBooking(bookingResponse.booking);
      setView("customer");
      await loadWorkerJobs(bookingResponse.booking.workerId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePayBooking() {
    if (!activeBooking) return;
    setBusy(true);
    setError("");
    try {
      const result = await fetchJson(`/api/ilgo/bookings/${activeBooking.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: activeBooking.priceEstimate,
          tip: Math.round(activeBooking.priceEstimate * 0.08),
        }),
      });
      setActiveBooking(result.booking);
      setBookings((current) => mergeBooking(current, result.booking));
      await loadWorkerJobs(result.booking.workerId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkerAvailability(nextAvailability) {
    if (!selectedWorkerId) return;
    setBusy(true);
    try {
      const result = await fetchJson(`/api/ilgo/workers/${selectedWorkerId}/availability`, {
        method: "POST",
        body: JSON.stringify({ isAvailable: nextAvailability }),
      });
      setCatalog((current) => ({
        ...current,
        workers: current.workers.map((worker) => (worker.id === result.worker.id ? result.worker : worker)),
      }));
      setWorkerPreview((current) => current.map((worker) => (worker.id === result.worker.id ? result.worker : worker)));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkerStatus(job, status) {
    setBusy(true);
    try {
      const result = await fetchJson(`/api/ilgo/bookings/${job.id}/status`, {
        method: "POST",
        body: JSON.stringify({ workerId: selectedWorkerId, status }),
      });
      setWorkerJobs((current) => mergeBooking(current, result.booking));
      setBookings((current) => mergeBooking(current, result.booking));
      if (activeBooking?.id === result.booking.id) setActiveBooking(result.booking);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  // REMOVED: handleMoveWorker — real GPS now handles worker location updates

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setUser(null);
    setBookings([]);
    setActiveBooking(null);
  }

  const selectedWorker = catalog.workers.find((worker) => worker.id === selectedWorkerId) || null;

  return (
    <div className="app">
      {/* ── Top Nav ── */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">IlGo</span>
          <span className="brand-tag">{config?.productTagline || "Instant home services"}</span>
        </div>

        {user && (
          <nav className="nav-pills">
            {[
              { key: "customer", label: "Book" },
              { key: "worker", label: "Worker Hub" },
              { key: "deploy", label: "Deploy" },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`pill-btn ${view === key ? "pill-btn--active" : ""}`}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
            <button type="button" className="pill-btn pill-btn--ghost" onClick={handleLogout}>
              Sign out
            </button>
          </nav>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="main">
        {!user ? (
          <Landing
            authForm={authForm}
            authMode={authMode}
            busy={busy}
            error={error}
            onAuthModeChange={setAuthMode}
            onAuthFormChange={setAuthForm}
            onSubmit={handleAuthSubmit}
          />
        ) : (
          <>
            {/* Stats bar */}
            <section className="stats-bar card">
              <div className="stats-bar__welcome">
                <p className="label">Welcome back</p>
                <h2 className="stats-bar__name">{user.name}</h2>
              </div>
              {[
                { title: "Services", value: catalog.services.length, sub: "categories" },
                { title: "Workers", value: catalog.workers.length, sub: "nearby pros" },
                { title: "Bookings", value: bookings.length, sub: "your history" },
              ].map(({ title, value, sub }) => (
                <div key={title} className="stat-chip">
                  <strong>{value}</strong>
                  <span>{title}</span>
                  <p>{sub}</p>
                </div>
              ))}
            </section>

            {error && <div className="error-bar">{error}</div>}

            {view === "customer" && (
              <CustomerDashboard
                activeBooking={activeBooking}
                bookingForm={bookingForm}
                bookings={bookings}
                busy={busy}
                services={catalog.services}
                workerPreview={workerPreview}
                onBookingFormChange={setBookingForm}
                onCreateBooking={handleCreateBooking}
                onPayBooking={handlePayBooking}
                onSelectBooking={setActiveBooking}
              />
            )}

            {view === "worker" && (
              <WorkerHub
                busy={busy}
                jobs={workerJobs}
                selectedWorker={selectedWorker}
                workers={catalog.workers}
                onSelectWorker={setSelectedWorkerId}
                onToggleAvailability={handleWorkerAvailability}
                onUpdateStatus={handleWorkerStatus}
              />
            )}

            {view === "deploy" && <DeployGuide />}
          </>
        )}
      </main>
    </div>
  );
}

/* ─────────────────────────────── Landing ─────────────────────────────── */

function Landing({ authForm, authMode, busy, error, onAuthModeChange, onAuthFormChange, onSubmit }) {
  return (
    <div className="landing">
      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="eyebrow">Home services, reinvented</p>
          <h1 className="landing-h1">
            Trusted pros, <br />
            <span className="accent-text">live at your door.</span>
          </h1>
          <p className="landing-sub">
            Book a verified expert, track them in real time, and pay only when the job's done.
          </p>
          <div className="feature-tags">
            <span>⚡ Instant dispatch</span>
            <span>📍 Live tracking</span>
            <span>🔒 Secure payments</span>
          </div>
        </div>

        {/* Auth card */}
        <div className="card auth-card">
          <div className="auth-tabs">
            {["login", "register"].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`tab-btn ${authMode === mode ? "tab-btn--active" : ""}`}
                onClick={() => onAuthModeChange(mode)}
              >
                {mode === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form className="auth-form" onSubmit={onSubmit}>
            {authMode === "register" && (
              <div className="field">
                <label htmlFor="auth-name">Full name</label>
                <input
                  id="auth-name"
                  type="text"
                  placeholder="Ravi Kumar"
                  value={authForm.name}
                  onChange={(e) => updateForm(onAuthFormChange, "name", e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                placeholder="you@example.com"
                value={authForm.email}
                onChange={(e) => updateForm(onAuthFormChange, "email", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="auth-pass">Password</label>
              <input
                id="auth-pass"
                type="password"
                placeholder="••••••••"
                value={authForm.password}
                onChange={(e) => updateForm(onAuthFormChange, "password", e.target.value)}
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "Working…" : authMode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </section>

      {/* Feature grid */}
      <section className="feature-grid">
        {[
          { icon: "🗂️", title: "Customer journey", desc: "Discover services, see ranked workers, confirm a job, and track every step in real time." },
          { icon: "🧰", title: "Worker console", desc: "Toggle availability, accept jobs, simulate navigation, and mark jobs complete." },
          { icon: "🗺️", title: "Maps-ready", desc: "Provider-agnostic tracker — swap in Google Maps with a single API key." },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="card feature-card">
            <div className="feature-icon">{icon}</div>
            <h3>{title}</h3>
            <p>{desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ───────────────────────────── CustomerDashboard ───────────────────────── */

function CustomerDashboard({ activeBooking, bookingForm, bookings, busy, services, workerPreview, onBookingFormChange, onCreateBooking, onPayBooking, onSelectBooking }) {
  return (
    <div className="customer-layout">
      {/* Booking form */}
      <section className="card">
        <div className="card-header">
          <h2>Book a service</h2>
          <p>Pick what you need and IlGo dispatches the best match nearby.</p>
        </div>
        <form className="booking-form" onSubmit={onCreateBooking}>
          <div className="field">
            <label>Service</label>
            <select value={bookingForm.serviceSlug} onChange={(e) => updateForm(onBookingFormChange, "serviceSlug", e.target.value)}>
              {services.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name} — from ₹{s.basePrice}
                </option>
              ))}
            </select>
          </div>
          <div className="coord-row">
            <div className="field">
              <label>Latitude</label>
              <input type="number" step="0.0001" value={bookingForm.latitude} onChange={(e) => updateForm(onBookingFormChange, "latitude", e.target.value)} />
            </div>
            <div className="field">
              <label>Longitude</label>
              <input type="number" step="0.0001" value={bookingForm.longitude} onChange={(e) => updateForm(onBookingFormChange, "longitude", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Job note</label>
            <input type="text" placeholder="Leaking sink, fan not working, deep clean…" value={bookingForm.note} onChange={(e) => updateForm(onBookingFormChange, "note", e.target.value)} />
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "Dispatching…" : "Confirm booking"}
          </button>
        </form>
      </section>

      {/* Two-col: workers + tracker */}
      <div className="side-by-side">
        {/* Nearby workers */}
        <div className="card">
          <div className="card-header">
            <h2>Nearby workers</h2>
            <p>Ranked by distance, rating &amp; price.</p>
          </div>
          <div className="list-stack">
            {workerPreview.length === 0 && <EmptyState text="No workers found for this location and service." />}
            {workerPreview.map((w) => (
              <div key={w.id} className="worker-row">
                <div className="worker-avatar">{w.name[0]}</div>
                <div className="worker-info">
                  <strong>{w.name}</strong>
                  <span className="worker-meta">{w.skillSlug} · {w.distanceKm ?? "--"} km · ₹{w.hourlyRate}/hr</span>
                </div>
                <div className="worker-right">
                  <div className="rating-badge">★ {w.rating.toFixed(1)}</div>
                  <span className={`avail-dot ${w.isAvailable ? "avail-dot--on" : "avail-dot--off"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tracker */}
        <div className="card">
          <div className="card-header">
            <h2>Live tracker</h2>
            <p>Worker location, ETA, and payment status.</p>
          </div>
          {activeBooking ? (
            <TrackingPanel booking={activeBooking} busy={busy} onPay={onPayBooking} />
          ) : (
            <EmptyState text="Create a booking to start live tracking." />
          )}
        </div>
      </div>

      {/* Booking history */}
      <div className="card">
        <div className="card-header">
          <h2>Recent bookings</h2>
          <p>Tap a job to focus the tracker.</p>
        </div>
        {bookings.length === 0 ? (
          <EmptyState text="Your booking history will appear here." />
        ) : (
          <div className="list-stack">
            {bookings.map((b) => (
              <button key={b.id} type="button" className="booking-card" onClick={() => onSelectBooking(b)}>
                <div className="booking-card__left">
                  <span className="booking-service">{b.serviceName}</span>
                  <strong>{b.worker.name}</strong>
                  <span className="booking-note">{b.note || b.serviceDescription}</span>
                </div>
                <div className="booking-card__right">
                  <span className={`status-badge status--${b.status}`}>{b.status}</span>
                  <span className="booking-price">₹{b.priceEstimate}</span>
                  <span className="booking-eta">ETA {b.etaMinutes} min</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── TrackingPanel ──────────────────────────── */

function TrackingPanel({ booking, busy, onPay }) {
  // ✅ REAL distance + ETA calculated from live coordinates
  const distance = getDistanceKm(
    booking.workerLatitude,
    booking.workerLongitude,
    booking.customerLatitude,
    booking.customerLongitude
  );
  const eta = calculateETA(distance);

  const progress = journeyProgress(booking);
  return (
    <div className="tracking">
      {/* Meta row */}
      <div className="tracking-meta">
        {[
          { label: "Worker", val: booking.worker.name },
          { label: "ETA", val: `${eta} min` },          // ✅ real ETA
          { label: "Estimate", val: `₹${booking.priceEstimate}` },
        ].map(({ label, val }) => (
          <div key={label} className="tracking-chip">
            <span>{label}</span>
            <strong>{val}</strong>
          </div>
        ))}
        {/* ✅ Real distance chip */}
        <div className="tracking-chip">
          <span>Distance</span>
          <strong>{distance.toFixed(2)} km</strong>
        </div>
        <span className={`status-badge status--${booking.status}`}>{booking.status}</span>
      </div>

      {/* Map board */}
      <div className="map-board">
        <MapView
          workerLat={booking.workerLatitude}
          workerLng={booking.workerLongitude}
          customerLat={booking.customerLatitude}
          customerLng={booking.customerLongitude}
        />
        <div className="map-pin map-pin--worker" style={{ left: `${Math.min(progress, 82)}%` }}>
          <div className="pin-dot" />
          <span>{booking.worker.name}</span>
        </div>
        <div className="map-pin map-pin--customer" style={{ left: "86%" }}>
          <div className="pin-dot" />
          <span>You</span>
        </div>
        <div className="map-coords">
          {booking.workerLatitude.toFixed(4)}, {booking.workerLongitude.toFixed(4)}
        </div>
      </div>

      {/* Payment */}
      <div className="tracking-footer">
        {!booking.payment ? (
          <button
            type="button"
            className="primary-btn"
            disabled={busy || !["arrived", "completed"].includes(booking.status)}
            onClick={onPay}
          >
            {busy ? "Processing…" : `Pay ₹${booking.priceEstimate} + tip`}
          </button>
        ) : (
          <div className="paid-note">
            ✓ Paid ₹{booking.payment.amount} + ₹{booking.payment.tip} tip
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── WorkerHub ──────────────────────────── */

// ✅ FIXED: useEffect is now OUTSIDE the return statement (was broken before)
function WorkerHub({ busy, jobs, selectedWorker, workers, onSelectWorker, onToggleAvailability, onUpdateStatus }) {
  // ✅ Real GPS tracking — sends worker's actual device location to the server
  useEffect(() => {
    if (!selectedWorker) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        fetch("https://ilgo.onrender.com/api/ilgo/workers/" + selectedWorker.id + "/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: lat, longitude: lng }),
        }).catch((err) => console.error("Location update failed:", err));
      },
      (err) => console.error("Geolocation error:", err),
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [selectedWorker]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Worker console</h2>
        <p>Real GPS active — your device location is sent live to customers.</p>
      </div>

      <div className="worker-toolbar">
        <div className="field" style={{ flex: 1 }}>
          <label>Active worker</label>
          <select value={selectedWorker?.id || ""} onChange={(e) => onSelectWorker(e.target.value)}>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.name} — {w.skillSlug}</option>
            ))}
          </select>
        </div>

        {selectedWorker && (
          <div className="worker-status-row">
            <div className="tracking-chip">
              <span>Rating</span>
              <strong>★ {selectedWorker.rating.toFixed(1)}</strong>
            </div>
            <div className="tracking-chip">
              <span>Status</span>
              <strong>{selectedWorker.isAvailable ? "Online" : "Offline"}</strong>
            </div>
            <button
              type="button"
              className={`pill-btn ${selectedWorker.isAvailable ? "pill-btn--danger" : "pill-btn--active"}`}
              disabled={busy}
              onClick={() => onToggleAvailability(!selectedWorker.isAvailable)}
            >
              {selectedWorker.isAvailable ? "Go offline" : "Go online"}
            </button>
          </div>
        )}
      </div>

      <div className="list-stack" style={{ marginTop: 20 }}>
        {jobs.length === 0 ? (
          <EmptyState text="No jobs yet. Create a booking from the customer screen to test dispatch." />
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="job-card">
              <div className="job-card__header">
                <div>
                  <span className="booking-service">{job.serviceName}</span>
                  <strong>{job.note || "Customer request"}</strong>
                  <span className="worker-meta">
                    Customer at {job.customerLatitude.toFixed(4)}, {job.customerLongitude.toFixed(4)} · ETA {job.etaMinutes} min
                  </span>
                </div>
                <span className={`status-badge status--${job.status}`}>{job.status}</span>
              </div>
              {/* ✅ "Move closer" button removed — real GPS handles movement */}
              <div className="job-actions">
                <button type="button" className="action-btn" disabled={busy || job.status !== "requested"} onClick={() => onUpdateStatus(job, "accepted")}>Accept</button>
                <button type="button" className="action-btn action-btn--secondary" disabled={busy || !["accepted", "enroute"].includes(job.status)} onClick={() => onUpdateStatus(job, "arrived")}>Arrived</button>
                <button type="button" className="action-btn" disabled={busy || job.status !== "arrived"} onClick={() => onUpdateStatus(job, "completed")}>Complete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── DeployGuide ──────────────────────────── */

function DeployGuide() {
  const steps = [
    { n: "01", title: "Runtime", body: "Node 20+, Postgres, and a host that supports long-lived HTTP connections for the SSE tracking stream." },
    { n: "02", title: "Environment", body: "Set DATABASE_URL and AUTH_SECRET. Add OPENAI_API_KEY later only if you want AI-powered pricing or support." },
    { n: "03", title: "Start command", body: "npm install → npm run build → npm start. The server already serves the built Vite bundle." },
    { n: "04", title: "Health & routes", body: "Use /api/health for checks. Keep /api/ilgo/track/:id open; disable proxy buffering if needed." },
    { n: "05", title: "Railway / Render", body: "Railway is fastest for Postgres-backed deploys. Render works well with separate web and database services." },
    { n: "06", title: "Google Maps", body: "Add VITE_GOOGLE_MAPS_API_KEY, swap the tracker board for a Maps component, and feed live coordinates into markers." },
  ];
  return (
    <div className="card">
      <div className="card-header">
        <h2>Deploy IlGo</h2>
        <p>Exact steps to go from local build to hosted production environment.</p>
      </div>
      <div className="deploy-grid">
        {steps.map(({ n, title, body }) => (
          <div key={n} className="deploy-step">
            <span className="deploy-step__num">{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────── Shared ──────────────────────────── */

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

/* ──────────────────────────── Utilities ──────────────────────────── */

async function fetchJson(url, options = {}) {
  const fullUrl = url.startsWith("http") ? url : `https://ilgo.onrender.com${url}`;
  const response = await fetch(fullUrl, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.detail || "Request failed");
  return data;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function updateForm(setter, key, value) {
  setter((current) => ({ ...current, [key]: value }));
}

function mergeBooking(items, booking) {
  return [booking, ...items.filter((item) => item.id !== booking.id)].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

function journeyProgress(booking) {
  if (["arrived", "completed", "paid"].includes(booking.status)) return 84;
  const gap = Math.abs(booking.customerLongitude - booking.workerLongitude) + Math.abs(booking.customerLatitude - booking.workerLatitude);
  if (gap === 0) return 84;
  return Math.max(12, Math.min(76, Math.round(84 - gap * 5000)));
}

// ✅ Haversine formula — real-world distance between two GPS coordinates
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ✅ ETA based on 30 km/h average speed
function calculateETA(distanceKm) {
  const speed = 30; // km/h
  return Math.round((distanceKm / speed) * 60);
}