import { useEffect, useMemo, useRef, useState } from "react";
import { getVoiceSupport, startVoiceCapture, stopVoiceCapture } from "./voice";
import { createRealtimeCoach, getRealtimeSupport } from "./realtimeVoice";
import AnalyticsPanel from "./AnalyticsPanel";

const initialForm = {
  mode: "gd",
  learnerLevel: "intermediate",
  durationMinutes: 5,
  topic: "",
};

const initialAuth = {
  name: "",
  email: "",
  password: "",
};

const tokenStorageKey = "verbix_auth_token";

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [config, setConfig] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(initialAuth);
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey) || "");
  const [user, setUser] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [view, setView] = useState("practice");
  const [responseText, setResponseText] = useState("");
  const [session, setSession] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState({
    status: "idle",
    transcript: "",
    interimTranscript: "",
    durationSeconds: 0,
    audioUrl: "",
    error: "",
  });
  const [realtimeState, setRealtimeState] = useState({
    status: "idle",
    model: "",
    error: "",
    messages: [],
  });

  const voiceSupport = useMemo(() => getVoiceSupport(), []);
  const realtimeSupport = useMemo(() => getRealtimeSupport(), []);
  const voiceSessionRef = useRef(null);
  const timerRef = useRef(null);
  const realtimeSessionRef = useRef(null);

  useEffect(() => {
    fetchJson("/api/app-config")
      .then(setConfig)
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (!token) {
      localStorage.removeItem(tokenStorageKey);
      setUser(null);
      setHistoryItems([]);
      return;
    }

    localStorage.setItem(tokenStorageKey, token);
    fetchJson("/api/auth/me", {
      headers: authHeaders(token),
    })
      .then((data) => {
        setUser(data.user);
        return loadHistory(token);
      })
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        setToken("");
      });
  }, [token]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      if (voiceSessionRef.current) {
        stopVoiceCapture(voiceSessionRef.current);
      }

      if (realtimeSessionRef.current) {
        realtimeSessionRef.current.stop();
      }
    };
  }, []);

  async function startSession(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const nextSession = await fetchJson("/api/session/start", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          ...form,
          durationMinutes: Number(form.durationMinutes),
        }),
      });
      setSession(nextSession);
      setFeedback(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitResponse(event) {
    event.preventDefault();

    if (!session) {
      setError("Create a session first so the coach knows what you are practicing.");
      return;
    }

    if (!responseText.trim()) {
      setError("Add a practice response or record your voice before asking for feedback.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await fetchJson("/api/session/respond", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          sessionId: session.id,
          responseText,
        }),
      });
      setSession(result.session);
      setFeedback(result.turn);
      await loadHistory();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartRecording() {
    setError("");
    setVoiceState({
      status: "requesting",
      transcript: "",
      interimTranscript: "",
      durationSeconds: 0,
      audioUrl: "",
      error: "",
    });

    try {
      const capture = await startVoiceCapture({
        onTranscript(text) {
          setVoiceState((current) => ({ ...current, transcript: text }));
        },
        onInterimTranscript(text) {
          setVoiceState((current) => ({ ...current, interimTranscript: text }));
        },
        onAudioReady(audioUrl) {
          setVoiceState((current) => ({ ...current, audioUrl }));
        },
        onError(message) {
          setVoiceState((current) => ({
            ...current,
            status: "error",
            error: message,
          }));
        },
      });

      voiceSessionRef.current = capture;
      setVoiceState((current) => ({
        ...current,
        status: "recording",
      }));

      timerRef.current = setInterval(() => {
        setVoiceState((current) => ({
          ...current,
          durationSeconds: Number((current.durationSeconds + 1).toFixed(0)),
        }));
      }, 1000);
    } catch (captureError) {
      setVoiceState((current) => ({
        ...current,
        status: "error",
        error: captureError.message,
      }));
    }
  }

  async function handleStopRecording() {
    if (!voiceSessionRef.current) {
      return;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const stopped = await stopVoiceCapture(voiceSessionRef.current);
    voiceSessionRef.current = null;

    const mergedTranscript = [stopped.transcript, stopped.interimTranscript]
      .filter(Boolean)
      .join(" ")
      .trim();

    setVoiceState((current) => ({
      ...current,
      status: "stopped",
      transcript: mergedTranscript || current.transcript,
      interimTranscript: "",
      audioUrl: stopped.audioUrl || current.audioUrl,
    }));

    if (mergedTranscript) {
      setResponseText(mergedTranscript);
    }
  }

  const voiceMetrics = useMemo(() => {
    return calculateVoiceMetrics(voiceState.transcript || responseText, voiceState.durationSeconds);
  }, [responseText, voiceState.durationSeconds, voiceState.transcript]);

  async function loadHistory(activeToken = token) {
    if (!activeToken) {
      return;
    }

    const data = await fetchJson("/api/history", {
      headers: authHeaders(activeToken),
    });
    setHistoryItems(data.items || []);
    const analyticsData = await fetchJson("/api/analytics", {
      headers: authHeaders(activeToken),
    });
    setAnalytics(analyticsData);
  }

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

  async function handleStartRealtime() {
    setRealtimeState({
      status: "connecting",
      model: "",
      error: "",
      messages: [],
    });

    try {
      realtimeSessionRef.current = await createRealtimeCoach({
        token,
        mode: form.mode,
        topic: form.topic,
        learnerLevel: form.learnerLevel,
        userName: user?.name,
        onStatus(status) {
          setRealtimeState((current) => ({ ...current, status }));
        },
        onMessage(message) {
          setRealtimeState((current) => ({
            ...current,
            messages: [...current.messages, message],
          }));
        },
        async onTranscriptComplete(text, sessionId) {
          const score = await fetchJson("/api/realtime/score", {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({
              sessionId,
              responseText: text,
            }),
          });

          setRealtimeState((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                role: "score",
                text: `${score.score.overall}/100 overall. ${score.feedback.summary}`,
              },
            ],
          }));

          await loadHistory();
        },
        onError(message) {
          setRealtimeState((current) => ({
            ...current,
            status: "error",
            error: message,
          }));
        },
      });

      setRealtimeState((current) => ({
        ...current,
        status: "live",
        model: realtimeSessionRef.current.model || "",
      }));
    } catch (requestError) {
      setRealtimeState((current) => ({
        ...current,
        status: "error",
        error: requestError.message,
      }));
    }
  }

  function handleStopRealtime() {
    realtimeSessionRef.current?.stop();
    realtimeSessionRef.current = null;
    setRealtimeState((current) => ({ ...current, status: "stopped" }));
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setUser(null);
    setHistoryItems([]);
    setAnalytics(null);
    setSession(null);
    setFeedback(null);
    setResponseText("");
    setView("practice");
  }

  return (
    <main className="verbix-shell">
      <header className="topbar">
        <div>
          <p className="brand-mark">Verbix</p>
          <p className="brand-subtitle">Communication training for the way people really speak</p>
        </div>
        {user ? (
          <div className="topbar-actions">
            <button type="button" className={view === "practice" ? "nav-chip active" : "nav-chip"} onClick={() => setView("practice")}>Practice</button>
            <button type="button" className={view === "history" ? "nav-chip active" : "nav-chip"} onClick={() => setView("history")}>History</button>
            <button type="button" className={view === "voice" ? "nav-chip active" : "nav-chip"} onClick={() => setView("voice")}>Voice Studio</button>
            <button type="button" className="ghost-button" onClick={handleLogout}>Logout</button>
          </div>
        ) : null}
      </header>

      {!user ? <Landing authForm={authForm} authMode={authMode} busy={busy} error={error} onAuthModeChange={setAuthMode} onAuthFormChange={setAuthForm} onSubmit={handleAuthSubmit} /> : null}

      {user ? (
        <>
          <section className="hero-banner panel">
            <div>
              <p className="eyebrow">Welcome back</p>
              <h2>{user.name}, your Verbix studio is ready.</h2>
              <p className="hero-copy">Create a practice round, review saved sessions, or switch into Voice Studio for a live AI conversation.</p>
            </div>
            <div className="roadmap">
              <MetricCard title="Saved Sessions" score={historyItems.length} description="Persisted practice history" />
              <MetricCard title="Evaluation" score={config?.evaluationEngine || "loading"} description="Current scoring engine" />
              <MetricCard title="Realtime" score={config?.realtimeAvailable ? "ready" : "setup needed"} description="Voice Studio availability" />
            </div>
          </section>

          {error ? <p className="error-banner">{error}</p> : null}

          {view === "practice" ? (
            <>
              <section className="panel controls">
                <div className="panel-header">
                  <h2>Create Session</h2>
                  <p>Pick your format, difficulty, and topic before each round.</p>
                </div>

                <form className="form-grid" onSubmit={startSession}>
                  <label>
                    Mode
                    <select value={form.mode} onChange={(event) => updateForm(setForm, "mode", event.target.value)}>
                      <option value="gd">Group Discussion</option>
                      <option value="publicSpeaking">Public Speaking</option>
                      <option value="presentations">Presentations</option>
                    </select>
                  </label>
                  <label>
                    Learner Level
                    <select value={form.learnerLevel} onChange={(event) => updateForm(setForm, "learnerLevel", event.target.value)}>
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </label>
                  <label>
                    Duration (minutes)
                    <input type="number" min="2" max="20" value={form.durationMinutes} onChange={(event) => updateForm(setForm, "durationMinutes", event.target.value)} />
                  </label>
                  <label className="full-width">
                    Topic or scenario
                    <input type="text" value={form.topic} placeholder="Placement GD, team presentation, leadership communication..." onChange={(event) => updateForm(setForm, "topic", event.target.value)} />
                  </label>
                  <button type="submit" disabled={busy}>{busy ? "Working..." : "Create Verbix Session"}</button>
                </form>
              </section>

              <section className="workspace">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Coach Brief</h2>
                    <p>The agent sets the scenario, goal, and current coaching prompt.</p>
                  </div>
                  {session ? <SessionBrief session={session} /> : <EmptyState text="Start a session to load your practice scenario." />}
                </article>

                <article className="panel">
                  <div className="panel-header">
                    <h2>Your Response</h2>
                    <p>Type a reply, or record yourself and let Verbix draft the transcript.</p>
                  </div>

                  <form className="response-form" onSubmit={submitResponse}>
                    <textarea rows="11" value={responseText} placeholder="Speak or type your response here..." onChange={(event) => setResponseText(event.target.value)} />

                    <div className="voice-controls">
                      <button type="button" className="secondary-button" onClick={handleStartRecording} disabled={voiceState.status === "recording" || !voiceSupport.microphone}>Start Voice Practice</button>
                      <button type="button" className="secondary-button" onClick={handleStopRecording} disabled={voiceState.status !== "recording"}>Stop Recording</button>
                    </div>

                    <VoicePanel voiceSupport={voiceSupport} voiceState={voiceState} voiceMetrics={voiceMetrics} />

                    <button type="submit" disabled={busy}>{busy ? "Scoring..." : "Get Verbix Feedback"}</button>
                  </form>
                </article>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>Feedback Dashboard</h2>
                  <p>Review performance, then iterate with the next round prompt.</p>
                </div>
                {feedback ? <FeedbackPanel turn={feedback} /> : <EmptyState text="Feedback will appear here after your first response." />}
              </section>
            </>
          ) : null}

          {view === "history" ? <HistorySection historyItems={historyItems} analytics={analytics} /> : null}

          {view === "voice" ? <VoiceStudio realtimeState={realtimeState} realtimeSupport={realtimeSupport} realtimeAvailable={Boolean(config?.realtimeAvailable)} onStart={handleStartRealtime} onStop={handleStopRealtime} /> : null}
        </>
      ) : null}
    </main>
  );
}

