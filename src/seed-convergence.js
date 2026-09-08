import {
  adaptDungenessTrustedExport,
} from "./research-view.js";
import {
  analysisSha256,
  canonicalAnalysisJson,
} from "./representation-study-analysis.js";

export const SEED_CONVERGENCE_EVIDENCE_SCHEMA = "yukon.seed-convergence-evidence.v2";
export const SEED_CONVERGENCE_DECISION_SCHEMA = "yukon.seed-convergence-decision.v2";

const HEX_64 = /^[0-9a-f]{64}$/u;
const DIRECTIONS = new Set(["minimize", "maximize"]);
const DECISIONS = new Set([
  "PASS",
  "ADMIN_RETRY",
  "TASK_REPLACE",
  "APPARATUS_STOP",
  "STUDY_STOP",
]);
const ADMINISTRATIVE_CODES = new Set([
  "lost-host",
  "provider-outage",
  "verifier-service-failure",
]);
const TASK_FAILURE_CODES = new Set([
  "agent-crash",
  "invalid-patch",
  "no-evaluation",
  "treatment-timeout",
  "verification-failure",
]);
const RUN_STATUSES = new Set(["cancelled", "completed", "failed", "not-run"]);
const EXACT_TASK_KEYS = Object.freeze([
  "direction",
  "metricName",
  "officialBaselineScore",
  "reference",
  "startingCandidate",
  "taskId",
]);
const EXACT_SCORE_REFERENCE_KEYS = Object.freeze(["candidateContentSha256", "score", "verifierSha256"]);
const EXACT_OUTCOME_KEYS = Object.freeze([
  "administrativeRetryUsed",
  "eligibleReplacementAvailable",
  "failureCategory",
  "failureCode",
  "status",
]);
const EXACT_CLEAN_KEYS = Object.freeze([
  "candidateArtifactManifestSha256",
  "candidateArtifactRef",
  "candidateContentSha256",
  "evaluationId",
  "score",
  "scoreArtifactSha256",
  "status",
  "verifierSha256",
]);
const EXACT_DECISION_KEYS = Object.freeze([
  "cleanSelection",
  "decision",
  "decisionSha256",
  "execution",
  "experiment",
  "inputHashes",
  "metrics",
  "producerRun",
  "protocolViolations",
  "reasons",
  "runOutcome",
  "schema",
  "taskId",
  "thresholds",
]);
const EXACT_METRIC_KEYS = Object.freeze([
  "capturedEvents",
  "cleanSeedScore",
  "direction",
  "distinctValidCandidateHashes",
  "distinctValidScores",
  "meaningfulGain",
  "officialBaselineScore",
  "officialReferenceGap",
  "referenceScore",
  "remainingHeadroom",
  "seedProgress",
  "selectedCandidateContentSha256",
  "selectedEvaluationId",
  "startingCandidateScore",
  "validEventRate",
  "validNumericEvents",
]);
const EXACT_THRESHOLD_KEYS = Object.freeze([
  "cleanReverificationRequired",
  "maximumProtocolViolations",
  "minimumDistinctValidCandidateHashes",
  "minimumDistinctValidScores",
  "minimumRemainingHeadroom",
  "minimumSeedProgressExclusive",
  "minimumValidEventRate",
  "minimumValidNumericEvents",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireExactKeys(value, keys, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys must be exactly ${expected.join(", ")}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireNullableString(value, label) {
  if (value !== null) requireString(value, label);
  return value;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function requireNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function validateTask(task) {
  requireExactKeys(task, EXACT_TASK_KEYS, "seed evidence.task");
  requireString(task.taskId, "seed evidence.task.taskId");
  requireString(task.metricName, "seed evidence.task.metricName");
  if (!DIRECTIONS.has(task.direction)) throw new Error("seed evidence.task.direction must be minimize or maximize");
  requireFinite(task.officialBaselineScore, "seed evidence.task.officialBaselineScore");
  for (const kind of ["startingCandidate", "reference"]) {
    const record = task[kind];
    requireExactKeys(record, EXACT_SCORE_REFERENCE_KEYS, `seed evidence.task.${kind}`);
    requireFinite(record.score, `seed evidence.task.${kind}.score`);
    if (!HEX_64.test(record.verifierSha256)) throw new Error(`seed evidence.task.${kind}.verifierSha256 is invalid`);
    if (record.candidateContentSha256 !== null && !HEX_64.test(record.candidateContentSha256)) {
      throw new Error(`seed evidence.task.${kind}.candidateContentSha256 is invalid`);
    }
  }
  if (!HEX_64.test(task.startingCandidate.candidateContentSha256)) {
    throw new Error("seed evidence starting candidate hash is required");
  }
  if (task.startingCandidate.verifierSha256 !== task.reference.verifierSha256) {
    throw new Error("seed evidence starting-candidate and reference verifier hashes differ");
  }
  const sign = task.direction === "maximize" ? 1 : -1;
  const officialReferenceGap = sign * (task.reference.score - task.officialBaselineScore);
  if (!(officialReferenceGap > 0)) {
    throw new Error("seed evidence reference must be strictly better than the official baseline");
  }
  return { sign, officialReferenceGap, meaningfulGain: officialReferenceGap * 0.10 };
}

function validateRunOutcome(outcome) {
  requireExactKeys(outcome, EXACT_OUTCOME_KEYS, "seed evidence.runOutcome");
  if (!RUN_STATUSES.has(outcome.status)) throw new Error("seed evidence.runOutcome.status is invalid");
  if (typeof outcome.administrativeRetryUsed !== "boolean"
    || typeof outcome.eligibleReplacementAvailable !== "boolean") {
    throw new Error("seed evidence run outcome control fields must be boolean");
  }
  requireNullableString(outcome.failureCategory, "seed evidence.runOutcome.failureCategory");
  requireNullableString(outcome.failureCode, "seed evidence.runOutcome.failureCode");
  if (outcome.failureCategory === null) {
    if (outcome.failureCode !== null) throw new Error("seed evidence failure code requires a category");
    if (outcome.status !== "completed") throw new Error("non-completed seed outcome requires a failure category");
    return;
  }
  const valid = outcome.failureCategory === "administrative_failure"
    ? ADMINISTRATIVE_CODES.has(outcome.failureCode)
    : outcome.failureCategory === "task_failure"
      ? TASK_FAILURE_CODES.has(outcome.failureCode)
      : outcome.failureCategory === "apparatus_failure" && typeof outcome.failureCode === "string";
  if (!valid) throw new Error("seed evidence failure category/code is invalid");
  if (outcome.failureCategory === "administrative_failure" && outcome.status === "completed") {
    throw new Error("completed seed run cannot be an administrative failure");
  }
}

function validateCleanSelection(selection) {
  if (selection === null) return null;
  requireExactKeys(selection, EXACT_CLEAN_KEYS, "seed evidence.cleanSelection");
  requireString(selection.evaluationId, "seed evidence.cleanSelection.evaluationId");
  if (!["failed", "ok"].includes(selection.status)) throw new Error("seed clean-selection status is invalid");
  for (const field of [
    "candidateArtifactManifestSha256",
    "candidateContentSha256",
    "scoreArtifactSha256",
    "verifierSha256",
  ]) {
    if (selection[field] !== null && !HEX_64.test(selection[field])) {
      throw new Error(`seed evidence.cleanSelection.${field} is invalid`);
    }
  }
  requireNullableString(selection.candidateArtifactRef, "seed evidence.cleanSelection.candidateArtifactRef");
  if (selection.score !== null) requireFinite(selection.score, "seed evidence.cleanSelection.score");
  if (selection.status === "ok") {
    for (const field of [
      "candidateArtifactManifestSha256",
      "candidateArtifactRef",
      "candidateContentSha256",
      "score",
      "scoreArtifactSha256",
      "verifierSha256",
    ]) {
      if (selection[field] === null) throw new Error(`successful clean selection requires ${field}`);
    }
  }
  return selection;
}

function validateEvidence(value) {
  requireExactKeys(
    value,
    [
      "cleanSelection",
      "experiment",
      "producerRun",
      "protocolViolations",
      "runOutcome",
      "schema",
      "task",
      "taskId",
      "trustedExportSha256",
    ],
    "seed convergence evidence",
  );
  if (value.schema !== SEED_CONVERGENCE_EVIDENCE_SCHEMA) throw new Error("unsupported seed-convergence evidence schema");
  requireString(value.experiment, "seed evidence.experiment");
  requireString(value.producerRun, "seed evidence.producerRun");
  requireString(value.taskId, "seed evidence.taskId");
  if (!HEX_64.test(value.trustedExportSha256)) throw new Error("seed evidence trusted-export hash is invalid");
  const taskMath = validateTask(value.task);
  if (value.taskId !== value.task.taskId) throw new Error("seed evidence task IDs differ");
  validateRunOutcome(value.runOutcome);
  const cleanSelection = validateCleanSelection(value.cleanSelection);
  if (!Array.isArray(value.protocolViolations)) throw new Error("seed evidence.protocolViolations must be an array");
  const protocolViolations = value.protocolViolations.map((violation, index) => {
    const label = `seed evidence.protocolViolations[${index}]`;
    requireExactKeys(violation, ["code", "evidenceSha256"], label);
    requireString(violation.code, `${label}.code`);
    if (!HEX_64.test(violation.evidenceSha256)) throw new Error(`${label}.evidenceSha256 is invalid`);
    return violation;
  });
  const codes = protocolViolations.map((violation) => violation.code);
  if (new Set(codes).size !== codes.length) throw new Error("seed evidence repeats a protocol violation code");
  return { taskMath, cleanSelection, protocolViolations };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deterministicBest(events, direction) {
  const valid = events.filter((event) => (
    event.outcome.validity === "valid" && Number.isFinite(event.outcome.score)
  ));
  if (valid.length === 0) return null;
  const sign = direction === "maximize" ? 1 : -1;
  return [...valid].sort((left, right) => (
    sign * (right.outcome.score - left.outcome.score)
    || compareText(left.execution.evaluationId, right.execution.evaluationId)
  ))[0];
}

function taskFailureDecision(replacementAvailable) {
  return replacementAvailable ? "TASK_REPLACE" : "STUDY_STOP";
}

function freezeDecision(core) {
  if (!DECISIONS.has(core.decision)) throw new Error("internal seed decision is invalid");
  return validateSeedConvergenceDecision({
    ...core,
    decisionSha256: analysisSha256(core),
  });
}

export function validateSeedConvergenceDecision(value) {
  requireExactKeys(value, EXACT_DECISION_KEYS, "seed convergence decision");
  if (value.schema !== SEED_CONVERGENCE_DECISION_SCHEMA) throw new Error("unsupported seed-convergence decision schema");
  requireString(value.experiment, "seed decision.experiment");
  requireString(value.taskId, "seed decision.taskId");
  requireString(value.producerRun, "seed decision.producerRun");
  requireExactKeys(value.inputHashes, ["evidenceSha256", "trustedExportSha256"], "seed decision.inputHashes");
  for (const [name, hash] of Object.entries(value.inputHashes)) {
    if (!HEX_64.test(hash)) throw new Error(`seed decision.inputHashes.${name} is invalid`);
  }
  validateRunOutcome(value.runOutcome);
  validateCleanSelection(value.cleanSelection);

  requireExactKeys(value.metrics, EXACT_METRIC_KEYS, "seed decision.metrics");
  for (const name of [
    "capturedEvents",
    "distinctValidCandidateHashes",
    "distinctValidScores",
    "validNumericEvents",
  ]) requireNonnegativeInteger(value.metrics[name], `seed decision.metrics.${name}`);
  if (value.metrics.validNumericEvents > value.metrics.capturedEvents) {
    throw new Error("seed decision valid event count exceeds captured event count");
  }
  if (!Number.isFinite(value.metrics.validEventRate)
    || value.metrics.validEventRate < 0
    || value.metrics.validEventRate > 1) {
    throw new Error("seed decision.metrics.validEventRate must be between zero and one");
  }
  if (!DIRECTIONS.has(value.metrics.direction)) throw new Error("seed decision metric direction is invalid");
  for (const name of [
    "meaningfulGain",
    "officialBaselineScore",
    "officialReferenceGap",
    "referenceScore",
    "startingCandidateScore",
  ]) {
    requireFinite(value.metrics[name], `seed decision.metrics.${name}`);
  }
  for (const name of ["cleanSeedScore", "remainingHeadroom", "seedProgress"]) {
    if (value.metrics[name] !== null) requireFinite(value.metrics[name], `seed decision.metrics.${name}`);
  }
  requireNullableString(value.metrics.selectedEvaluationId, "seed decision.metrics.selectedEvaluationId");
  if (value.metrics.selectedCandidateContentSha256 !== null
    && !HEX_64.test(value.metrics.selectedCandidateContentSha256)) {
    throw new Error("seed decision selected candidate hash is invalid");
  }

  requireExactKeys(value.thresholds, EXACT_THRESHOLD_KEYS, "seed decision.thresholds");
  for (const name of [
    "maximumProtocolViolations",
    "minimumDistinctValidCandidateHashes",
    "minimumDistinctValidScores",
    "minimumValidNumericEvents",
  ]) requireNonnegativeInteger(value.thresholds[name], `seed decision.thresholds.${name}`);
  for (const name of [
    "minimumRemainingHeadroom",
    "minimumSeedProgressExclusive",
    "minimumValidEventRate",
  ]) requireFinite(value.thresholds[name], `seed decision.thresholds.${name}`);
  if (typeof value.thresholds.cleanReverificationRequired !== "boolean") {
    throw new Error("seed decision clean-reverification threshold must be boolean");
  }

  if (!Array.isArray(value.protocolViolations)) throw new Error("seed decision.protocolViolations must be an array");
  value.protocolViolations.forEach((violation, index) => {
    const label = `seed decision.protocolViolations[${index}]`;
    requireExactKeys(violation, ["code", "evidenceSha256"], label);
    requireString(violation.code, `${label}.code`);
    if (!HEX_64.test(violation.evidenceSha256)) throw new Error(`${label}.evidenceSha256 is invalid`);
  });
  requireExactKeys(value.execution, ["modelCalls", "studyRunsStarted"], "seed decision.execution");
  if (value.execution.modelCalls !== 0 || value.execution.studyRunsStarted !== 0) {
    throw new Error("seed decision cannot record model calls or study launches");
  }
  if (!DECISIONS.has(value.decision)) throw new Error("seed decision is invalid");
  if (!Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason !== "string" || reason === "")) {
    throw new Error("seed decision.reasons must be non-empty strings");
  }
  const canonicalReasons = [...new Set(value.reasons)].sort(compareText);
  if (canonicalAnalysisJson(canonicalReasons) !== canonicalAnalysisJson(value.reasons)) {
    throw new Error("seed decision reasons must be unique and sorted");
  }
  if (!HEX_64.test(value.decisionSha256)) throw new Error("seed decision hash is invalid");
  const { decisionSha256, ...core } = value;
  if (analysisSha256(core) !== decisionSha256) throw new Error("seed decision hash does not match its content");
  return value;
}

export function checkSeedConvergence({
  trustedExport,
  evidence,
  trustedExportSha256 = analysisSha256(trustedExport),
  evidenceSha256 = analysisSha256(evidence),
} = {}) {
  const validated = validateEvidence(evidence);
  const adapted = adaptDungenessTrustedExport(trustedExport, {
    sourcePath: "seed-convergence/trusted-export.json",
    sourceSha256: trustedExportSha256,
  });
  const events = adapted.events;
  const validEvents = events.filter((event) => (
    event.outcome.validity === "valid" && Number.isFinite(event.outcome.score)
  ));
  const distinctValidCandidateHashes = new Set(validEvents.map((event) => event.candidateArtifactSha256)).size;
  const distinctValidScores = new Set(validEvents.map((event) => canonicalAnalysisJson(event.outcome.score))).size;
  const validEventRate = events.length === 0 ? 0 : validEvents.length / events.length;
  const best = deterministicBest(events, evidence.task.direction);
  const clean = validated.cleanSelection;
  const integrityReasons = [];
  if (evidence.trustedExportSha256 !== trustedExportSha256) integrityReasons.push("trusted_export_hash_mismatch");
  if (trustedExport.run.ref !== evidence.producerRun) integrityReasons.push("producer_run_identity_mismatch");
  if (trustedExport.seed?.evaluation_baseline?.content_sha256 !== evidence.task.startingCandidate.candidateContentSha256) {
    integrityReasons.push("starting_candidate_hash_mismatch");
  }
  if (adapted.target.taskId !== evidence.taskId) integrityReasons.push("task_identity_mismatch");
  if (adapted.target.metricName !== evidence.task.metricName) integrityReasons.push("metric_identity_mismatch");
  const expectedDirection = evidence.task.direction === "maximize" ? "+" : "-";
  if (adapted.target.direction !== expectedDirection) integrityReasons.push("metric_direction_mismatch");
  if (best !== null && clean !== null) {
    if (best.execution.evaluationId !== clean.evaluationId) integrityReasons.push("selected_evaluation_mismatch");
    if (best.candidateArtifactSha256 !== clean.candidateContentSha256) integrityReasons.push("selected_candidate_hash_mismatch");
  }
  if (clean?.status === "ok") {
    if (clean.verifierSha256 !== evidence.task.startingCandidate.verifierSha256) integrityReasons.push("verifier_hash_mismatch");
    const referenceHash = clean.candidateArtifactRef?.split("/").at(-1);
    if (referenceHash !== clean.candidateContentSha256) integrityReasons.push("candidate_artifact_reference_mismatch");
  }
  const protocolReasons = validated.protocolViolations.map((violation) => `protocol_violation:${violation.code}`);
  const apparatusReasons = [...new Set([
    ...integrityReasons,
    ...protocolReasons,
    ...(evidence.runOutcome.failureCategory === "apparatus_failure"
      ? [`apparatus_failure:${evidence.runOutcome.failureCode}`]
      : []),
  ])].sort(compareText);
  const seedProgress = clean?.status === "ok"
    ? validated.taskMath.sign * (clean.score - evidence.task.startingCandidate.score)
    : null;
  const remainingHeadroom = clean?.status === "ok"
    ? validated.taskMath.sign * (evidence.task.reference.score - clean.score)
    : null;
  const metrics = {
    capturedEvents: events.length,
    validNumericEvents: validEvents.length,
    validEventRate,
    distinctValidCandidateHashes,
    distinctValidScores,
    direction: evidence.task.direction,
    officialBaselineScore: evidence.task.officialBaselineScore,
    startingCandidateScore: evidence.task.startingCandidate.score,
    referenceScore: evidence.task.reference.score,
    cleanSeedScore: clean?.status === "ok" ? clean.score : null,
    officialReferenceGap: validated.taskMath.officialReferenceGap,
    seedProgress,
    meaningfulGain: validated.taskMath.meaningfulGain,
    remainingHeadroom,
    selectedEvaluationId: best?.execution.evaluationId ?? null,
    selectedCandidateContentSha256: best?.candidateArtifactSha256 ?? null,
  };
  const thresholds = {
    minimumValidNumericEvents: 4,
    minimumValidEventRate: 0.5,
    minimumDistinctValidCandidateHashes: 2,
    minimumDistinctValidScores: 2,
    cleanReverificationRequired: true,
    minimumSeedProgressExclusive: 0,
    minimumRemainingHeadroom: validated.taskMath.meaningfulGain,
    maximumProtocolViolations: 0,
  };
  const base = {
    schema: SEED_CONVERGENCE_DECISION_SCHEMA,
    experiment: evidence.experiment,
    taskId: evidence.taskId,
    producerRun: evidence.producerRun,
    inputHashes: { trustedExportSha256, evidenceSha256 },
    runOutcome: evidence.runOutcome,
    cleanSelection: clean,
    metrics,
    thresholds,
    protocolViolations: validated.protocolViolations,
    execution: { modelCalls: 0, studyRunsStarted: 0 },
  };
  if (apparatusReasons.length > 0) {
    return freezeDecision({ ...base, decision: "APPARATUS_STOP", reasons: apparatusReasons });
  }
  if (evidence.runOutcome.failureCategory === "administrative_failure") {
    const decision = evidence.runOutcome.administrativeRetryUsed ? "STUDY_STOP" : "ADMIN_RETRY";
    return freezeDecision({
      ...base,
      decision,
      reasons: [`administrative_failure:${evidence.runOutcome.failureCode}`],
    });
  }
  if (evidence.runOutcome.failureCategory === "task_failure") {
    return freezeDecision({
      ...base,
      decision: taskFailureDecision(evidence.runOutcome.eligibleReplacementAvailable),
      reasons: [`task_failure:${evidence.runOutcome.failureCode}`],
    });
  }
  const failureReasons = [];
  if (validEvents.length < thresholds.minimumValidNumericEvents) failureReasons.push("insufficient_valid_numeric_events");
  if (validEventRate < thresholds.minimumValidEventRate) failureReasons.push("valid_event_rate_below_threshold");
  if (distinctValidCandidateHashes < thresholds.minimumDistinctValidCandidateHashes) failureReasons.push("insufficient_distinct_candidate_hashes");
  if (distinctValidScores < thresholds.minimumDistinctValidScores) failureReasons.push("insufficient_distinct_scores");
  if (best === null) failureReasons.push("no_deterministic_best_candidate");
  if (clean === null || clean.status !== "ok") failureReasons.push("clean_reverification_failed");
  if (!(seedProgress > thresholds.minimumSeedProgressExclusive)) failureReasons.push("no_positive_clean_outer_progress");
  if (!(remainingHeadroom >= thresholds.minimumRemainingHeadroom)) failureReasons.push("insufficient_remaining_headroom");
  if (failureReasons.length > 0) {
    return freezeDecision({
      ...base,
      decision: taskFailureDecision(evidence.runOutcome.eligibleReplacementAvailable),
      reasons: [...new Set(failureReasons)].sort(compareText),
    });
  }
  return freezeDecision({ ...base, decision: "PASS", reasons: [] });
}
