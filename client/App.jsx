import { useEffect, useState } from "react";

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
    fetchJson("/api/auth/me", {
      headers: authHeaders(token),
    })
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

    if (!bookingForm.serviceSlug || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    fetchJson(`/api/ilgo/workers?service=${encodeURIComponent(bookingForm.serviceSlug)}&latitude=${latitude}&longitude=${longitude}`)
      .then((data) => setWorkerPreview(data.items || []))
      .catch((requestError) => setError(requestError.message));
  }, [bookingForm.latitude, bookingForm.longitude, bookingForm.serviceSlug]);

  useEffect(() => {
    if (!selectedWorkerId) {
      return;
    }

    loadWorkerJobs(selectedWorkerId);
  }, [selectedWorkerId]);

  useEffect(() => {
    if (!activeBooking?.id) {
      return undefined;
    }

    const events = new EventSource(`/api/ilgo/track/${activeBooking.id}`);
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const nextBooking = payload.booking;

      if (!nextBooking) {
        return;
      }

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
      const payload =
        authMode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;
      const data = await fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

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
    if (!activeToken) {
      return;
    }

    const data = await fetchJson("/api/ilgo/bookings", {
      headers: authHeaders(activeToken),
    });
    setBookings(data.items || []);
    setActiveBooking((current) => {
      if (!current) {
        return data.items?.[0] || null;
      }
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
    if (!activeBooking) {
      return;
    }

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
    if (!selectedWorkerId) {
      return;
    }

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
        body: JSON.stringify({
          workerId: selectedWorkerId,
          status,
        }),
      });

      setWorkerJobs((current) => mergeBooking(current, result.booking));
      setBookings((current) => mergeBooking(current, result.booking));
      if (activeBooking?.id === result.booking.id) {
        setActiveBooking(result.booking);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveWorker(job) {
    const nextPoint = moveToward(job.workerLatitude, job.workerLongitude, job.customerLatitude, job.customerLongitude, 0.35);

    setBusy(true);

    try {
      const result = await fetchJson(`/api/ilgo/workers/${selectedWorkerId}/location`, {
        method: "POST",
        body: JSON.stringify({
          bookingId: job.id,
          latitude: nextPoint.latitude,
          longitude: nextPoint.longitude,
        }),
      });

      if (result.booking) {
        setWorkerJobs((current) => mergeBooking(current, result.booking));
        setBookings((current) => mergeBooking(current, result.booking));
        if (activeBooking?.id === result.booking.id) {
          setActiveBooking(result.booking);
        }
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setUser(null);
    setBookings([]);
    setActiveBooking(null);
  }

  const selectedWorker = catalog.workers.find((worker) => worker.id === selectedWorkerId) || null;

  return (
    <main className="ilgo-shell">
      <header className="topbar">
        <div>
          <p className="brand-mark">IlGo</p>
          <p className="brand-subtitle">{config?.productTagline || "Instant home services with live worker tracking"}</p>
        </div>
        {user ? (
          <div className="topbar-actions">
            <button type="button" className={view === "customer" ? "nav-chip active" : "nav-chip"} onClick={() => setView("customer")}>Customer</button>
            <button type="button" className={view === "worker" ? "nav-chip active" : "nav-chip"} onClick={() => setView("worker")}>Worker Hub</button>
            <button type="button" className={view === "deploy" ? "nav-chip active" : "nav-chip"} onClick={() => setView("deploy")}>Deploy</button>
            <button type="button" className="ghost-button" onClick={handleLogout}>Logout</button>
          </div>
        ) : null}
      </header>

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
          <section className="hero-banner panel">
            <div>
              <p className="eyebrow">Service marketplace MVP</p>
              <h1>{user.name}, IlGo is ready to dispatch.</h1>
              <p className="hero-copy">
                Book an expert, watch the worker move in real time, and use the worker console to simulate the full job lifecycle before deployment.
              </p>
            </div>
            <div className="roadmap">
              <MetricCard title="Services" score={catalog.services.length} description="Bookable categories" />
              <MetricCard title="Workers" score={catalog.workers.length} description="Seeded nearby pros" />
              <MetricCard title="Bookings" score={bookings.length} description="Customer history" />
            </div>
          </section>

          {error ? <p className="error-banner">{error}</p> : null}

          {view === "customer" ? (
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
          ) : null}

          {view === "worker" ? (
            <WorkerHub
              busy={busy}
              jobs={workerJobs}
              selectedWorker={selectedWorker}
              workers={catalog.workers}
              onMoveWorker={handleMoveWorker}
              onSelectWorker={setSelectedWorkerId}
              onToggleAvailability={handleWorkerAvailability}
              onUpdateStatus={handleWorkerStatus}
            />
          ) : null}

          {view === "deploy" ? <DeployGuide /> : null}
        </>
      )}
    </main>
  );
}

function Landing({ authForm, authMode, busy, error, onAuthModeChange, onAuthFormChange, onSubmit }) {
  return (
    <>
      <section className="landing-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">Real product direction</p>
          <h1>IlGo connects households with trusted local pros and shows every move live.</h1>
          <p className="hero-copy">
            This web MVP mirrors the customer and worker app flow: discovery, matching, booking, tracking, payment, and deployment preparation.
          </p>
          <div className="hero-pills">
            <span>Customer booking journey</span>
            <span>Worker dispatch console</span>
            <span>Live tracking stream</span>
          </div>
        </div>

        <div className="panel auth-card">
          <div className="auth-tabs">
            <button type="button" className={authMode === "login" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthModeChange("login")}>Login</button>
            <button type="button" className={authMode === "register" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthModeChange("register")}>Create account</button>
          </div>
          <form className="response-form" onSubmit={onSubmit}>
            {authMode === "register" ? (
              <label>
                Name
                <input type="text" value={authForm.name} onChange={(event) => updateForm(onAuthFormChange, "name", event.target.value)} />
              </label>
            ) : null}
            <label>
              Email
              <input type="email" value={authForm.email} onChange={(event) => updateForm(onAuthFormChange, "email", event.target.value)} />
            </label>
            <label>
              Password
              <input type="password" value={authForm.password} onChange={(event) => updateForm(onAuthFormChange, "password", event.target.value)} />
            </label>
            {error ? <p className="error-banner">{error}</p> : null}
            <button type="submit" disabled={busy}>{busy ? "Working..." : authMode === "login" ? "Enter IlGo" : "Launch IlGo account"}</button>
          </form>
        </div>
      </section>

      <section className="feature-grid">
        <div className="panel info-panel"><h3>Customer app flow</h3><p>Choose a service, see nearby workers ranked by distance, rating, and price, then confirm a job.</p></div>
        <div className="panel info-panel"><h3>Worker app flow</h3><p>Toggle availability, accept jobs, move toward the customer, arrive, and complete the service.</p></div>
        <div className="panel info-panel"><h3>Maps-ready tracking</h3><p>The current tracker is provider-agnostic and ready to swap to Google Maps when an API key is added.</p></div>
      </section>
    </>
  );
}

function CustomerDashboard({
  activeBooking,
  bookingForm,
  bookings,
  busy,
  services,
  workerPreview,
  onBookingFormChange,
  onCreateBooking,
  onPayBooking,
  onSelectBooking,
}) {
  return (
    <>
      <section className="panel controls">
        <div className="panel-header">
          <h2>Book a Service</h2>
          <p>Pick the service, confirm your coordinates, and IlGo will dispatch the best match.</p>
        </div>

        <form className="form-grid" onSubmit={onCreateBooking}>
          <label>
            Service
            <select value={bookingForm.serviceSlug} onChange={(event) => updateForm(onBookingFormChange, "serviceSlug", event.target.value)}>
              {services.map((service) => (
                <option key={service.slug} value={service.slug}>
                  {service.name} from Rs. {service.basePrice}
                </option>
              ))}
            </select>
          </label>
          <label>
            Latitude
            <input type="number" step="0.0001" value={bookingForm.latitude} onChange={(event) => updateForm(onBookingFormChange, "latitude", event.target.value)} />
          </label>
          <label>
            Longitude
            <input type="number" step="0.0001" value={bookingForm.longitude} onChange={(event) => updateForm(onBookingFormChange, "longitude", event.target.value)} />
          </label>
          <label className="full-width">
            Job note
            <input type="text" value={bookingForm.note} placeholder="Leaking sink, fan not spinning, deep clean before move-in..." onChange={(event) => updateForm(onBookingFormChange, "note", event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Dispatching..." : "Confirm IlGo booking"}</button>
        </form>
      </section>

      <section className="workspace">
        <article className="panel">
          <div className="panel-header">
            <h2>Nearby Workers</h2>
            <p>Ranked with a weighted score across distance, rating, and price.</p>
          </div>
          <div className="list-stack">
            {workerPreview.map((worker) => (
              <div key={worker.id} className="history-card">
                <div className="history-header">
                  <div>
                    <p className="eyebrow small">{worker.skillSlug}</p>
                    <h3>{worker.name}</h3>
                  </div>
                  <div className="score-pill">{worker.rating.toFixed(1)} star</div>
                </div>
                <p className="history-meta">
                  {worker.distanceKm ?? "--"} km away | Rs. {worker.hourlyRate}/hr | score {worker.matchScore ?? "--"}
                </p>
                <p className="history-summary">{worker.isAvailable ? "Available now" : "Currently busy"}. Completed jobs: {worker.completedJobs}.</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Tracking Screen</h2>
            <p>Live worker location, ETA, payment status, and a maps-ready visual board.</p>
          </div>

          {activeBooking ? (
            <TrackingPanel booking={activeBooking} busy={busy} onPay={onPayBooking} />
          ) : (
            <EmptyState text="Create a booking to open the tracking screen." />
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent Bookings</h2>
          <p>Tap any job to focus the live tracker.</p>
        </div>
        {bookings.length ? (
          <div className="list-stack">
            {bookings.map((booking) => (
              <button key={booking.id} type="button" className="history-card selectable-card" onClick={() => onSelectBooking(booking)}>
                <div className="history-header">
                  <div>
                    <p className="eyebrow small">{booking.serviceName}</p>
                    <h3>{booking.worker.name}</h3>
                  </div>
                  <div className={`status-pill ${booking.status}`}>{booking.status}</div>
                </div>
                <p className="history-meta">ETA {booking.etaMinutes} min | Rs. {booking.priceEstimate}</p>
                <p className="history-summary">{booking.note || booking.serviceDescription}</p>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState text="Your booking history will appear here after the first request." />
        )}
      </section>
    </>
  );
}

function TrackingPanel({ booking, busy, onPay }) {
  const progress = journeyProgress(booking);

  return (
    <div className="tracking-stack">
      <div className="brief-meta">
        <MetaCard label="Worker" value={booking.worker.name} />
        <MetaCard label="Status" value={booking.status} />
        <MetaCard label="ETA" value={`${booking.etaMinutes} min`} />
        <MetaCard label="Estimate" value={`Rs. ${booking.priceEstimate}`} />
      </div>

      <div className="map-board">
        <div className="route-line" style={{ width: `${Math.max(progress, 8)}%` }} />
        <div className="map-pin customer" style={{ left: "84%" }}>
          <span>Customer</span>
        </div>
        <div className="map-pin worker" style={{ left: `${Math.min(progress, 84)}%` }}>
          <span>{booking.worker.name}</span>
        </div>
      </div>

      <div className="tracking-copy">
        <p>
          {booking.worker.name} is handling your {booking.serviceName.toLowerCase()} request.
          Coordinates: {booking.workerLatitude.toFixed(4)}, {booking.workerLongitude.toFixed(4)}.
        </p>
        <p>
          Google Maps handoff: replace this board with a JS Maps component and feed these same live coordinates into the route markers.
        </p>
      </div>

      <div className="voice-controls">
        <div className={`status-pill ${booking.status}`}>{booking.status}</div>
        {!booking.payment ? (
          <button type="button" disabled={busy || !["arrived", "completed"].includes(booking.status)} onClick={onPay}>
            {busy ? "Processing..." : `Pay Rs. ${booking.priceEstimate} + tip`}
          </button>
        ) : (
          <div className="payment-note">Paid Rs. {booking.payment.amount} + Rs. {booking.payment.tip} tip</div>
        )}
      </div>
    </div>
  );
}

function WorkerHub({ busy, jobs, selectedWorker, workers, onMoveWorker, onSelectWorker, onToggleAvailability, onUpdateStatus }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Worker App Console</h2>
        <p>Simulate the worker experience: availability, incoming jobs, navigation, and completion.</p>
      </div>

      <div className="worker-toolbar">
        <label>
          Active worker
          <select value={selectedWorker?.id || ""} onChange={(event) => onSelectWorker(event.target.value)}>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name} | {worker.skillSlug}
              </option>
            ))}
          </select>
        </label>

        {selectedWorker ? (
          <div className="worker-actions">
            <MetaCard label="Rating" value={selectedWorker.rating.toFixed(1)} />
            <MetaCard label="Availability" value={selectedWorker.isAvailable ? "Online" : "Offline"} />
            <button type="button" className="secondary-button" disabled={busy} onClick={() => onToggleAvailability(!selectedWorker.isAvailable)}>
              {selectedWorker.isAvailable ? "Go offline" : "Go online"}
            </button>
          </div>
        ) : null}
      </div>

      {jobs.length ? (
        <div className="list-stack">
          {jobs.map((job) => (
            <article key={job.id} className="history-card">
              <div className="history-header">
                <div>
                  <p className="eyebrow small">{job.serviceName}</p>
                  <h3>{job.note || "Customer request"}</h3>
                </div>
                <div className={`status-pill ${job.status}`}>{job.status}</div>
              </div>
              <p className="history-meta">
                Customer at {job.customerLatitude.toFixed(4)}, {job.customerLongitude.toFixed(4)} | ETA {job.etaMinutes} min
              </p>
              <div className="worker-job-actions">
                <button type="button" disabled={busy || job.status !== "requested"} onClick={() => onUpdateStatus(job, "accepted")}>Accept</button>
                <button type="button" className="secondary-button" disabled={busy || !["accepted", "enroute"].includes(job.status)} onClick={() => onMoveWorker(job)}>Move closer</button>
                <button type="button" className="secondary-button" disabled={busy || !["accepted", "enroute"].includes(job.status)} onClick={() => onUpdateStatus(job, "arrived")}>Arrived</button>
                <button type="button" disabled={busy || job.status !== "arrived"} onClick={() => onUpdateStatus(job, "completed")}>Complete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No jobs yet for this worker. Create a booking from the customer screen to test dispatch." />
      )}
    </section>
  );
}

function DeployGuide() {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Deploy IlGo Step by Step</h2>
        <p>These are the exact pieces to push this MVP from local build to hosted environment.</p>
      </div>

      <div className="deploy-grid">
        <div className="info-panel panel">
          <h3>1. Runtime setup</h3>
          <p>Use Node 20+, Postgres, and a platform that supports long-lived HTTP connections for the tracking stream.</p>
        </div>
        <div className="info-panel panel">
          <h3>2. Environment</h3>
          <p>Set `DATABASE_URL` and `AUTH_SECRET`. Add `OPENAI_API_KEY` later only if you want AI-powered support or pricing.</p>
        </div>
        <div className="info-panel panel">
          <h3>3. Start command</h3>
          <p>`npm install`, `npm run build`, then `npm start`. The server already serves the built Vite bundle.</p>
        </div>
        <div className="info-panel panel">
          <h3>4. Health and routes</h3>
          <p>Use `/api/health` for checks, keep `/api/ilgo/track/:bookingId` open for tracking, and ensure proxy buffering is disabled if needed.</p>
        </div>
        <div className="info-panel panel">
          <h3>5. Railway or Render</h3>
          <p>Railway is fastest for Postgres-backed deployment. Render also works well if you need separate web and database services.</p>
        </div>
        <div className="info-panel panel">
          <h3>6. Google Maps upgrade</h3>
          <p>Add `VITE_GOOGLE_MAPS_API_KEY`, replace the tracker board with a Maps component, and pass live worker/customer coordinates into markers and routes.</p>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function MetaCard({ label, value }) {
  return (
    <div className="meta-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCard({ title, score, description }) {
  return (
    <div className="metric-card">
      <span>{title}</span>
      <strong>{score}</strong>
      <p>{description}</p>
    </div>
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.detail || "Request failed");
  }

  return data;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function updateForm(setter, key, value) {
  setter((current) => ({
    ...current,
    [key]: value,
  }));
}

function mergeBooking(items, booking) {
  const nextItems = [booking, ...items.filter((item) => item.id !== booking.id)];
  return nextItems.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function moveToward(startLatitude, startLongitude, targetLatitude, targetLongitude, ratio) {
  return {
    latitude: Number((startLatitude + (targetLatitude - startLatitude) * ratio).toFixed(6)),
    longitude: Number((startLongitude + (targetLongitude - startLongitude) * ratio).toFixed(6)),
  };
}

function journeyProgress(booking) {
  const distanceGap = Math.abs(booking.customerLongitude - booking.workerLongitude) + Math.abs(booking.customerLatitude - booking.workerLatitude);

  if (booking.status === "arrived" || booking.status === "completed" || booking.status === "paid") {
    return 84;
  }

  if (distanceGap === 0) {
    return 84;
  }

  return Math.max(12, Math.min(76, Math.round(84 - distanceGap * 5000)));
}
