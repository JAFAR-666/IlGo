const REALTIME_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

async function connectRealtimeVoice({ sdp, mode, topic, learnerLevel, userName }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for realtime voice.");
  }

  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: buildInstructions({ mode, topic, learnerLevel, userName }),
      audio: {
        output: {
          voice: "sage",
        },
      },
    })
  );

  const response = await fetch(REALTIME_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Realtime connection failed (${response.status}): ${detail}`);
  }

  return {
    sdp: await response.text(),
    model: REALTIME_MODEL,
  };
}

function buildInstructions({ mode, topic, learnerLevel, userName }) {
  const learner = userName ? `${userName}` : "the learner";
  return [
    `You are Verbix, an expert communication coach helping ${learner}.`,
    `Current mode: ${mode || "public speaking"}.`,
    `Learner level: ${learnerLevel || "intermediate"}.`,
    `Practice topic: ${topic || "general communication practice"}.`,
    "Speak naturally, keep responses concise, and coach like a supportive trainer.",
    "Ask one question at a time, challenge weak arguments gently, and suggest specific improvements.",
    "When the learner finishes speaking, give quick spoken feedback and invite another attempt.",
  ].join(" ");
}

module.exports = {
  connectRealtimeVoice,
  REALTIME_MODEL,
};
