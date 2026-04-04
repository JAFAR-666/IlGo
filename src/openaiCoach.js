const { scoreResponse, buildFeedback } = require("./coach");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

async function evaluateTurnWithOpenAI(session, responseText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const heuristicAnalysis = scoreResponse(responseText);
  const heuristicFeedback = buildFeedback(session.modeLabel, heuristicAnalysis, responseText);

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: buildUserPrompt(session, responseText, heuristicAnalysis),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "communication_coach_feedback",
          strict: true,
          schema: feedbackSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const parsed = parseStructuredOutput(payload);
  const normalized = normalizeModelFeedback(parsed, heuristicAnalysis, heuristicFeedback);

  const turn = {
    responseText,
    analysis: normalized.analysis,
    feedback: normalized.feedback,
    engine: `openai:${DEFAULT_MODEL}`,
    createdAt: new Date().toISOString(),
  };

  return {
    session: {
      ...session,
      history: [...session.history, turn],
      coachPrompt: normalized.feedback.followUpPrompt,
    },
    turn,
  };
}

function buildSystemPrompt() {
  return [
    "You are a supportive communication coach for group discussions, public speaking, and presentations.",
    "Return JSON only.",
    "Score fairly and explain feedback in practical learner-friendly language.",
    "Use 0 to 100 integer scores.",
    "Give concise, actionable strengths and improvements.",
    "Tailor the follow-up prompt to the learner's weakest area.",
  ].join(" ");
}

function buildUserPrompt(session, responseText, heuristicAnalysis) {
  return [
    `Mode: ${session.modeLabel}`,
    `Learner level: ${session.learnerLevel}`,
    `Scenario: ${session.topic}`,
    `Goal: ${session.goal}`,
    `Current coach prompt: ${session.coachPrompt}`,
    `Learner response: ${responseText}`,
    `Reference metrics: wordCount=${heuristicAnalysis.wordCount}, fillerCount=${heuristicAnalysis.fillerCount}, structureSignals=${heuristicAnalysis.structureSignals}`,
    "Evaluate the response for clarity, structure, relevance, confidence, and conciseness.",
    "Return JSON matching the requested schema.",
  ].join("\n");
}

function parseStructuredOutput(payload) {
  if (payload.output_text) {
    return JSON.parse(payload.output_text);
  }

  const outputs = Array.isArray(payload.output) ? payload.output : [];

  for (const item of outputs) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return JSON.parse(part.text);
      }
      if (part.refusal) {
        throw new Error(`Model refused request: ${part.refusal}`);
      }
    }
  }

  throw new Error("Could not parse structured output from OpenAI response");
}

function normalizeModelFeedback(modelFeedback, heuristicAnalysis, heuristicFeedback) {
  const modelScores = modelFeedback.scores || {};
  const scores = {
    clarity: toBoundedScore(modelScores.clarity, heuristicAnalysis.scores.clarity),
    structure: toBoundedScore(modelScores.structure, heuristicAnalysis.scores.structure),
    relevance: toBoundedScore(modelScores.relevance, heuristicAnalysis.scores.relevance),
    confidence: toBoundedScore(modelScores.confidence, heuristicAnalysis.scores.confidence),
    conciseness: toBoundedScore(modelScores.conciseness, heuristicAnalysis.scores.conciseness),
  };

  const overall = Math.round(
    (scores.clarity + scores.structure + scores.relevance + scores.confidence + scores.conciseness) / 5
  );

  return {
    analysis: {
      ...heuristicAnalysis,
      scores: {
        ...scores,
        overall,
      },
    },
    feedback: {
      strengths: ensureStringArray(modelFeedback.strengths, heuristicFeedback.strengths),
      improvements: ensureStringArray(modelFeedback.improvements, heuristicFeedback.improvements),
      summary: cleanText(modelFeedback.summary, heuristicFeedback.summary),
      followUpPrompt: cleanText(modelFeedback.followUpPrompt, heuristicFeedback.followUpPrompt),
    },
  };
}

function ensureStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function cleanText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function toBoundedScore(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

async function safeReadError(response) {
  try {
    return await response.text();
  } catch (error) {
    return response.statusText || "Unknown error";
  }
}

const feedbackSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        clarity: { type: "integer", minimum: 0, maximum: 100 },
        structure: { type: "integer", minimum: 0, maximum: 100 },
        relevance: { type: "integer", minimum: 0, maximum: 100 },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        conciseness: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["clarity", "structure", "relevance", "confidence", "conciseness"],
    },
    strengths: {
      type: "array",
      items: { type: "string" },
    },
    improvements: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
    followUpPrompt: { type: "string" },
  },
  required: ["scores", "strengths", "improvements", "summary", "followUpPrompt"],
};

module.exports = {
  evaluateTurnWithOpenAI,
  DEFAULT_MODEL,
};
