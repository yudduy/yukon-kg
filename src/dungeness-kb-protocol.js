import { ECDSA_USER_CASES } from "./atlas-runtime/index.ts";
import { canonicalStringify, sha256 } from "./protocol.js";

export const DUNGENESS_KB_PROTOCOL_VERSION = "yukon-kg.dungeness-kb.v1";
export const DUNGENESS_KB_SCHEMA = "yukon-kg.dungeness-kb-court";
export const PINNED_OPENROUTER_MODEL = "openai/gpt-5.4";
export const CONTEXT_BYTE_LIMIT = 24_576;
export const RESPONSE_BYTE_LIMIT = 2048;
export const ARMS = Object.freeze(["cold", "raw", "flat", "state_brief", "winner_only"]);
export const PILOT_CASES = ECDSA_USER_CASES;
export const GATE_CASES = Object.freeze(["seed-grinding-mechanism", "largest-isolated-effect"]);

export const RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  json_schema: {
    name: "knowledge_answer",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "rationale"],
      properties: {
        answer: { type: "string" },
        rationale: { type: "string" },
      },
    },
  },
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8Bytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function fitBudget(payload) {
  const text = `${JSON.stringify(payload)}\n`;
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= CONTEXT_BYTE_LIMIT) {
    return { text, truncated: false, bytes: encoded.byteLength };
  }
  let clipped = encoded.subarray(0, CONTEXT_BYTE_LIMIT).toString("utf8");
  while (utf8Bytes(clipped) > CONTEXT_BYTE_LIMIT) {
    clipped = clipped.slice(0, -1);
  }
  return { text: clipped, truncated: true, bytes: utf8Bytes(clipped) };
}

function compactMechanism(item) {
  return {
    ideaId: item.ideaId,
    title: item.title,
    family: item.family,
    evidenceLevel: item.evidenceLevel,
    officialDelta: item.officialDelta,
    toffoliDelta: item.toffoliDelta,
    qubitDelta: item.qubitDelta,
    sourceRefs: item.sourceRefs,
  };
}

export function compileKnowledgeVariants(brief, ideas, submissions) {
  const measuredBounds = brief.boundAndGap
    .filter((item) => item.baseline !== null || item.frontier !== null || item.limitValue !== null)
    .map((item) => ({
      constraintId: item.constraintId,
      label: item.label,
      baseline: item.baseline,
      frontier: item.frontier,
      limitKind: item.limitKind,
      limitValue: item.limitValue,
    }));
  const cold = {
    arm: "cold",
    contract: brief.contract,
  };
  const winner = [...ideas]
    .sort((left, right) => right.aggregate.promoted - left.aggregate.promoted || compareText(left.id, right.id))
    .map((idea) => ({
      id: idea.id,
      name: idea.name,
      family: idea.family,
      promoted: idea.aggregate.promoted,
      attempts: idea.aggregate.attempts,
    }));
  const rawRows = submissions.map((submission) => ({
    id: submission.id,
    status: submission.status,
    score: submission.score,
    changes: submission.changes.map((change) => change.title),
  }));
  const flat = {
    arm: "flat",
    ideas: ideas.map((idea) => ({
      id: idea.id,
      name: idea.name,
      family: idea.family,
      summary: idea.summary,
      promoted: idea.aggregate.promoted,
    })),
  };
  const stateBrief = {
    arm: "state_brief",
    contract: brief.contract,
    bounds: measuredBounds,
    frontier: brief.currentFrontier[0] ?? null,
    admittedEffects: brief.supportedMechanisms.map(compactMechanism),
    openCuts: brief.nextDiscriminators.map((item) => ({
      discriminatorId: item.discriminatorId,
      status: item.status,
      question: item.question,
      predictedDistinction: item.predictedDistinction,
    })),
    hazards: brief.evaluatorHazards.map((item) => ({
      hazardId: item.hazardId,
      title: item.title,
      count: item.count,
      why: item.why,
    })),
    negativeKnowledge: brief.negativeKnowledge.map((item) => ({
      ideaId: item.ideaId,
      title: item.title,
      family: item.family,
      submissions: item.submissions,
      promoted: item.promoted,
      why: item.why,
      reopenCondition: item.reopenCondition,
    })),
  };
  const payloads = {
    cold,
    raw: { arm: "raw", submissions: rawRows },
    flat,
    state_brief: stateBrief,
    winner_only: { arm: "winner_only", ideas: winner },
  };
  return Object.fromEntries(ARMS.map((arm) => {
    const fitted = fitBudget(payloads[arm]);
    return [arm, {
      arm,
      protocolVersion: DUNGENESS_KB_PROTOCOL_VERSION,
      sha256: sha256(fitted.text),
      truncated: fitted.truncated,
      bytes: fitted.bytes,
      text: fitted.text,
    }];
  }));
}

