import { ECDSA_USER_CASES } from "./atlas-runtime/index.ts";
import { canonicalStringify, sha256 } from "./protocol.js";

export const DUNGENESS_KB_PROTOCOL_VERSION = "yukon-kg.dungeness-kb.v2";
export const DUNGENESS_KB_SCHEMA = "yukon-kg.dungeness-kb-court";
export const PINNED_OPENROUTER_MODEL = "openai/gpt-5.4";
export const CONTEXT_BYTE_LIMIT = 24_576;
export const RESPONSE_BYTE_LIMIT = 2048;
export const ARMS = Object.freeze(["cold", "raw", "flat", "state_brief", "winner_only"]);
export const PILOT_CASES = ECDSA_USER_CASES;
export const GATE_CASES = Object.freeze(["seed-grinding-mechanism", "largest-isolated-effect"]);
export const OPENROUTER_DECODING = Object.freeze({
  temperature: 0,
  maxTokens: 384,
});

export const RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  json_schema: {
    name: "knowledge_answer",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "rationale", "sourceRefs"],
      properties: {
        answer: { type: "string", minLength: 1 },
        rationale: { type: "string" },
        sourceRefs: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
      },
    },
  },
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deterministicShuffle(items, seed) {
  return [...items].sort((left, right) => compareText(
    sha256(`${seed}\0${canonicalStringify(left)}`),
    sha256(`${seed}\0${canonicalStringify(right)}`),
  ));
}

