const sessionForm = document.getElementById("session-form");
const responseForm = document.getElementById("response-form");
const briefEl = document.getElementById("session-brief");
const feedbackEl = document.getElementById("feedback-output");
const responseTextEl = document.getElementById("response-text");

let activeSessionId = null;

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(sessionForm);
  const payload = Object.fromEntries(formData.entries());
  const session = await postJson("/api/session/start", payload);
  activeSessionId = session.id;

  renderBrief(session);
  feedbackEl.innerHTML = "<p class='empty-state'>Session started. Submit your first response to get scored feedback.</p>";
});

responseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!activeSessionId) {
    feedbackEl.innerHTML = "<p class='empty-state'>Create a session first so the coach knows what you are practicing.</p>";
    return;
  }

  const responseText = responseTextEl.value.trim();

  if (!responseText) {
    feedbackEl.innerHTML = "<p class='empty-state'>Add a practice response before asking for feedback.</p>";
    return;
  }

  const result = await postJson("/api/session/respond", {
    sessionId: activeSessionId,
    responseText,
  });

  renderFeedback(result.turn);
  renderBrief(result.session);
});

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function renderBrief(session) {
  briefEl.innerHTML = `
    <div class="brief-block">
      <div class="brief-meta">
        <div class="meta-card">
          <span>Mode</span>
          <strong>${escapeHtml(session.modeLabel)}</strong>
        </div>
        <div class="meta-card">
          <span>Level</span>
          <strong>${escapeHtml(session.learnerLevel)}</strong>
        </div>
        <div class="meta-card">
          <span>Goal</span>
          <strong>${escapeHtml(session.goal)}</strong>
        </div>
        <div class="meta-card">
          <span>Engine</span>
          <strong>${escapeHtml(session.evaluationEngine || "heuristic")}</strong>
        </div>
      </div>
      <div>
        <h3>Scenario</h3>
        <p>${escapeHtml(session.topic)}</p>
      </div>
      <div class="coach-prompt">
        <strong>Coach prompt</strong>
        <p>${escapeHtml(session.coachPrompt)}</p>
      </div>
    </div>
  `;
}

function renderFeedback(turn) {
  const { analysis, feedback } = turn;
  const metrics = analysis.scores;
  const warning = turn.warning
    ? `<p class="inline-note">Fallback used: ${escapeHtml(turn.warning)}</p>`
    : "";

  feedbackEl.innerHTML = `
    <div class="feedback-grid">
      ${warning}
      <div class="metrics-grid">
        ${renderMetric("Overall", metrics.overall, "Composite coaching score")}
        ${renderMetric("Clarity", metrics.clarity, "How clear the message sounds")}
        ${renderMetric("Structure", metrics.structure, "Whether the flow is easy to follow")}
        ${renderMetric("Confidence", metrics.confidence, "How assertive the tone feels")}
        ${renderMetric("Relevance", metrics.relevance, "Whether the response moves toward a useful point")}
        ${renderMetric("Conciseness", metrics.conciseness, "How crisp and focused the answer is")}
      </div>

      <div class="feedback-section">
        <h3>Coach summary</h3>
        <p>${escapeHtml(feedback.summary)}</p>
      </div>

      <div class="feedback-section">
        <h3>Strengths</h3>
        <ul>${feedback.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>

      <div class="feedback-section">
        <h3>Improvements</h3>
        <ul>${feedback.improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>

      <div class="coach-prompt">
        <strong>Next round prompt</strong>
        <p>${escapeHtml(feedback.followUpPrompt)}</p>
      </div>

      <div class="feedback-section">
        <h3>Scored by</h3>
        <p>${escapeHtml(turn.engine || "heuristic")}</p>
      </div>
    </div>
  `;
}

function renderMetric(label, score, description) {
  return `
    <div class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${score}/100</strong>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
