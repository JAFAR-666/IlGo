import React from "react";
const API_BASE_URL = "https://ilgo.onrender.com";
import { useEffect, useState } from "react";
import MapView from "./MapView.jsx";

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
    if (!bookingForm.serviceSlug || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    fetchJson(`/api/ilgo/workers?service=${encodeURIComponent(bookingForm.serviceSlug)}&latitude=${latitude}&longitude=${longitude}`)
      .then((data) => setWorkerPreview(data.items || []))
      .catch((requestError) => setError(requestError.message));
  }, [bookingForm.latitude, bookingForm.longitude, bookingForm.serviceSlug]);

  useEffect(() => {
<<<<<<< HEAD
    if (!selectedWorkerId) return;
    loadWorkerJobs(selectedWorkerId);
  }, [selectedWorkerId]);

  useEffect(() => {
    if (!activeBooking?.id) return undefined;
=======
    if (!activeBooking?.id) {
      return undefined;
    }

>>>>>>> origin/master
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

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
<<<<<<< HEAD
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const data = await fetchJson(endpoint, { method: "POST", body: JSON.stringify(payload) });
=======
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
>>>>>>> origin/master
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
<<<<<<< HEAD
    if (!activeToken) return;
    const data = await fetchJson("/api/ilgo/bookings", { headers: authHeaders(activeToken) });
    setBookings(data.items || []);
    setActiveBooking((current) => {
      if (!current) return data.items?.[0] || null;
      return data.items?.find((item) => item.id === current.id) || current;
    });
=======
    const data = await fetchJson("/api/ilgo/bookings", {
      headers: authHeaders(activeToken),
    });
    setBookings(data.items || []);
    setActiveBooking((current) => current ? data.items?.find((item) => item.id === current.id) || current : data.items?.[0] || null);
>>>>>>> origin/master
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
<<<<<<< HEAD
      setBookings((current) => [bookingResponse.booking, ...current.filter((item) => item.id !== bookingResponse.booking.id)]);
=======

      setBookings((current) => mergeBooking(current, bookingResponse.booking));
>>>>>>> origin/master
      setActiveBooking(bookingResponse.booking);
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
<<<<<<< HEAD
    if (!selectedWorkerId) return;
    setBusy(true);
=======
    setBusy(true);
    setError("");

>>>>>>> origin/master
    try {
      const result = await fetchJson("/api/worker/availability", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ isAvailable: nextAvailability }),
      });
<<<<<<< HEAD
      setCatalog((current) => ({
        ...current,
        workers: current.workers.map((worker) => (worker.id === result.worker.id ? result.worker : worker)),
      }));
      setWorkerPreview((current) => current.map((worker) => (worker.id === result.worker.id ? result.worker : worker)));
=======
      setWorkerProfile(result.worker);
>>>>>>> origin/master
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkerStatus(job, status) {
    setBusy(true);
<<<<<<< HEAD
    try {
      const result = await fetchJson(`/api/ilgo/bookings/${job.id}/status`, {
        method: "POST",
        body: JSON.stringify({ workerId: selectedWorkerId, status }),
      });
      setWorkerJobs((current) => mergeBooking(current, result.booking));
      setBookings((current) => mergeBooking(current, result.booking));
      if (activeBooking?.id === result.booking.id) setActiveBooking(result.booking);
=======
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
>>>>>>> origin/master
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

<<<<<<< HEAD
  // REMOVED: handleMoveWorker — real GPS now handles worker location updates
=======
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
>>>>>>> origin/master

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
    <div className="app">
      {/* ── Top Nav ── */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">IlGo</span>
          <span className="brand-tag">{config?.productTagline || "Instant home services"}</span>
        </div>
<<<<<<< HEAD

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
=======
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
>>>>>>> origin/master

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

<<<<<<< HEAD
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
=======
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
>>>>>>> origin/master
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

<<<<<<< HEAD
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
=======
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
>>>>>>> origin/master
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
<<<<<<< HEAD
=======
                <p className="history-meta">{worker.distanceKm ?? "--"} km away | Rs. {worker.hourlyRate}/hr | {worker.verificationStatus}</p>
>>>>>>> origin/master
              </div>
            ))}
          </div>
        </div>

<<<<<<< HEAD
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
=======
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
>>>>>>> origin/master
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
<<<<<<< HEAD
              </button>
            ))}
          </div>
=======
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
>>>>>>> origin/master
        )}
      </div>
    </div>
  );
}

<<<<<<< HEAD
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

=======
>>>>>>> origin/master
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
<<<<<<< HEAD
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
=======
    <section className="panel">
      <div className="panel-header">
        <h2>Deploy</h2>
        <p>Current OTP mode is demo-only. Swap SMS delivery later without changing the frontend flow.</p>
      </div>
      <div className="deploy-grid">
        <div className="panel info-panel"><h3>OTP</h3><p>Replace the demo OTP response with Twilio, MSG91, or another SMS provider.</p></div>
        <div className="panel info-panel"><h3>Documents</h3><p>Move document storage from data URLs to cloud object storage before production scale.</p></div>
        <div className="panel info-panel"><h3>Admin</h3><p>Protect admin credentials in env vars and keep audit logs for approvals.</p></div>
>>>>>>> origin/master
      </div>
    </div>
  );
}

/* ──────────────────────────── Shared ──────────────────────────── */

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

<<<<<<< HEAD
/* ──────────────────────────── Utilities ──────────────────────────── */
=======
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
>>>>>>> origin/master

async function fetchJson(url, options = {}) {
  const fullUrl = url.startsWith("http") ? url : `https://ilgo.onrender.com${url}`;
  const response = await fetch(fullUrl, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
<<<<<<< HEAD
  if (!response.ok) throw new Error(data.error || data.detail || "Request failed");
=======
  if (!response.ok) {
    throw new Error(data.error || data.detail || "Request failed");
  }
>>>>>>> origin/master
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
<<<<<<< HEAD
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
=======
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
>>>>>>> origin/master