function SessionBrief({ session }) {
  return (
    <div className="brief-block">
      <div className="brief-meta">
        <MetaCard label="Mode" value={session.modeLabel} />
        <MetaCard label="Level" value={session.learnerLevel} />
        <MetaCard label="Goal" value={session.goal} />
        <MetaCard label="Engine" value={session.evaluationEngine || "heuristic"} />
      </div>
      <div>
        <h3>Scenario</h3>
        <p>{session.topic}</p>
      </div>
      <div className="coach-prompt">
        <strong>Coach prompt</strong>
        <p>{session.coachPrompt}</p>
      </div>
    </div>
  );
}

function FeedbackPanel({ turn }) {
  const { analysis, feedback } = turn;

  return (
    <div className="feedback-grid">
      {turn.warning ? <p className="inline-note">Fallback used: {turn.warning}</p> : null}
      <div className="metrics-grid">
        <MetricCard title="Overall" score={`${analysis.scores.overall}/100`} description="Composite coaching score" />
        <MetricCard title="Clarity" score={`${analysis.scores.clarity}/100`} description="How understandable the message feels" />
        <MetricCard title="Structure" score={`${analysis.scores.structure}/100`} description="How easy the sequence is to follow" />
        <MetricCard title="Confidence" score={`${analysis.scores.confidence}/100`} description="How assertive and steady the delivery sounds" />
        <MetricCard title="Relevance" score={`${analysis.scores.relevance}/100`} description="How directly the answer serves the scenario" />
        <MetricCard title="Conciseness" score={`${analysis.scores.conciseness}/100`} description="How focused and efficient the answer is" />
      </div>

      <div className="feedback-section">
        <h3>Coach summary</h3>
        <p>{feedback.summary}</p>
      </div>

      <div className="feedback-section">
        <h3>Strengths</h3>
        <ul>
          {feedback.strengths.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="feedback-section">
        <h3>Improvements</h3>
        <ul>
          {feedback.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="coach-prompt">
        <strong>Next round prompt</strong>
        <p>{feedback.followUpPrompt}</p>
      </div>

      <div className="feedback-section">
        <h3>Scored by</h3>
        <p>{turn.engine || "heuristic"}</p>
      </div>
    </div>
  );
}

function VoicePanel({ voiceSupport, voiceState, voiceMetrics }) {
  return (
    <div className="voice-panel">
      <div className="panel-header compact">
        <h3>Voice Practice</h3>
        <p>Browser support varies. Speech recognition is optional and falls back gracefully.</p>
      </div>

      <div className="metrics-grid">
        <MetaCard label="Mic" value={voiceSupport.microphone ? "supported" : "missing"} />
        <MetaCard label="Speech to text" value={voiceSupport.recognition ? "available" : "limited"} />
        <MetaCard label="Duration" value={`${voiceState.durationSeconds}s`} />
      </div>

      <div className="metrics-grid">
        <MetricCard title="Words" score={voiceMetrics.wordCount} description="Transcript length" />
        <MetricCard title="Pace" score={voiceMetrics.wordsPerMinute} description="Words per minute" />
        <MetricCard title="Fillers" score={voiceMetrics.fillerCount} description="Detected filler words" />
        <MetricCard title="Fluency" score={`${voiceMetrics.fluencyScore}/100`} description="Heuristic speaking quality" />
      </div>

      <div className="voice-status">
        <strong>Status:</strong> {voiceState.status}
      </div>

      {voiceState.error ? <p className="inline-note">Voice error: {voiceState.error}</p> : null}
      {voiceState.interimTranscript ? <p className="inline-note">Listening: {voiceState.interimTranscript}</p> : null}
      {voiceState.transcript ? <p className="voice-transcript">{voiceState.transcript}</p> : null}

      {voiceState.audioUrl ? (
        <audio controls src={voiceState.audioUrl} className="audio-preview">
          Your browser does not support audio playback.
        </audio>
      ) : null}
    </div>
  );
}

function Landing({ authForm, authMode, busy, error, onAuthModeChange, onAuthFormChange, onSubmit }) {
  return (
    <>
      <section className="landing-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">Realtime speaking practice</p>
          <h1>Verbix helps learners practice GDs, public speaking, and presentations with an AI coach.</h1>
          <p className="hero-copy">
            Sign in to save practice history, review coaching trends, and open Voice Studio for live AI conversations.
          </p>
          <div className="hero-pills">
            <span>AI voice coach</span>
            <span>Saved session history</span>
            <span>Presentation and GD training</span>
          </div>
        </div>

        <div className="panel auth-card">
          <div className="auth-tabs">
            <button type="button" className={authMode === "login" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthModeChange("login")}>Login</button>
            <button type="button" className={authMode === "register" ? "nav-chip active" : "nav-chip"} onClick={() => onAuthModeChange("register")}>Create account</button>
          </div>
          <form className="response-form" onSubmit={onSubmit}>
            {authMode === "register" ? <label>Name<input type="text" value={authForm.name} onChange={(event) => updateForm(onAuthFormChange, "name", event.target.value)} /></label> : null}
            <label>Email<input type="email" value={authForm.email} onChange={(event) => updateForm(onAuthFormChange, "email", event.target.value)} /></label>
            <label>Password<input type="password" value={authForm.password} onChange={(event) => updateForm(onAuthFormChange, "password", event.target.value)} /></label>
            {error ? <p className="error-banner">{error}</p> : null}
            <button type="submit" disabled={busy}>{busy ? "Working..." : authMode === "login" ? "Enter Verbix" : "Start with Verbix"}</button>
          </form>
        </div>
      </section>

      <section className="feature-grid">
        <div className="panel info-panel"><h3>Practice like a real session</h3><p>Switch between GDs, public speaking, and presentations with custom topics and learner levels.</p></div>
        <div className="panel info-panel"><h3>Track progress</h3><p>Saved history lets learners review previous attempts, scores, and coach summaries.</p></div>
        <div className="panel info-panel"><h3>Talk to the coach</h3><p>Voice Studio opens a natural realtime AI conversation for speaking practice.</p></div>
      </section>
    </>
  );
}

function HistorySection({ historyItems, analytics }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Saved Practice History</h2>
        <p>Review previous sessions, recent scores, and coaching summaries.</p>
      </div>
      <AnalyticsPanel analytics={analytics} />
      {historyItems.length ? (
        <div className="history-list">
          {historyItems.map((item) => (
            <article key={item.id} className="history-card">
              <div className="history-header">
                <div>
                  <p className="eyebrow small">{item.modeLabel}</p>
                  <h3>{item.topic}</h3>
                </div>
                <div className="score-pill">{item.latestScores?.overall || 0}/100</div>
              </div>
              <p className="history-meta">{item.learnerLevel} level | {item.turnCount} turns | {new Date(item.updatedAt).toLocaleString()}</p>
              <p className="history-summary">{item.latestSummary}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="Your saved history will appear here after you finish a practice round." />
      )}
    </section>
  );
}

function VoiceStudio({ realtimeState, realtimeSupport, realtimeAvailable, onStart, onStop }) {
  return (
    <section className="panel voice-studio">
      <div className="panel-header">
        <h2>Voice Studio</h2>
        <p>Talk to the Verbix AI coach in realtime.</p>
      </div>
      <div className="metrics-grid">
        <MetaCard label="WebRTC" value={realtimeSupport.webrtc ? "supported" : "missing"} />
        <MetaCard label="Mic" value={realtimeSupport.microphone ? "ready" : "missing"} />
        <MetaCard label="Status" value={realtimeState.status} />
        <MetaCard label="Model" value={realtimeState.model || "pending"} />
      </div>
      <div className="voice-controls">
        <button type="button" disabled={!realtimeSupport.ready || !realtimeAvailable || realtimeState.status === "live"} onClick={onStart}>Start AI Conversation</button>
        <button type="button" className="secondary-button" disabled={realtimeState.status !== "live"} onClick={onStop}>Stop AI Conversation</button>
      </div>
      {!realtimeAvailable ? <p className="inline-note">Realtime voice needs a valid `OPENAI_API_KEY` with available quota.</p> : null}
      {realtimeState.error ? <p className="error-banner">{realtimeState.error}</p> : null}
      <div className="realtime-feed">
        {realtimeState.messages.length ? realtimeState.messages.map((message, index) => (
          <div key={`${message.role}_${index}`} className={`message-bubble ${message.role}`}>
            <span>{message.role === "assistant" ? "Verbix Coach" : message.role === "score" ? "Live Score" : "System"}</span>
            <p>{message.text}</p>
          </div>
        )) : <EmptyState text="Start the conversation and Verbix will greet you." />}
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

function calculateVoiceMetrics(text, durationSeconds) {
  const cleaned = (text || "").trim();
  const words = cleaned ? cleaned.split(/\s+/) : [];
  const fillerMatches = cleaned.toLowerCase().match(/\b(um|uh|like|you know|basically|actually)\b/g) || [];
  const wordsPerMinute = durationSeconds > 0 ? Math.round((words.length / durationSeconds) * 60) : 0;
  const pacePenalty = wordsPerMinute === 0 ? 25 : Math.max(Math.abs(wordsPerMinute - 135) - 20, 0) / 2;
  const fillerPenalty = fillerMatches.length * 6;
  const fluencyScore = clamp(Math.round(90 - pacePenalty - fillerPenalty), 20, 100);

  return {
    wordCount: words.length,
    wordsPerMinute,
    fillerCount: fillerMatches.length,
    fluencyScore,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