function utf8Bytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function fitBudget(payload) {
  const encode = (value) => `${JSON.stringify(value)}\n`;
  const text = encode(payload);
  if (utf8Bytes(text) <= CONTEXT_BYTE_LIMIT) {
    return { text, truncated: false, bytes: utf8Bytes(text) };
  }
  const arrayKey = Object.keys(payload).find((key) => Array.isArray(payload[key]));
  if (arrayKey === undefined) throw new Error("oversized packet has no record array to truncate safely");
  const records = payload[arrayKey];
  let low = 0;
  let high = records.length;
  let fitted = null;
  while (low <= high) {
    const retained = Math.floor((low + high) / 2);
    const candidate = {
      ...payload,
      [arrayKey]: records.slice(0, retained),
      truncation: {
        field: arrayKey,
        retainedItems: retained,
        totalItems: records.length,
      },
    };
    const candidateText = encode(candidate);
    if (utf8Bytes(candidateText) <= CONTEXT_BYTE_LIMIT) {
      fitted = candidateText;
      low = retained + 1;
    } else {
      high = retained - 1;
    }
  }
  if (fitted === null) throw new Error("packet metadata exceeds the context byte limit");
  JSON.parse(fitted);
  return { text: fitted, truncated: true, bytes: utf8Bytes(fitted) };
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
      sourceRefs: [item.constraintId, ...item.evidenceRefs],
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
      sourceRefs: [`idea:${idea.id}`],
    }));
  const rawRows = submissions.map((submission) => ({
    id: submission.id,
    status: submission.status,
    score: submission.score,
    changes: submission.changes.map((change) => change.title),
    sourceRefs: [`submission:${submission.id}`],
  }));
  const flat = {
    arm: "flat",
    ideas: ideas.map((idea) => ({
      id: idea.id,
      name: idea.name,
      family: idea.family,
      summary: idea.summary,
      promoted: idea.aggregate.promoted,
      sourceRefs: [`idea:${idea.id}`],
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
      verification: item.verification,
      sourceRefs: [item.discriminatorId, ...item.sourceRefs],
    })),
    hazards: brief.evaluatorHazards.map((item) => ({
      hazardId: item.hazardId,
      title: item.title,
      count: item.count,
      why: item.why,
      sourceRefs: [item.hazardId, ...item.sourceRefs],
    })),
    negativeKnowledge: brief.negativeKnowledge.map((item) => ({
      ideaId: item.ideaId,
      title: item.title,
      family: item.family,
      experimentId: item.experimentId,
      comparisonId: item.comparisonId,
      officialDelta: item.officialDelta,
      why: item.why,
      reopenCondition: item.reopenCondition,
      sourceRefs: item.sourceRefs,
    })),
    coverageSignals: brief.coverageSignals.map((item) => ({
      ideaId: item.ideaId,
      title: item.title,
      family: item.family,
      status: item.status,
      submissions: item.submissions,
      promoted: item.promoted,
      why: item.why,
      sourceRefs: item.sourceRefs,
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

function directRefFor(kind, item) {
  if (kind === "bound") return item.constraintId;
  if (kind === "frontier") return `submission:${item.submissionId}`;
  if (kind === "mechanism" || kind === "coverage") return `idea:${item.ideaId}`;
  if (kind === "negative") return `comparison:${item.comparisonId}`;
  if (kind === "hazard") return item.hazardId;
  if (kind === "discriminator") return item.discriminatorId;
  throw new Error(`unknown evidence kind ${kind}`);
}

export function buildKnowledgeEvidenceIndex(brief) {
  const bySourceRef = new Map();
  const directSourceRefs = new Set();
  const records = [];
  const add = (kind, item, sourceRefs) => {
    const directRef = directRefFor(kind, item);
    const record = { kind, item, directRef };
    records.push(record);
    directSourceRefs.add(directRef);
    for (const sourceRef of new Set([directRef, ...sourceRefs])) {
      const linked = bySourceRef.get(sourceRef) ?? [];
      linked.push(record);
      bySourceRef.set(sourceRef, linked);
    }
  };
  for (const item of brief.boundAndGap) add("bound", item, item.evidenceRefs);
  for (const item of brief.currentFrontier) add("frontier", item, item.sourceRefs);
  for (const item of brief.supportedMechanisms) add("mechanism", item, item.sourceRefs);
  for (const item of brief.coverageSignals) add("coverage", item, item.sourceRefs);
  for (const item of brief.negativeKnowledge) add("negative", item, item.sourceRefs);
  for (const item of brief.evaluatorHazards) add("hazard", item, item.sourceRefs);
  for (const item of brief.nextDiscriminators) add("discriminator", item, item.sourceRefs);
  return { brief, records, bySourceRef, directSourceRefs };
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
  if (userCase.id === "representation-proposal") needles.push("Barrett", "half-GCD");
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
  if (utf8Bytes(trimmed) > RESPONSE_BYTE_LIMIT) {
    return {
      answer: "",
      rationale: "",
      sourceRefs: [],
      valid: false,
      error: `response exceeds ${RESPONSE_BYTE_LIMIT} bytes`,
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    const exactKeys = parsed !== null
      && typeof parsed === "object"
      && Object.keys(parsed).sort().join(",") === "answer,rationale,sourceRefs";
    const sourceRefs = Array.isArray(parsed?.sourceRefs)
      ? parsed.sourceRefs.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    if (
      exactKeys
      && typeof parsed.answer === "string"
      && parsed.answer.trim().length > 0
      && typeof parsed.rationale === "string"
      && sourceRefs.length === parsed.sourceRefs.length
      && sourceRefs.length > 0
      && new Set(sourceRefs).size === sourceRefs.length
    ) {
      return {
        answer: parsed.answer.trim(),
        rationale: parsed.rationale,
        sourceRefs,
        valid: true,
        error: null,
      };
    }
    return {
      answer: typeof parsed?.answer === "string" ? parsed.answer.trim() : "",
      rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
      sourceRefs,
      valid: false,
      error: "response does not match the strict knowledge-answer schema",
    };
  } catch (error) {
    return {
      answer: "",
      rationale: "",
      sourceRefs: [],
      valid: false,
      error: `response is not valid JSON: ${error.message}`,
    };
  }
}

export function scoreAnswer(answer, userCase) {
  const actual = normalizeAnswer(answer);
  const gold = normalizeAnswer(userCase.gold.label);
  if (actual.length === 0 || gold.length === 0) return false;
  if (actual === gold) return true;
  if (gold === "yes" && /^(yes|true)(?:\s|$)/u.test(actual)) return true;
  if (gold === "no" && /^(no|false)(?:\s|$)/u.test(actual)) return true;
  if (userCase.id === "representation-proposal") {
    return actual.includes("barrett") || actual.includes("half gcd") || actual.includes("disc half gcd");
  }
  if (userCase.id === "largest-isolated-effect" && actual.includes("adaptive phase")) return true;
  if (userCase.gold.ideaId && actual.includes(normalizeAnswer(userCase.gold.ideaId))) return true;
  return false;
}

function recordSupportsCase(record, userCase, brief) {
  if (userCase.id === "seed-grinding-mechanism") {
    return record.kind === "hazard"
      && record.item.hazardId === userCase.gold.hazardId
      && !brief.supportedMechanisms.some((item) => item.ideaId.includes("seed-grinding"));
  }
  if (userCase.id === "largest-isolated-effect") {
    return record.kind === "mechanism"
      && record.item.ideaId === userCase.gold.ideaId
      && record.item.officialDelta === Math.min(...brief.supportedMechanisms.map((item) => item.officialDelta));
  }
  if (userCase.id === "karatsuba-isolated") {
    return record.kind === "discriminator"
      && record.item.status === "historical_only"
      && `${record.item.discriminatorId} ${record.item.question}`.toLowerCase().includes("karatsuba");
  }
  if (userCase.id === "fermat-controlled-negative") {
    return record.kind === "coverage"
      && record.item.ideaId === userCase.gold.ideaId
      && !brief.negativeKnowledge.some((item) => item.ideaId === userCase.gold.ideaId);
  }
  if (userCase.id === "toffoli-can-rise") {
    return record.kind === "mechanism"
      && record.item.ideaId === userCase.gold.ideaId
      && record.item.toffoliDelta > 0
      && record.item.officialDelta < 0;
  }
  if (userCase.id === "qubit-floor") {
    return record.kind === "bound"
      && record.item.constraintId === userCase.gold.constraintId
      && String(record.item.limitValue) === userCase.gold.label;
  }
  if (userCase.id === "frontier-mixed") {
    return record.kind === "frontier" && record.item.interpretation === userCase.gold.interpretation;
  }
  if (userCase.id === "representation-proposal") {
    const acceptable = new Set(userCase.gold.acceptableDiscriminatorIds ?? []);
    return record.kind === "discriminator"
      && acceptable.has(record.item.discriminatorId)
      && (record.item.status === "proposed_unverified" || record.item.status === "no_qualifying_receipt");
  }
  return false;
}

export function scoreKnowledgeAnswer(response, userCase, evidenceIndex) {
  const failures = [];
  if (!response.valid) failures.push(response.error ?? "invalid response");
  const decisionCorrect = scoreAnswer(response.answer, userCase);
  if (!decisionCorrect) failures.push("answer differs from the accepted case answer");
  let fabricated = false;
  const directlyCited = [];
  for (const sourceRef of response.sourceRefs) {
    const records = evidenceIndex.bySourceRef.get(sourceRef);
    if (records === undefined) {
      fabricated = true;
      continue;
    }
    if (evidenceIndex.directSourceRefs.has(sourceRef)) {
      directlyCited.push(...records.filter((record) => record.directRef === sourceRef));
    }
  }
  if (fabricated) failures.push("response contains an unknown source reference");
  const citationCorrect = directlyCited.some((record) => (
    recordSupportsCase(record, userCase, evidenceIndex.brief)
  ));
  if (!citationCorrect) failures.push("response cites no record satisfying the case predicate");
  return {
    pass: response.valid && decisionCorrect && citationCorrect && !fabricated,
    decisionCorrect,
    citationCorrect,
    fabricated,
    failures: [...new Set(failures)],
  };
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
    "Reply with JSON: {\"answer\":\"...\",\"rationale\":\"...\",\"sourceRefs\":[\"...\"]}.",
    "Cite at least one exact sourceRefs value from the packet that directly supports the answer.",
    "Keep answers short: yes/no, a number, or a mechanism name.",
  ].join(" ");
}

export function userPrompt(variantText, userCase) {
  return `Knowledge packet:\n${variantText}\n\nQuestion: ${userCase.question}\nCase id: ${userCase.id}`;
}

export { canonicalStringify, sha256, ECDSA_USER_CASES };
