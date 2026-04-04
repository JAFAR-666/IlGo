const modeCatalog = {
  gd: {
    label: "Group Discussion",
    scenarioTemplates: [
      "A campus placement GD on whether AI will create more jobs than it replaces.",
      "A team discussion on remote work versus office-first culture.",
      "A policy debate on whether social media should be regulated more tightly.",
    ],
    goals: [
      "contribute clearly without dominating",
      "build on others' ideas and add structure",
      "show balanced reasoning with examples",
    ],
  },
  publicSpeaking: {
    label: "Public Speaking",
    scenarioTemplates: [
      "Deliver a 2-minute talk on why communication skills shape career growth.",
      "Give a motivational speech to students nervous about speaking in public.",
      "Explain a complex idea simply to a mixed audience.",
    ],
    goals: [
      "speak with clarity and confidence",
      "use strong opening and closing statements",
      "keep ideas structured and audience-friendly",
    ],
  },
  presentations: {
    label: "Presentations",
    scenarioTemplates: [
      "Pitch a product update to leadership with a clear recommendation.",
      "Present quarterly progress to stakeholders with concise highlights.",
      "Explain a new strategy to a client in a persuasive but simple way.",
    ],
    goals: [
      "present with executive-level clarity",
      "organize information into a persuasive flow",
      "make key takeaways memorable and actionable",
    ],
  },
};

function pickOne(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createId() {
  return `session_${Math.random().toString(36).slice(2, 10)}`;
}

function createSession(input = {}) {
  const modeKey = modeCatalog[input.mode] ? input.mode : "gd";
  const mode = modeCatalog[modeKey];
  const learnerLevel = input.learnerLevel || "intermediate";
  const topic = input.topic?.trim() || pickOne(mode.scenarioTemplates);
  const durationMinutes = Number(input.durationMinutes || 5);

  return {
    id: createId(),
    mode: modeKey,
    modeLabel: mode.label,
    learnerLevel,
    durationMinutes,
    topic,
    rubric: [
      "clarity",
      "structure",
      "relevance",
      "confidence",
      "conciseness",
    ],
    coachPrompt: buildOpeningPrompt(mode.label, topic, learnerLevel),
    goal: pickOne(mode.goals),
    history: [],
  };
}

function buildOpeningPrompt(modeLabel, topic, learnerLevel) {
  return `You are practicing ${modeLabel.toLowerCase()} at a ${learnerLevel} level. Scenario: ${topic} Start with a clear opening, organize your points, and finish with a strong takeaway.`;
}

function scoreResponse(responseText) {
  const text = responseText.trim();
  const words = text ? text.split(/\s+/) : [];
  const wordCount = words.length;
  const lower = text.toLowerCase();

  const fillerMatches = lower.match(/\b(um|uh|like|you know|basically|actually)\b/g) || [];
  const structureSignals = lower.match(/\b(first|second|finally|in conclusion|for example|however)\b/g) || [];
  const confidenceSignals = lower.match(/\b(i believe|i recommend|clearly|strongly|confident|important)\b/g) || [];
  const actionSignals = lower.match(/\b(should|next|recommend|plan|action|outcome)\b/g) || [];

  const clarity = clamp(50 + Math.min(wordCount, 120) / 3 - fillerMatches.length * 4, 20, 95);
  const structure = clamp(35 + structureSignals.length * 12 + (wordCount > 60 ? 10 : 0), 20, 95);
  const confidence = clamp(40 + confidenceSignals.length * 10 - fillerMatches.length * 2, 20, 95);
  const relevance = clamp(45 + actionSignals.length * 8 + (wordCount > 40 ? 10 : 0), 20, 95);
  const conciseness = clamp(85 - Math.max(wordCount - 110, 0) / 2 - fillerMatches.length * 3, 20, 95);

  const overall = Math.round((clarity + structure + confidence + relevance + conciseness) / 5);

  return {
    wordCount,
    fillerCount: fillerMatches.length,
    structureSignals: structureSignals.length,
    scores: {
      clarity: Math.round(clarity),
      structure: Math.round(structure),
      relevance: Math.round(relevance),
      confidence: Math.round(confidence),
      conciseness: Math.round(conciseness),
      overall,
    },
  };
}

function buildFeedback(modeLabel, analysis, responseText) {
  const strengths = [];
  const improvements = [];

  if (analysis.scores.structure >= 65) {
    strengths.push("Your response shows a recognizable structure, which helps the listener follow your message.");
  } else {
    improvements.push("Add clearer signposting like 'first', 'second', and 'finally' so your ideas land in a stronger sequence.");
  }

  if (analysis.scores.confidence >= 65) {
    strengths.push("Your language sounds reasonably assertive instead of overly hesitant.");
  } else {
    improvements.push("Use firmer phrasing such as 'I recommend' or 'My key point is' to sound more confident.");
  }

  if (analysis.fillerCount <= 1) {
    strengths.push("You kept filler words under control, which improves fluency.");
  } else {
    improvements.push("Reduce filler words and pauses in your wording to sound more polished.");
  }

  if (analysis.scores.conciseness < 60) {
    improvements.push("Tighten the answer by trimming repeated points and ending earlier with a crisp takeaway.");
  }

  if (analysis.wordCount < 35) {
    improvements.push("Expand your answer with one example or supporting point so it feels more complete.");
  }

  const followUpPrompt = buildFollowUpPrompt(modeLabel, responseText, analysis);

  return {
    strengths,
    improvements,
    summary: `This ${modeLabel.toLowerCase()} attempt scored ${analysis.scores.overall}/100 overall. The biggest opportunity is to improve ${lowestScoringArea(analysis.scores)}.`,
    followUpPrompt,
  };
}

function buildFollowUpPrompt(modeLabel, responseText, analysis) {
  const weakestArea = lowestScoringArea(analysis.scores);

  if (modeLabel === "Group Discussion") {
    return `Now respond again in a GD style, but improve your ${weakestArea}. Add one balanced counterpoint and one practical example.`;
  }

  if (modeLabel === "Public Speaking") {
    return `Try the speech again with a stronger opening hook and a more memorable closing line, especially improving ${weakestArea}.`;
  }

  return `Present the same idea again as if speaking to stakeholders. Improve ${weakestArea}, and end with a clear recommendation and next step.`;
}

function lowestScoringArea(scores) {
  const tracked = Object.entries(scores).filter(([key]) => key !== "overall");
  tracked.sort((a, b) => a[1] - b[1]);
  return tracked[0][0];
}

function evaluateTurnHeuristic(session, responseText) {
  const analysis = scoreResponse(responseText);
  const feedback = buildFeedback(session.modeLabel, analysis, responseText);

  const turn = {
    responseText,
    analysis,
    feedback,
    createdAt: new Date().toISOString(),
  };

  const updatedSession = {
    ...session,
    history: [...session.history, turn],
    coachPrompt: feedback.followUpPrompt,
  };

  return {
    session: updatedSession,
    turn,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  createSession,
  evaluateTurnHeuristic,
  scoreResponse,
  buildFeedback,
};
