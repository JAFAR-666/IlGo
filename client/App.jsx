import { useEffect, useState } from "react";

const initialAuth = {
  name: "",
  email: "",
  mobile: "",
  password: "",
  otp: "",
  serviceSlug: "",
  hourlyRate: "450",
  latitude: "16.6115",
  longitude: "82.1182",
  documents: [],
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
  const [authRole, setAuthRole] = useState("customer");
  const [authForm, setAuthForm] = useState(initialAuth);
  const [otpSession, setOtpSession] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey) || "");
  const [user, setUser] = useState(null);
  const [view, setView] = useState("customer");
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [bookings, setBookings] = useState([]);
  const [activeBooking, setActiveBooking] = useState(null);
  const [workerJobs, setWorkerJobs] = useState([]);
  const [workerProfile, setWorkerProfile] = useState(null);
  const [pendingWorkers, setPendingWorkers] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchJson("/api/app-config")
      .then(setConfig)
      .catch((requestError) => setError(requestError.message));

    fetchJson("/api/ilgo/bootstrap")
      .then((data) => {
        setCatalog({ services: data.services || [], workers: data.workers || [] });
        setWorkerPreview(data.workers || []);
        setBookingForm((current) => ({
          ...current,
          serviceSlug: current.serviceSlug || (data.services || [])[0]?.slug || "",
        }));
        setAuthForm((current) => ({
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
      setPendingWorkers([]);
      setWorkerJobs([]);
      setWorkerProfile(null);
      setAdminStats(null);
      return;
    }

    localStorage.setItem(tokenStorageKey, token);
    fetchJson("/api/auth/me", { headers: authHeaders(token) })
      .then(async (data) => {
        setUser(data.user);
        setView(defaultViewForRole(data.user.role));

        if (data.user.role === "customer") {
          await loadBookings(token);
        }

        if (data.user.role === "worker") {
          await loadWorkerJobs(token);
          const profile = catalog.workers.find((worker) => worker.id === data.user.workerProfileId) || null;
          setWorkerProfile(profile);
        }

        if (data.user.role === "admin") {
          await Promise.all([loadPendingWorkers(token), loadAdminStats(token)]);
        }
      })
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        setToken("");
      });
  }, [token, catalog.workers]);

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

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const data = await fetchJson("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          role: authRole,
          name: authForm.name,
          email: authForm.email,
          mobile: authForm.mobile,
          serviceSlug: authRole === "worker" ? authForm.serviceSlug : undefined,
          hourlyRate: authRole === "worker" ? Number(authForm.hourlyRate) : undefined,
          latitude: authRole === "worker" ? Number(authForm.latitude) : undefined,
          longitude: authRole === "worker" ? Number(authForm.longitude) : undefined,
          documents: authRole === "worker" ? authForm.documents : [],
        }),
      });

      setAuthForm((current) => ({ ...initialAuth, serviceSlug: current.serviceSlug }));

      if (data.user.role === "worker") {
        setAuthMode("login");
        setNotice("Worker registration submitted with documents. Wait for admin verification, then request OTP to log in.");
        return;
      }

      setNotice("Customer account created. Request OTP to log in with your phone number.");
      setAuthMode("login");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestOtp(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const result = await fetchJson("/api/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({
          role: authRole,
          email: authForm.email,
          mobile: authForm.mobile,
        }),
      });
      setOtpSession(result);
      setNotice(`OTP sent. Demo OTP for now: ${result.demoOtp}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const result = await fetchJson("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          role: authRole,
          email: authForm.email,
          mobile: authForm.mobile,
          otp: authForm.otp,
        }),
      });

      setToken(result.token);
      setUser(result.user);
      setOtpSession(null);
      setAuthForm((current) => ({ ...initialAuth, serviceSlug: current.serviceSlug }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const data = await fetchJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          role: "admin",
          email: authForm.email,
          password: authForm.password,
        }),
      });
      setToken(data.token);
      setUser(data.user);
      setAuthForm((current) => ({ ...initialAuth, serviceSlug: current.serviceSlug }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadBookings(activeToken = token) {
    const data = await fetchJson("/api/ilgo/bookings", {
      headers: authHeaders(activeToken),
    });
    setBookings(data.items || []);
    setActiveBooking((current) => current ? data.items?.find((item) => item.id === current.id) || current : data.items?.[0] || null);
  }

  async function loadWorkerJobs(activeToken = token) {
    const data = await fetchJson("/api/worker/jobs", {
      headers: authHeaders(activeToken),
    });
    setWorkerJobs(data.items || []);
  }

  async function loadPendingWorkers(activeToken = token) {
    const data = await fetchJson("/api/admin/workers/pending", {
      headers: authHeaders(activeToken),
    });
    setPendingWorkers(data.items || []);
  }

  async function loadAdminStats(activeToken = token) {
    const data = await fetchJson("/api/admin/dashboard", {
      headers: authHeaders(activeToken),
    });
    setAdminStats(data.stats || null);
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

      setBookings((current) => mergeBooking(current, bookingResponse.booking));
      setActiveBooking(bookingResponse.booking);
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
        headers: authHeaders(token),
        body: JSON.stringify({
          amount: activeBooking.priceEstimate,
          tip: Math.round(activeBooking.priceEstimate * 0.08),
        }),
      });
      setActiveBooking(result.booking);
      setBookings((current) => mergeBooking(current, result.booking));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkerAvailability(nextAvailability) {
    setBusy(true);
    setError("");

    try {
      const result = await fetchJson("/api/worker/availability", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ isAvailable: nextAvailability }),
      });
      setWorkerProfile(result.worker);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkerStatus(job, status) {
    setBusy(true);
    setError("");

    try {
      const result = await fetchJson(`/api/ilgo/bookings/${job.id}/status`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ status }),
      });
      setWorkerJobs((current) => mergeBooking(current, result.booking));
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
    setError("");

    try {
      const result = await fetchJson("/api/worker/location", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          bookingId: job.id,
          latitude: nextPoint.latitude,
          longitude: nextPoint.longitude,
        }),
      });

      if (result.booking) {
        setWorkerJobs((current) => mergeBooking(current, result.booking));
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

  async function handleVerifyWorker(userId) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await fetchJson(`/api/admin/workers/${userId}/verify`, {
        method: "POST",
        headers: authHeaders(token),
      });
      await Promise.all([loadPendingWorkers(token), loadAdminStats(token)]);
      setNotice("Worker verified successfully.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDocumentSelection(files) {
    try {
      const docs = await Promise.all(Array.from(files || []).map(readFileAsDocument));
      setAuthForm((current) => ({
        ...current,
        documents: docs,
      }));
      setNotice(`${docs.length} document(s) attached for worker verification.`);
    } catch (readError) {
      setError(readError.message);
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setUser(null);
    setNotice("");
    setError("");
    setOtpSession(null);
  }

  const visibleViews = viewsForRole(user?.role);

  return (
    <main className="ilgo-shell">
      <header className="topbar">
        <div>
          <p className="brand-mark">IlGo</p>
          <p className="brand-subtitle">{config?.productTagline || "Instant home services with live worker tracking"}</p>
        </div>
        {user ? (
          <div className="topbar-actions">
            {visibleViews.map((item) => (
              <button key={item.key} type="button" className={view === item.key ? "nav-chip active" : "nav-chip"} onClick={() => setView(item.key)}>
                {item.label}
              </button>
            ))}
            <button type="button" className="ghost-button" onClick={handleLogout}>Logout</button>
          </div>
        ) : null}
      </header>

      {!user ? (
        <AuthLanding
          adminEmail={config?.adminEmail}
          authForm={authForm}
          authMode={authMode}
          authRole={authRole}
          busy={busy}
          error={error}
          notice={notice}
          otpSession={otpSession}
          services={catalog.services}
          onAuthFormChange={setAuthForm}
          onAuthModeChange={setAuthMode}
          onAuthRoleChange={setAuthRole}
          onAdminLogin={handleAdminLogin}
          onRegisterSubmit={handleRegisterSubmit}
          onRequestOtp={handleRequestOtp}
          onVerifyOtp={handleVerifyOtp}
          onDocumentSelection={handleDocumentSelection}
        />
      ) : (
        <>
          <section className="hero-banner panel">
            <div>
              <p className="eyebrow">Verified marketplace operations</p>
              <h1>{user.name}, your {user.role} workspace is ready.</h1>
              <p className="hero-copy">
                Customers and workers log in with OTP, workers upload Aadhaar and supporting documents, and admins monitor stats plus verification from one dashboard.
              </p>
            </div>
            <div className="roadmap">
              <MetricCard title="Role" score={user.role} description="Current signed-in identity" />
              <MetricCard title="Verification" score={user.verificationStatus} description="Account approval state" />
              <MetricCard title="OTP" score={config?.otpMode || "demo"} description="Phone verification mode" />
            </div>
          </section>

          {notice ? <p className="notice-banner">{notice}</p> : null}
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
              workerProfile={workerProfile}
              onMoveWorker={handleMoveWorker}
              onToggleAvailability={handleWorkerAvailability}
              onUpdateStatus={handleWorkerStatus}
            />
          ) : null}

          {view === "admin" ? (
            <AdminDashboard busy={busy} pendingWorkers={pendingWorkers} stats={adminStats} onVerify={handleVerifyWorker} />
          ) : null}

          {view === "deploy" ? <DeployGuide /> : null}
        </>
      )}
    </main>
  );
}

function AuthLanding({
  adminEmail,
  authForm,
  authMode,
  authRole,
  busy,
  error,
  notice,
  otpSession,
  services,
  onAuthFormChange,
  onAuthModeChange,
  onAuthRoleChange,
  onAdminLogin,
  onRegisterSubmit,
  onRequestOtp,
  onVerifyOtp,
  onDocumentSelection,
}) {
  const isAdmin = authRole === "admin";

  return (
    <section className="landing-hero">
      <div className="hero-copy-block">
        <p className="eyebrow">Next auth layer</p>
        <h1>OTP login, document upload, and admin operations are now part of the product flow.</h1>
        <p className="hero-copy">
          Customers and workers sign in with phone OTP. Workers attach Aadhaar or supporting documents during registration. Admin reviews uploads and approves access from a stats-first dashboard.
        </p>
        <div className="hero-pills">
          <span>OTP phone verification</span>
          <span>Aadhaar upload</span>
          <span>Admin stats dashboard</span>
        </div>
      </div>

      <div className="panel auth-card">
        <div className="auth-tabs">
          <button type="button" className={authMode === "login" ? "nav-chip active" : "nav-chip"} onClick={() => setModeWithReset("login", onAuthModeChange, onAuthFormChange)}>
            Login
          </button>
          <button type="button" className={authMode === "register" ? "nav-chip active" : "nav-chip"} onClick={() => setModeWithReset("register", onAuthModeChange, onAuthFormChange)}>
            Register
          </button>
        </div>

        <div className="auth-tabs">
          <button type="button" className={authRole === "customer" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthRoleChange("customer")}>
            Customer
          </button>
          <button type="button" className={authRole === "worker" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthRoleChange("worker")}>
            Worker
          </button>
          <button type="button" className={authRole === "admin" ? "nav-chip active" : "nav-chip"} onClick={() => { onAuthRoleChange("admin"); onAuthModeChange("login"); }}>
            Admin
          </button>
        </div>

        {notice ? <p className="notice-banner">{notice}</p> : null}
        {error ? <p className="error-banner">{error}</p> : null}

        {isAdmin ? (
          <form className="response-form" onSubmit={onAdminLogin}>
            <label>
              Admin email
              <input type="email" value={authForm.email} placeholder={adminEmail || "admin@ilgo.app"} onChange={(event) => updateForm(onAuthFormChange, "email", event.target.value)} />
            </label>
            <label>
              Password
              <input type="password" value={authForm.password} onChange={(event) => updateForm(onAuthFormChange, "password", event.target.value)} />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Working..." : "Login as admin"}</button>
          </form>
        ) : authMode === "register" ? (
          <form className="response-form" onSubmit={onRegisterSubmit}>
            <label>
              Name
              <input type="text" value={authForm.name} onChange={(event) => updateForm(onAuthFormChange, "name", event.target.value)} />
            </label>
            <label>
              Email
              <input type="email" value={authForm.email} onChange={(event) => updateForm(onAuthFormChange, "email", event.target.value)} />
            </label>
            <label>
              Mobile number
              <input type="tel" value={authForm.mobile} onChange={(event) => updateForm(onAuthFormChange, "mobile", event.target.value)} />
            </label>

            {authRole === "worker" ? (
              <>
                <label>
                  Skill
                  <select value={authForm.serviceSlug} onChange={(event) => updateForm(onAuthFormChange, "serviceSlug", event.target.value)}>
                    {services.map((service) => (
                      <option key={service.slug} value={service.slug}>{service.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Hourly rate
                  <input type="number" min="100" value={authForm.hourlyRate} onChange={(event) => updateForm(onAuthFormChange, "hourlyRate", event.target.value)} />
                </label>
                <label>
                  Latitude
                  <input type="number" step="0.0001" value={authForm.latitude} onChange={(event) => updateForm(onAuthFormChange, "latitude", event.target.value)} />
                </label>
                <label>
                  Longitude
                  <input type="number" step="0.0001" value={authForm.longitude} onChange={(event) => updateForm(onAuthFormChange, "longitude", event.target.value)} />
                </label>
                <label className="full-width">
                  Aadhaar / document upload
                  <input type="file" multiple accept=".png,.jpg,.jpeg,.pdf" onChange={(event) => onDocumentSelection(event.target.files)} />
                </label>
                {authForm.documents.length ? (
                  <div className="list-stack compact-list">
                    {authForm.documents.map((document) => (
                      <div key={document.fileName} className="meta-card">
                        <span>{document.docType}</span>
                        <strong>{document.fileName}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            <button type="submit" disabled={busy}>{busy ? "Working..." : `Register ${authRole}`}</button>
          </form>
        ) : (
          <div className="response-form">
            <form className="response-form" onSubmit={onRequestOtp}>
              <label>
                Email
                <input type="email" value={authForm.email} onChange={(event) => updateForm(onAuthFormChange, "email", event.target.value)} />
              </label>
              <label>
                Mobile number
                <input type="tel" value={authForm.mobile} onChange={(event) => updateForm(onAuthFormChange, "mobile", event.target.value)} />
              </label>
              <button type="submit" disabled={busy}>{busy ? "Sending..." : "Request OTP"}</button>
            </form>

            {otpSession ? (
              <form className="response-form otp-panel" onSubmit={onVerifyOtp}>
                <label>
                  Enter OTP
                  <input type="text" value={authForm.otp} onChange={(event) => updateForm(onAuthFormChange, "otp", event.target.value)} />
                </label>
                <p className="inline-note">OTP valid until {new Date(otpSession.expiresAt).toLocaleTimeString()}.</p>
                <button type="submit" disabled={busy}>{busy ? "Verifying..." : "Verify OTP and login"}</button>
              </form>
            ) : null}
          </div>
        )}
      </div>
    </section>
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
          <h2>Customer Booking</h2>
          <p>OTP-verified customers can create service requests and track assigned workers live.</p>
        </div>
        <form className="form-grid" onSubmit={onCreateBooking}>
          <label>
            Service
            <select value={bookingForm.serviceSlug} onChange={(event) => updateForm(onBookingFormChange, "serviceSlug", event.target.value)}>
              {services.map((service) => (
                <option key={service.slug} value={service.slug}>{service.name}</option>
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
            <input type="text" value={bookingForm.note} onChange={(event) => updateForm(onBookingFormChange, "note", event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Dispatching..." : "Book now"}</button>
        </form>
      </section>

      <section className="workspace">
        <article className="panel">
          <div className="panel-header">
            <h2>Verified Workers</h2>
            <p>Only workers with approved documents and admin verification appear here.</p>
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
                <p className="history-meta">{worker.distanceKm ?? "--"} km away | Rs. {worker.hourlyRate}/hr | {worker.verificationStatus}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Tracking</h2>
            <p>OTP login handles identity, then tracking stays live over the booking stream.</p>
          </div>
          {activeBooking ? <TrackingPanel booking={activeBooking} busy={busy} onPay={onPayBooking} /> : <EmptyState text="Create a booking to start live tracking." />}
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Your Bookings</h2>
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
              </button>
            ))}
          </div>
        ) : <EmptyState text="No customer bookings yet." />}
      </section>
    </>
  );
}

function WorkerHub({ busy, jobs, workerProfile, onMoveWorker, onToggleAvailability, onUpdateStatus }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Worker Dashboard</h2>
        <p>Workers use OTP login after admin approves their uploaded Aadhaar/documents.</p>
      </div>
      {workerProfile ? (
        <div className="worker-actions">
          <MetaCard label="Skill" value={workerProfile.skillSlug} />
          <MetaCard label="Availability" value={workerProfile.isAvailable ? "Online" : "Offline"} />
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onToggleAvailability(!workerProfile.isAvailable)}>
            {workerProfile.isAvailable ? "Go offline" : "Go online"}
          </button>
        </div>
      ) : null}

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
              <p className="history-meta">Customer at {job.customerLatitude.toFixed(4)}, {job.customerLongitude.toFixed(4)}</p>
              <div className="worker-job-actions">
                <button type="button" disabled={busy || job.status !== "requested"} onClick={() => onUpdateStatus(job, "accepted")}>Accept</button>
                <button type="button" className="secondary-button" disabled={busy || !["accepted", "enroute"].includes(job.status)} onClick={() => onMoveWorker(job)}>Move closer</button>
                <button type="button" className="secondary-button" disabled={busy || !["accepted", "enroute"].includes(job.status)} onClick={() => onUpdateStatus(job, "arrived")}>Arrived</button>
                <button type="button" disabled={busy || job.status !== "arrived"} onClick={() => onUpdateStatus(job, "completed")}>Complete</button>
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState text="No active jobs yet. Go online after approval to receive requests." />}
    </section>
  );
}

function AdminDashboard({ busy, pendingWorkers, stats, onVerify }) {
  return (
    <section className="response-form">
      <section className="panel">
        <div className="panel-header">
          <h2>Admin Stats</h2>
          <p>Operational snapshot across users, approvals, bookings, and payments.</p>
        </div>
        {stats ? (
          <div className="brief-meta">
            <MetricCard title="Customers" score={stats.customers} description="Registered customers" />
            <MetricCard title="Verified Workers" score={stats.verifiedWorkers} description="Approved worker accounts" />
            <MetricCard title="Pending Workers" score={stats.pendingWorkers} description="Awaiting admin approval" />
            <MetricCard title="Bookings" score={stats.totalBookings} description="All created bookings" />
            <MetricCard title="Active Jobs" score={stats.activeBookings} description="Open or in-progress jobs" />
            <MetricCard title="Revenue" score={`Rs. ${stats.paidRevenue}`} description={`Tips Rs. ${stats.paidTips}`} />
          </div>
        ) : (
          <EmptyState text="Admin stats will appear after the dashboard loads." />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Verification Queue</h2>
          <p>Review uploaded Aadhaar/documents and approve the worker when everything looks right.</p>
        </div>
        {pendingWorkers.length ? (
          <div className="list-stack">
            {pendingWorkers.map((worker) => (
              <article key={worker.userId} className="history-card">
                <div className="history-header">
                  <div>
                    <p className="eyebrow small">{worker.skillSlug}</p>
                    <h3>{worker.name}</h3>
                  </div>
                  <div className="status-pill requested">{worker.verificationStatus}</div>
                </div>
                <p className="history-meta">{worker.email} | {worker.mobile}</p>
                <p className="history-summary">Rs. {worker.hourlyRate}/hr | {worker.latitude.toFixed(4)}, {worker.longitude.toFixed(4)}</p>
                <div className="document-grid">
                  {worker.documents.map((document) => (
                    <article key={document.id} className="meta-card document-card">
                      <span>{document.docType}</span>
                      <strong>{document.fileName}</strong>
                      <a href={document.fileData} target="_blank" rel="noreferrer">Open document</a>
                    </article>
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={() => onVerify(worker.userId)}>
                  {busy ? "Working..." : "Verify worker"}
                </button>
              </article>
            ))}
          </div>
        ) : <EmptyState text="No pending workers right now." />}
      </section>
    </section>
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
        <div className="map-pin customer" style={{ left: "84%" }}><span>Customer</span></div>
        <div className="map-pin worker" style={{ left: `${Math.min(progress, 84)}%` }}><span>{booking.worker.name}</span></div>
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

function DeployGuide() {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Deploy</h2>
        <p>Current OTP mode is demo-only. Swap SMS delivery later without changing the frontend flow.</p>
      </div>
      <div className="deploy-grid">
        <div className="panel info-panel"><h3>OTP</h3><p>Replace the demo OTP response with Twilio, MSG91, or another SMS provider.</p></div>
        <div className="panel info-panel"><h3>Documents</h3><p>Move document storage from data URLs to cloud object storage before production scale.</p></div>
        <div className="panel info-panel"><h3>Admin</h3><p>Protect admin credentials in env vars and keep audit logs for approvals.</p></div>
      </div>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function MetaCard({ label, value }) {
  return <div className="meta-card"><span>{label}</span><strong>{value}</strong></div>;
}

function MetricCard({ title, score, description }) {
  return <div className="metric-card"><span>{title}</span><strong>{score}</strong><p>{description}</p></div>;
}

function viewsForRole(role) {
  if (role === "admin") {
    return [{ key: "admin", label: "Admin" }, { key: "deploy", label: "Deploy" }];
  }
  if (role === "worker") {
    return [{ key: "worker", label: "Worker" }, { key: "deploy", label: "Deploy" }];
  }
  return [{ key: "customer", label: "Customer" }, { key: "deploy", label: "Deploy" }];
}

function defaultViewForRole(role) {
  return role === "admin" ? "admin" : role === "worker" ? "worker" : "customer";
}

function setModeWithReset(mode, onAuthModeChange, onAuthFormChange) {
  onAuthModeChange(mode);
  onAuthFormChange((current) => ({ ...current, otp: "" }));
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
  setter((current) => ({ ...current, [key]: value }));
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
  if (["arrived", "completed", "paid"].includes(booking.status) || distanceGap === 0) {
    return 84;
  }
  return Math.max(12, Math.min(76, Math.round(84 - distanceGap * 5000)));
}

function readFileAsDocument(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        docType: "aadhaar",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileData: reader.result,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