export function goldNeedles(userCase) {
  const needles = [userCase.gold.label];
  if (userCase.gold.ideaId) needles.push(userCase.gold.ideaId);
  if (userCase.gold.hazardId) needles.push(userCase.gold.hazardId);
  if (userCase.gold.constraintId) needles.push(userCase.gold.constraintId);
  if (userCase.gold.discriminatorId) needles.push(userCase.gold.discriminatorId);
  if (userCase.id === "seed-grinding-mechanism") needles.push("Nonce / seed grinding", "seed-grinding");
  if (userCase.id === "toffoli-can-rise") needles.push("Solinas");
  if (userCase.id === "frontier-mixed") needles.push("mixed");
  if (userCase.id === "next-untried") needles.push("Barrett");
  return needles;
}

export function variantContainsNeedles(variantText, userCase) {
  return goldNeedles(userCase).some((needle) => variantText.includes(String(needle)));
}

export function claimedArmsForCase(userCase) {
  if (userCase.id === "largest-isolated-effect") {
    return ["state_brief", "flat"];
  }
  return ["state_brief"];
}

export function analyzeReachability(variants) {
  return PILOT_CASES.map((userCase) => {
    const perArm = Object.fromEntries(ARMS.map((arm) => [
      arm,
      variantContainsNeedles(variants[arm].text, userCase),
    ]));
    const claimed = claimedArmsForCase(userCase);
    const missing = claimed.filter((arm) => !perArm[arm]);
    return { caseId: userCase.id, perArm, claimed, ok: missing.length === 0, missing };
  });
}

function normalizeAnswer(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function parseModelAnswer(content) {
  const trimmed = String(content ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.answer === "string") {
      return { answer: parsed.answer, rationale: typeof parsed.rationale === "string" ? parsed.rationale : "" };
    }
  } catch {
    // fall through
  }
  return { answer: trimmed, rationale: "" };
}

export function scoreAnswer(answer, userCase) {
  const actual = normalizeAnswer(answer);
  const gold = normalizeAnswer(userCase.gold.label);
  if (actual === gold) return true;
  if (gold === "yes" && /^(yes|true)$/u.test(actual)) return true;
  if (gold === "no" && /^(no|false)$/u.test(actual)) return true;
  if (gold.length > 0 && (actual.includes(gold) || gold.includes(actual))) return true;
  if (userCase.id === "next-untried" && actual.includes("barrett")) return true;
  if (userCase.id === "largest-isolated-effect" && actual.includes("adaptive phase")) return true;
  if (userCase.gold.ideaId && actual.includes(normalizeAnswer(userCase.gold.ideaId))) return true;
  return false;
}

export function scorePilot(results) {
  const byArm = Object.fromEntries(ARMS.map((arm) => {
    const rows = results.filter((row) => row.arm === arm);
    return [arm, {
      cases: rows.length,
      passed: rows.filter((row) => row.pass).length,
      rows,
    }];
  }));
  const state = byArm.state_brief.rows;
  const winners = byArm.winner_only.rows;
  const gate = GATE_CASES.map((caseId) => {
    const briefRow = state.find((row) => row.caseId === caseId);
    const winnerRow = winners.find((row) => row.caseId === caseId);
    return {
      caseId,
      state_brief: briefRow?.pass === true,
      winner_only: winnerRow?.pass === true,
    };
  });
  const missed = state.filter((row) => row.pass !== true).map((row) => row.caseId);
  const gateCleared = gate.every((item) => item.state_brief && !item.winner_only);
  const adopted = gateCleared && missed.length === 0 ? "state_brief" : null;
  return {
    protocolVersion: DUNGENESS_KB_PROTOCOL_VERSION,
    totals: Object.fromEntries(ARMS.map((arm) => [arm, {
      cases: byArm[arm].cases,
      passed: byArm[arm].passed,
    }])),
    gate,
    missed,
    adopted,
    reason: adopted === "state_brief"
      ? "state_brief answered every frozen knowledge question and beat winner_only on mechanism identity."
      : gateCleared
        ? `state_brief beat winner_only on mechanism identity but missed ${missed.join(", ")}.`
        : "state_brief did not clear the preregistered gate against winner_only.",
  };
}

export function systemPrompt() {
  return [
    "You are answering factual questions about a sealed ECDSA.fail research snapshot.",
    "Use only the knowledge packet. Do not recommend a next experiment.",
    "Reply with JSON: {\"answer\":\"...\",\"rationale\":\"...\"}.",
    "Keep answers short: yes/no, a number, or a mechanism name.",
  ].join(" ");
}

export function userPrompt(variantText, userCase) {
  return `Knowledge packet:\n${variantText}\n\nQuestion: ${userCase.question}\nCase id: ${userCase.id}`;
}

export { canonicalStringify, sha256, ECDSA_USER_CASES };
