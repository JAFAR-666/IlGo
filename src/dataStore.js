const crypto = require("crypto");
const { query } = require("./db");

async function createStoredSession(session) {
  const now = new Date().toISOString();
  await query(`
    INSERT INTO practice_sessions (
      id, user_id, mode, mode_label, learner_level, duration_minutes,
      topic, goal, evaluation_engine, session_kind, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    session.id,
    session.userId || null,
    session.mode,
    session.modeLabel,
    session.learnerLevel,
    Number(session.durationMinutes || 5),
    session.topic,
    session.goal,
    session.evaluationEngine || "heuristic",
    session.sessionKind || "practice",
    session.createdAt || now,
    now,
  ]);
}

async function savePracticeResult(session, turn) {
  await createStoredSession(session);

  await query(`
    INSERT INTO practice_turns (
      id, session_id, source, role, response_text, word_count, filler_count,
      clarity, structure, relevance, confidence, conciseness, overall,
      summary, strengths_json, improvements_json, follow_up_prompt,
      engine, warning, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15::jsonb, $16::jsonb, $17,
      $18, $19, $20
    )
  `, [
    `turn_${crypto.randomUUID()}`,
    session.id,
    turn.source || session.sessionKind || "practice",
    turn.role || "user",
    turn.responseText || "",
    turn.analysis?.wordCount || 0,
    turn.analysis?.fillerCount || 0,
    turn.analysis?.scores?.clarity ?? null,
    turn.analysis?.scores?.structure ?? null,
    turn.analysis?.scores?.relevance ?? null,
    turn.analysis?.scores?.confidence ?? null,
    turn.analysis?.scores?.conciseness ?? null,
    turn.analysis?.scores?.overall ?? null,
    turn.feedback?.summary || "",
    JSON.stringify(turn.feedback?.strengths || []),
    JSON.stringify(turn.feedback?.improvements || []),
    turn.feedback?.followUpPrompt || "",
    turn.engine || session.evaluationEngine || "heuristic",
    turn.warning || "",
    turn.createdAt || new Date().toISOString(),
  ]);

  await query(
    "UPDATE practice_sessions SET updated_at = $1, evaluation_engine = $2 WHERE id = $3",
    [turn.createdAt || new Date().toISOString(), session.evaluationEngine || "heuristic", session.id]
  );
}

async function getHistoryForUser(userId) {
  const sessionsResult = await query(`
    SELECT * FROM practice_sessions
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `, [userId]);

  const sessions = sessionsResult.rows;
  const history = [];

  for (const session of sessions) {
    const turnsResult = await query(`
      SELECT * FROM practice_turns
      WHERE session_id = $1
      ORDER BY created_at ASC
    `, [session.id]);
    const turns = turnsResult.rows.map(mapTurnRow);
    const latestTurn = turns[turns.length - 1];
    history.push({
      id: `history_${session.id}`,
      sessionId: session.id,
      userId: session.user_id,
      mode: session.mode,
      modeLabel: session.mode_label,
      topic: session.topic,
      learnerLevel: session.learner_level,
      goal: session.goal,
      evaluationEngine: session.evaluation_engine,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      turnCount: turns.length,
      latestScores: latestTurn?.analysis?.scores || null,
      latestSummary: latestTurn?.feedback?.summary || "",
      turns,
    });
  }

  return history;
}

async function getAnalyticsForUser(userId) {
  const result = await query(`
    SELECT practice_sessions.mode_label, practice_turns.*
    FROM practice_turns
    JOIN practice_sessions ON practice_sessions.id = practice_turns.session_id
    WHERE practice_sessions.user_id = $1
      AND practice_turns.role = 'user'
      AND practice_turns.overall IS NOT NULL
    ORDER BY practice_turns.created_at ASC
  `, [userId]);
  const turns = result.rows;

  const scoreTrend = turns.map((turn, index) => ({
    index: index + 1,
    createdAt: turn.created_at,
    overall: turn.overall,
    confidence: turn.confidence,
    clarity: turn.clarity,
    fluency: fluencyFromRow(turn),
    modeLabel: turn.mode_label,
  }));

  const modeMap = new Map();
  for (const turn of turns) {
    const current = modeMap.get(turn.mode_label) || { modeLabel: turn.mode_label, attempts: 0, avgOverall: 0 };
    current.attempts += 1;
    current.avgOverall += turn.overall;
    modeMap.set(turn.mode_label, current);
  }

  const modeBreakdown = Array.from(modeMap.values()).map((entry) => ({
    modeLabel: entry.modeLabel,
    attempts: entry.attempts,
    avgOverall: Math.round(entry.avgOverall / entry.attempts),
  }));

  const latest = scoreTrend[scoreTrend.length - 1] || null;
  const first = scoreTrend[0] || null;

  return {
    summary: {
      totalAttempts: scoreTrend.length,
      avgOverall: scoreTrend.length ? Math.round(scoreTrend.reduce((sum, item) => sum + item.overall, 0) / scoreTrend.length) : 0,
      bestOverall: scoreTrend.length ? Math.max(...scoreTrend.map((item) => item.overall)) : 0,
      improvementDelta: latest && first ? latest.overall - first.overall : 0,
    },
    scoreTrend,
    modeBreakdown,
  };
}

function mapTurnRow(turn) {
  return {
    createdAt: turn.created_at,
    responseText: turn.response_text,
    analysis: {
      wordCount: turn.word_count,
      fillerCount: turn.filler_count,
      structureSignals: 0,
      scores: {
        clarity: turn.clarity,
        structure: turn.structure,
        relevance: turn.relevance,
        confidence: turn.confidence,
        conciseness: turn.conciseness,
        overall: turn.overall,
      },
    },
    feedback: {
      strengths: parseArray(turn.strengths_json),
      improvements: parseArray(turn.improvements_json),
      summary: turn.summary,
      followUpPrompt: turn.follow_up_prompt,
    },
    engine: turn.engine,
    warning: turn.warning,
    source: turn.source,
    role: turn.role,
  };
}

function parseArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    return JSON.parse(value || "[]");
  } catch (error) {
    return [];
  }
}

function fluencyFromRow(turn) {
  const pacePenalty = turn.word_count > 0 ? 0 : 25;
  const fillerPenalty = (turn.filler_count || 0) * 6;
  return Math.max(20, Math.min(100, 90 - pacePenalty - fillerPenalty));
}

module.exports = {
  createStoredSession,
  savePracticeResult,
  getHistoryForUser,
  getAnalyticsForUser,
};
