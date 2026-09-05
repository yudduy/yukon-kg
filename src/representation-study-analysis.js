import { createHash } from "node:crypto";
import {
  REPRESENTATION_BUDGET_FRACTIONS,
  assessConfirmatoryWinner,
  assessRepresentationPilot,
  meaningfulGainFromReference,
  milestoneProgressAuc,
  prepareConfirmatoryContrasts,
  taskEqualMean,
  withinBlockMaxTPermutation,
} from "./representation-study-statistics.js";

export const TASK_REFERENCE_SCHEMA = "yukon.representation-task-references.v2";
export const TASK_REFERENCE_SCHEMA_V3 = "yukon.representation-task-references.v3";
export const HOST_ASSIGNMENT_SCHEMA = "yukon.representation-host-assignment.v1";
export const ANALYSIS_SCHEMA = "yukon.representation-analysis.v3";
export const CONFIRMATORY_POOL_SCHEMA = "yukon.confirmatory-task-pool.v1";
export const CONFIRMATORY_SELECTION_SCHEMA = "yukon.confirmatory-task-selection.v1";

const HEX_64 = /^[0-9a-f]{64}$/u;
const REPRESENTATIONS = Object.freeze(["R0", "R1", "R2"]);
const RANDOMIZATION_ALGORITHMS = new Set([
  "sha256-sort-v1",
  "sha256-sort-v1-with-apparatus-replacements",
]);
const EXPECTED_PERCENTS = Object.freeze([0, 25, 50, 75, 100]);
const DIRECTIONS = new Set(["minimize", "maximize"]);
const TREATMENT_FAILURE_CODES = new Set([
  "agent-crash",
  "invalid-patch",
  "no-evaluation",
  "treatment-timeout",
  "verification-failure",
]);
const ADMINISTRATIVE_FAILURE_CODES = new Set([
  "lost-host",
  "provider-outage",
  "verifier-service-failure",
]);
const CONTRASTS = Object.freeze([
  Object.freeze({ id: "R1-R0", treatment: "R1", control: "R0" }),
  Object.freeze({ id: "R2-R1", treatment: "R2", control: "R1" }),
  Object.freeze({ id: "R2-R0", treatment: "R2", control: "R0" }),
]);
const PILOT_CONTRAST_IDS = Object.freeze(["R1-R0", "R2-R0"]);
const CONFIRMATORY_CATEGORIES = Object.freeze([
  "search_learning",
  "symbolic_combinatorial",
  "systems_optimization",
]);
const SELECTION_GATE_KEYS = Object.freeze([
  "digest_pinning",
  "headroom",
  "leakage",
  "license",
  "runtime",
  "valid_event_rate",
  "verifier_stability",
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
}

function requireExactKeys(value, keys, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys must be exactly ${expected.join(", ")}`);
  }
}

function canonicalValue(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${label}[${index}]`));
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new Error(`${label}.${key} is undefined`);
      return [key, canonicalValue(value[key], `${label}.${key}`)];
    }));
  }
  throw new Error(`${label} is not canonical JSON data`);
}

export function canonicalAnalysisJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function analysisSha256(value) {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : canonicalAnalysisJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function assertNoBlindedLeakage(value, label = "blinded results") {
  const forbidden = new Set(["renderer", "representation", "research_view", "treatment"]);
  const visit = (item, path) => {
    if (Array.isArray(item)) return item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (!isObject(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key.toLowerCase())) throw new Error(`${label} leaks ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, label);
}

function validateTaskReferences(value) {
  requireExactKeys(value, ["experiment", "schema", "tasks"], "task references");
  if (![TASK_REFERENCE_SCHEMA, TASK_REFERENCE_SCHEMA_V3].includes(value.schema)) {
    throw new Error("unsupported task-reference schema");
  }
  requireString(value.experiment, "task references.experiment");
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) throw new Error("task references.tasks must be non-empty");
  const tasks = new Map();
  for (const [index, task] of value.tasks.entries()) {
    const label = `task references.tasks[${index}]`;
    const historySpecific = value.schema === TASK_REFERENCE_SCHEMA_V3;
    requireExactKeys(task, historySpecific
      ? ["direction", "metricName", "officialBaselineScore", "reference", "startingCandidates", "taskId"]
      : ["direction", "metricName", "officialBaselineScore", "reference", "startingCandidate", "taskId"], label);
    const taskId = requireString(task.taskId, `${label}.taskId`);
    if (tasks.has(taskId)) throw new Error(`duplicate task reference ${taskId}`);
    requireString(task.metricName, `${label}.metricName`);
    if (!DIRECTIONS.has(task.direction)) throw new Error(`${label}.direction must be minimize or maximize`);
    requireFinite(task.officialBaselineScore, `${label}.officialBaselineScore`);
    requireExactKeys(task.reference, ["candidateContentSha256", "score", "verifierSha256"], `${label}.reference`);
    const startingCandidates = historySpecific ? task.startingCandidates : [task.startingCandidate];
    if (!Array.isArray(startingCandidates) || startingCandidates.length === 0) {
      throw new Error(`${label}.startingCandidates must be non-empty`);
    }
    const startingCandidatesByHistory = new Map();
    for (const [candidateIndex, record] of startingCandidates.entries()) {
      const kind = historySpecific ? `startingCandidates[${candidateIndex}]` : "startingCandidate";
      requireExactKeys(record, historySpecific
        ? ["candidateContentSha256", "historyId", "score", "verifierSha256"]
        : ["candidateContentSha256", "score", "verifierSha256"], `${label}.${kind}`);
      requireFinite(record.score, `${label}.${kind}.score`);
      if (!HEX_64.test(record.verifierSha256)) throw new Error(`${label}.${kind}.verifierSha256 is invalid`);
      if (!HEX_64.test(record.candidateContentSha256)) {
        throw new Error(`${label}.${kind}.candidateContentSha256 is invalid`);
      }
      const historyId = historySpecific
        ? requireString(record.historyId, `${label}.${kind}.historyId`)
        : null;
      if (startingCandidatesByHistory.has(historyId)) {
        throw new Error(`${label} repeats starting candidate history ${historyId}`);
      }
      if (task.reference.verifierSha256 !== record.verifierSha256) {
        throw new Error(`${label} starting candidate and reference use different verifiers`);
      }
      startingCandidatesByHistory.set(historyId, record);
    }
    requireFinite(task.reference.score, `${label}.reference.score`);
    if (!HEX_64.test(task.reference.verifierSha256)) throw new Error(`${label}.reference.verifierSha256 is invalid`);
    if (task.reference.candidateContentSha256 !== null && !HEX_64.test(task.reference.candidateContentSha256)) {
      throw new Error(`${label}.reference.candidateContentSha256 is invalid`);
    }
    const meaningfulGain = meaningfulGainFromReference({
      baselineScore: task.officialBaselineScore,
      referenceScore: task.reference.score,
      direction: task.direction,
    });
    tasks.set(taskId, { ...task, meaningfulGain, startingCandidatesByHistory });
  }
  return { experiment: value.experiment, tasks };
}

function validateBlindedResults(value) {
  assertNoBlindedLeakage(value);
  requireExactKeys(
    value,
    ["assignment_sha256", "experiment", "rows", "schema_version", "type"],
    "blinded results",
  );
  if (value.schema_version !== 1 || value.type !== "blinded-randomized-block-results") {
    throw new Error("unsupported blinded-results schema");
  }
  requireString(value.experiment, "blinded results.experiment");
  if (!HEX_64.test(value.assignment_sha256)) throw new Error("blinded results assignment hash is invalid");
  if (!Array.isArray(value.rows) || value.rows.length === 0) throw new Error("blinded results.rows must be non-empty");
  const rows = new Map();
  for (const [index, row] of value.rows.entries()) {
    const label = `blinded results.rows[${index}]`;
    requireObject(row, label);
    const cellId = requireString(row.cell_id, `${label}.cell_id`);
    if (rows.has(cellId)) throw new Error(`duplicate blinded result ${cellId}`);
    requireString(row.block_id, `${label}.block_id`);
    requireInteger(row.slot, `${label}.slot`);
    requireInteger(row.repetition, `${label}.repetition`);
    requireString(row.status, `${label}.status`);
    if (row.milestones !== undefined && !Array.isArray(row.milestones)) throw new Error(`${label}.milestones must be an array`);
    rows.set(cellId, row);
  }
  return { experiment: value.experiment, assignmentSha256: value.assignment_sha256, rows };
}

function validateHostAssignment(value, resultsSha256, expectedExperiment) {
  requireObject(value, "host assignment");
  let assignment;
  let classificationsInput;
  let experiment;
  if (value.schema === HOST_ASSIGNMENT_SCHEMA) {
    requireExactKeys(
      value,
      ["assignment", "experiment", "failureClassifications", "schema"],
      "host assignment",
    );
    experiment = requireString(value.experiment, "host assignment.experiment");
    assignment = requireObject(value.assignment, "host assignment.assignment");
    classificationsInput = value.failureClassifications;
  } else {
    assignment = value;
    experiment = expectedExperiment;
    classificationsInput = value.failure_classifications ?? [];
  }
  if (!RANDOMIZATION_ALGORITHMS.has(assignment.algorithm)) {
    throw new Error("host assignment uses another randomization algorithm");
  }
  if (!HEX_64.test(assignment.execution_order_sha256)) throw new Error("host assignment execution-order hash is invalid");
  if (!Array.isArray(assignment.cells) || assignment.cells.length === 0) throw new Error("host assignment cells must be non-empty");
  const cells = new Map();
  for (const [index, cell] of assignment.cells.entries()) {
    const label = `host assignment.cells[${index}]`;
    requireObject(cell, label);
    const cellId = requireString(cell.cell_id, `${label}.cell_id`);
    if (cells.has(cellId)) throw new Error(`duplicate assignment cell ${cellId}`);
    for (const field of ["block_id", "agent", "task", "checkpoint", "candidate_artifact"]) {
      requireString(cell[field], `${label}.${field}`);
    }
    requireInteger(cell.repetition, `${label}.repetition`);
    requireInteger(cell.slot, `${label}.slot`);
    if (!REPRESENTATIONS.includes(cell.treatment)) throw new Error(`${label}.treatment is invalid`);
    if (cell.administrative_replacement_for !== undefined && cell.administrative_replacement_for !== null) {
      requireString(cell.administrative_replacement_for, `${label}.administrative_replacement_for`);
    }
    cells.set(cellId, cell);
  }
  if (!Array.isArray(classificationsInput)) {
    throw new Error("host assignment.failureClassifications must be an array");
  }
  const classifications = new Map();
  for (const [index, classification] of classificationsInput.entries()) {
    const label = `host assignment.failureClassifications[${index}]`;
    requireExactKeys(
      classification,
      ["blindedResultsSha256", "category", "cellId", "code"],
      label,
    );
    const cellId = requireString(classification.cellId, `${label}.cellId`);
    if (!cells.has(cellId)) throw new Error(`${label} names an unknown cell`);
    if (classifications.has(cellId)) throw new Error(`duplicate failure classification ${cellId}`);
    if (classification.blindedResultsSha256 !== resultsSha256) {
      throw new Error(`${label} was not frozen against these blinded results`);
    }
    const allowed = classification.category === "treatment_failure"
      ? TREATMENT_FAILURE_CODES
      : classification.category === "administrative_failure"
        ? ADMINISTRATIVE_FAILURE_CODES
        : null;
    if (allowed === null || !allowed.has(classification.code)) {
      throw new Error(`${label} has an invalid category/code combination`);
    }
    classifications.set(cellId, classification);
  }
  return { assignment, cells, classifications, experiment };
}

function candidateHashFromReference(reference, label) {
  const hash = requireString(reference, label).split("/").at(-1);
  if (!HEX_64.test(hash)) throw new Error(`${label} does not end in a content hash`);
  return hash;
}

function startingCandidateForHistory(task, historyId) {
  const candidate = task.startingCandidatesByHistory.get(historyId)
    ?? task.startingCandidatesByHistory.get(null);
  if (candidate === undefined) {
    throw new Error(`task ${task.taskId} has no frozen starting candidate for history ${historyId}`);
  }
  return candidate;
}

function validMilestone(milestone, startingCandidate, label) {
  requireObject(milestone, label);
  if (!EXPECTED_PERCENTS.includes(milestone.percent)) throw new Error(`${label}.percent is not frozen`);
  if (!HEX_64.test(milestone.candidate_content_sha256)) throw new Error(`${label} candidate hash is invalid`);
  if (milestone.verifier_sha256 !== startingCandidate.verifierSha256) throw new Error(`${label} verifier hash changed`);
  const verification = requireObject(milestone.verification, `${label}.verification`);
  if (verification.status !== "ok" || !Number.isFinite(verification.score)) return null;
  return { fraction: milestone.percent / 100, score: verification.score, status: "valid" };
}

function outcomeForCell(cell, result, task, classification) {
  const startingCandidate = startingCandidateForHistory(task, cell.block_id);
  const authored = result.milestones ?? [];
  const byPercent = new Map();
  for (const [index, milestone] of authored.entries()) {
    requireObject(milestone, `result ${cell.cell_id}.milestones[${index}]`);
    if (byPercent.has(milestone.percent)) throw new Error(`result ${cell.cell_id} repeats milestone ${milestone.percent}`);
    byPercent.set(milestone.percent, milestone);
  }
  const validByPercent = new Map();
  for (const percent of EXPECTED_PERCENTS) {
    const milestone = byPercent.get(percent);
    if (milestone !== undefined) {
      validByPercent.set(percent, validMilestone(
        milestone,
        startingCandidate,
        `result ${cell.cell_id} milestone ${percent}`,
      ));
    }
  }
  if (byPercent.size !== validByPercent.size) throw new Error(`result ${cell.cell_id} contains an unfrozen milestone`);
  const baselineCandidate = candidateHashFromReference(cell.candidate_artifact, `cell ${cell.cell_id}.candidate_artifact`);
  if (baselineCandidate !== startingCandidate.candidateContentSha256) {
    throw new Error(`cell ${cell.cell_id} candidate differs from its frozen starting candidate`);
  }
  const zero = byPercent.get(0);
  if (zero !== undefined) {
    const zeroValid = validByPercent.get(0);
    if (zeroValid === null || zero.candidate_content_sha256 !== startingCandidate.candidateContentSha256
      || zeroValid.score !== startingCandidate.score) {
      throw new Error(`result ${cell.cell_id} zero milestone differs from its frozen starting candidate`);
    }
  }
  if (classification?.category === "administrative_failure") {
    return { eligible: false, classification, milestones: [] };
  }
  const milestones = [];
  for (const percent of EXPECTED_PERCENTS) {
    const observed = validByPercent.get(percent);
    if (percent === 0 && observed === undefined) {
      milestones.push({ fraction: 0, score: startingCandidate.score, status: "valid" });
      continue;
    }
    if (observed !== undefined && observed !== null) {
      milestones.push(observed);
      continue;
    }
    if (classification?.category !== "treatment_failure") {
      throw new Error(`result ${cell.cell_id} requires a frozen failure classification`);
    }
    milestones.push({ fraction: percent / 100, status: "treatment_failure" });
  }
  if (classification === undefined) {
    if (result.status !== "completed") throw new Error(`result ${cell.cell_id} is not completed or classified`);
    if (milestones.some((milestone) => milestone.status !== "valid")) {
      throw new Error(`result ${cell.cell_id} has invalid unclassified milestones`);
    }
  }
  const outcome = milestoneProgressAuc({
    baselineScore: startingCandidate.score,
    meaningfulGain: task.meaningfulGain,
    direction: task.direction,
    milestones,
    expectedFractions: REPRESENTATION_BUDGET_FRACTIONS,
  });
  return {
    ...outcome,
    officialBaselineScore: task.officialBaselineScore,
    startingCandidateScore: startingCandidate.score,
    referenceScore: task.reference.score,
    meaningfulGain: task.meaningfulGain,
    classification: classification ?? null,
    milestones,
  };
}

function validateFailureEvidence(result, classification, cellId) {
  if (classification === undefined) return;
  const rounds = Array.isArray(result.rounds) ? result.rounds : [];
  const evaluationCount = rounds.reduce((total, round) => (
    total + (Number.isInteger(round?.evaluation_count) ? round.evaluation_count : 0)
  ), 0);
  const nonterminal = result.status !== "completed";
  if (classification.category === "administrative_failure") {
    if (!nonterminal) throw new Error(`administrative failure ${cellId} has a completed chain result`);
    return;
  }
  const milestones = Array.isArray(result.milestones) ? result.milestones : [];
  const hasFailedVerification = milestones.some((milestone) => (
    isObject(milestone?.verification) && milestone.verification.status !== "ok"
  ));
  const supported = {
    "agent-crash": nonterminal || rounds.some((round) => ["failed", "cancelled"].includes(round?.status)),
    "invalid-patch": evaluationCount > 0 && rounds.every((round) => round?.selected_development_evaluation == null),
    "no-evaluation": evaluationCount === 0,
    "treatment-timeout": nonterminal || rounds.some((round) => ["failed", "cancelled"].includes(round?.status)),
    "verification-failure": hasFailedVerification,
  }[classification.code];
  if (!supported) throw new Error(`failure classification ${cellId}/${classification.code} is unsupported by blinded evidence`);
}

function resolveActiveCells(host, blinded, tasks) {
  const assignmentIds = [...host.cells.keys()].sort();
  const resultIds = [...blinded.rows.keys()].sort();
  if (JSON.stringify(assignmentIds) !== JSON.stringify(resultIds)) {
    throw new Error("host assignment and blinded results contain different cell IDs");
  }
  for (const cellId of assignmentIds) {
    const cell = host.cells.get(cellId);
    const result = blinded.rows.get(cellId);
    if (cell.block_id !== result.block_id || cell.slot !== result.slot || cell.repetition !== result.repetition) {
      throw new Error(`blinded result ${cellId} differs from its assignment identity`);
    }
    if (!tasks.has(cell.task)) throw new Error(`assignment cell ${cellId} has no frozen task reference`);
    validateFailureEvidence(result, host.classifications.get(cellId), cellId);
  }
  const replacementsByOriginal = new Map();
  for (const cell of host.cells.values()) {
    const originalId = cell.administrative_replacement_for;
    if (originalId === undefined || originalId === null) continue;
    const original = host.cells.get(originalId);
    if (original === undefined) throw new Error(`replacement ${cell.cell_id} names an unknown original`);
    const classification = host.classifications.get(originalId);
    if (classification?.category !== "administrative_failure") {
      throw new Error(`replacement ${cell.cell_id} does not replace a classified administrative failure`);
    }
    for (const field of ["block_id", "agent", "repetition", "treatment", "task", "checkpoint", "candidate_artifact"]) {
      if (cell[field] !== original[field]) throw new Error(`replacement ${cell.cell_id} changes frozen field ${field}`);
    }
    if (!replacementsByOriginal.has(originalId)) replacementsByOriginal.set(originalId, []);
    replacementsByOriginal.get(originalId).push(cell.cell_id);
  }
  for (const [cellId, classification] of host.classifications.entries()) {
    if (classification.category === "administrative_failure") {
      const replacements = replacementsByOriginal.get(cellId) ?? [];
      if (replacements.length !== 1) throw new Error(`administrative failure ${cellId} requires exactly one replacement`);
    }
  }
  const active = [...host.cells.values()].filter((cell) => (
    host.classifications.get(cell.cell_id)?.category !== "administrative_failure"
  ));
  const groups = new Map();
  for (const cell of active) {
    const key = `${cell.block_id}\0${cell.agent}\0${cell.repetition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cell);
  }
  const rows = [];
  const blockMetadata = {};
  for (const [key, cells] of groups.entries()) {
    const representations = cells.map((cell) => cell.treatment).sort();
    if (JSON.stringify(representations) !== JSON.stringify(REPRESENTATIONS)) {
      throw new Error(`analysis block ${key.replaceAll("\0", "/")} is incomplete`);
    }
    const taskIds = new Set(cells.map((cell) => cell.task));
    const histories = new Set(cells.map((cell) => cell.block_id));
    if (taskIds.size !== 1 || histories.size !== 1) throw new Error(`analysis block ${key} mixes frozen identities`);
    const [first] = cells;
    const blockId = analysisSha256([first.block_id, first.agent, first.repetition]).slice(0, 24);
    blockMetadata[blockId] = {
      sourceBlockId: first.block_id,
      taskId: first.task,
      historyId: first.block_id,
      modelFamily: first.agent,
      repetition: first.repetition,
    };
    for (const cell of cells) {
      const outcome = outcomeForCell(
        cell,
        blinded.rows.get(cell.cell_id),
        tasks.get(cell.task),
        host.classifications.get(cell.cell_id),
      );
      if (!outcome.eligible) throw new Error(`active cell ${cell.cell_id} cannot be administratively excluded`);
      rows.push({
        blockId,
        taskId: cell.task,
        historyId: cell.block_id,
        representation: cell.treatment,
        eligible: true,
        progressAuc: outcome.progressAuc,
        finalGain: outcome.finalGain,
        officialBaselineScore: outcome.officialBaselineScore,
        startingCandidateScore: outcome.startingCandidateScore,
        referenceScore: outcome.referenceScore,
        meaningfulGain: outcome.meaningfulGain,
        cellId: cell.cell_id,
        modelFamily: cell.agent,
        classification: outcome.classification,
        curve: outcome.curve,
      });
    }
  }
  return { rows, blockMetadata };
}

function modelFamilyEffects(pairs, blockMetadata) {
  const byModel = new Map();
  for (const pair of pairs) {
    const model = blockMetadata[pair.blockId]?.modelFamily;
    if (model === undefined) throw new Error(`missing block metadata for ${pair.blockId}`);
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(pair);
  }
  return Object.fromEntries([...byModel.entries()].sort().map(([model, modelPairs]) => [
    model,
    taskEqualMean(modelPairs).mean,
  ]));
}

function overallPilotDecision(gates) {
  const decisions = Object.values(gates).map((gate) => gate.decision);
  if (decisions.includes("GO_REPLICATION")) return "GO_REPLICATION_ELIGIBLE_USER_AUTHORIZATION_REQUIRED";
  if (decisions.every((decision) => decision === "STOP_FUTILITY")) return "STOP_FUTILITY";
  return "PILOT_INCONCLUSIVE";
}

function validateFrozenDesign(phase, blockMetadata, taskReferences) {
  const blocks = Object.values(blockMetadata);
  const tasks = [...new Set(blocks.map((block) => block.taskId))].sort();
  const models = [...new Set(blocks.map((block) => block.modelFamily))].sort();
  const referencedTasks = [...taskReferences.keys()].sort();
  if (JSON.stringify(tasks) !== JSON.stringify(referencedTasks)) {
    throw new Error("frozen task references do not exactly match the active analysis tasks");
  }
  for (const taskId of tasks) {
    const task = taskReferences.get(taskId);
    if (!task.startingCandidatesByHistory.has(null)) {
      const expectedHistories = [...new Set(blocks
        .filter((block) => block.taskId === taskId)
        .map((block) => block.historyId))].sort();
      const frozenHistories = [...task.startingCandidatesByHistory.keys()].sort();
      if (JSON.stringify(expectedHistories) !== JSON.stringify(frozenHistories)) {
        throw new Error(`task ${taskId} starting candidates do not exactly match active histories`);
      }
    }
  }
  if (phase === "pilot") {
    if (blocks.length !== 6 || tasks.length !== 3 || models.length !== 1) {
      throw new Error("pilot requires exactly six blocks: three tasks, two histories, and one model family");
    }
    for (const taskId of tasks) {
      if (blocks.filter((block) => block.taskId === taskId).length !== 2) {
        throw new Error(`pilot task ${taskId} does not contain exactly two histories`);
      }
    }
    return;
  }
  if (blocks.length !== 72 || tasks.length !== 12 || models.length !== 2) {
    throw new Error("confirmatory analysis requires 72 blocks: 12 tasks, three histories, and two model families");
  }
  for (const taskId of tasks) {
    const taskBlocks = blocks.filter((block) => block.taskId === taskId);
    for (const model of models) {
      const modelBlocks = taskBlocks.filter((block) => block.modelFamily === model);
      if (modelBlocks.length !== 3 || new Set(modelBlocks.map((block) => block.historyId)).size !== 3) {
        throw new Error(`confirmatory task ${taskId} does not contain three histories for ${model}`);
      }
    }
  }
}

export function analyzeRepresentationStudy({
  taskReferences,
  blindedResults,
  hostAssignment,
  blindedResultsSha256 = analysisSha256(blindedResults),
  taskReferencesSha256 = analysisSha256(taskReferences),
  hostAssignmentSha256 = analysisSha256(hostAssignment),
  phase,
  apparatusGatesPassed = false,
  protocolViolations = 0,
  bootstrapDraws = 10_000,
  permutationDraws = 100_000,
  alpha = 0.05,
  seed = "dungeness-representation-analysis-v1",
} = {}) {
  if (!["pilot", "confirmatory"].includes(phase)) throw new Error("phase must be pilot or confirmatory");
  if (typeof apparatusGatesPassed !== "boolean") throw new Error("apparatusGatesPassed must be boolean");
  if (!Number.isInteger(protocolViolations) || protocolViolations < 0) {
    throw new Error("protocolViolations must be a non-negative integer");
  }
  const taskInput = validateTaskReferences(taskReferences);
  const blinded = validateBlindedResults(blindedResults);
  if (taskInput.experiment !== blinded.experiment) throw new Error("task references and blinded results name different experiments");
  const host = validateHostAssignment(hostAssignment, blindedResultsSha256, blinded.experiment);
  if (host.experiment !== blinded.experiment) throw new Error("host assignment and blinded results name different experiments");
  if (host.assignment.execution_order_sha256 !== blinded.assignmentSha256) {
    throw new Error("host assignment does not match the blinded-results assignment hash");
  }
  const { rows, blockMetadata } = resolveActiveCells(host, blinded, taskInput.tasks);
  validateFrozenDesign(phase, blockMetadata, taskInput.tasks);
  const prepared = prepareConfirmatoryContrasts(rows, CONTRASTS, {
    bootstrapDraws,
    alpha,
    seed,
  });
  if (!prepared.valid || prepared.exclusions.length > 0) throw new Error("analysis contains incomplete or excluded active blocks");
  const contrastSummary = Object.fromEntries(Object.entries(prepared.contrasts).map(([id, contrast]) => [
    id,
    {
      ...contrast,
      modelFamilyEffects: modelFamilyEffects(contrast.pairs, blockMetadata),
    },
  ]));
  let pilot = null;
  let confirmatory = null;
  if (phase === "pilot") {
    const gates = {};
    for (const id of PILOT_CONTRAST_IDS) {
      const contrast = contrastSummary[id];
      gates[id] = assessRepresentationPilot({
        differences: contrast.pairs.map((pair) => pair.difference),
        estimate: contrast.auc.estimate,
        upperBound: contrast.auc.upperBound,
        finalNoninferior: contrast.final.noninferiority.supported,
        apparatusGatesPassed: apparatusGatesPassed && protocolViolations === 0,
      });
    }
    pilot = {
      gates,
      decision: overallPilotDecision(gates),
      decisionOnly: true,
      replicationStarted: false,
    };
  } else {
    const permutation = withinBlockMaxTPermutation(rows, CONTRASTS, {
      draws: permutationDraws,
      seed: `${seed}:max-t`,
      alpha,
    });
    const decisions = {};
    for (const definition of CONTRASTS) {
      const id = definition.id;
      const interval = permutation.simultaneousIntervals[id];
      const effects = Object.values(contrastSummary[id].modelFamilyEffects);
      if (interval.lowerBound === null) {
        decisions[id] = { winner: false, reason: "simultaneous_interval_not_finite" };
      } else {
        decisions[id] = assessConfirmatoryWinner({
          adjustedPValue: permutation.maxTAdjustedPValues[id],
          estimate: contrastSummary[id].auc.estimate,
          simultaneousLowerBound: interval.lowerBound,
          finalNoninferior: contrastSummary[id].final.noninferiority.supported,
          modelFamilyEffects: effects,
          protocolViolations,
        }, { alpha });
      }
      contrastSummary[id].inference = {
        rawPValue: permutation.rawPValues[id],
        holmAdjustedPValue: permutation.holmAdjustedPValues[id],
        maxTAdjustedPValue: permutation.maxTAdjustedPValues[id],
        simultaneousInterval: interval,
      };
    }
    confirmatory = {
      permutation,
      decisions,
      decisionOnly: true,
      confirmationStarted: false,
    };
  }
  return {
    schema: ANALYSIS_SCHEMA,
    experiment: blinded.experiment,
    phase,
    inputs: {
      taskReferencesSha256,
      blindedResultsSha256,
      hostAssignmentSha256,
      assignmentExecutionOrderSha256: blinded.assignmentSha256,
    },
    analysisConfig: {
      alpha,
      apparatusGatesPassed,
      bootstrapDraws,
      permutationDraws: phase === "confirmatory" ? permutationDraws : null,
      protocolViolations,
      seed: String(seed),
    },
    validation: {
      blindedLeakageCheck: "passed-before-assignment-join",
      completeActiveBlocks: true,
      failureClassificationsFrozenToBlindedResults: true,
      activeBlocks: Object.keys(blockMetadata).length,
      activeCells: rows.length,
      administrativeFailures: [...host.classifications.values()].filter((row) => row.category === "administrative_failure").length,
      treatmentFailures: [...host.classifications.values()].filter((row) => row.category === "treatment_failure").length,
      apparatusGatesPassed,
      protocolViolations,
    },
    blockMetadata,
    outcomes: rows,
    contrasts: contrastSummary,
    pilot,
    confirmatory,
    execution: {
      modelCalls: 0,
      studyRunsStarted: 0,
      replicationStarted: false,
      confirmationStarted: false,
    },
  };
}

function assertTreatmentBlindPool(value) {
  const forbidden = new Set(["outcome", "progressauc", "representation", "result", "score", "treatment"]);
  const visit = (item, path) => {
    if (Array.isArray(item)) return item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (!isObject(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key.toLowerCase())) throw new Error(`task pool contains treatment-outcome field ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "task pool");
}

export function selectConfirmatoryTasks(value, {
  seed = "dungeness-representation-confirmatory-task-selection-v1",
} = {}) {
  assertTreatmentBlindPool(value);
  requireExactKeys(value, ["categories", "experiment", "schema"], "confirmatory task pool");
  if (value.schema !== CONFIRMATORY_POOL_SCHEMA) throw new Error("unsupported confirmatory task-pool schema");
  requireString(value.experiment, "confirmatory task pool.experiment");
  if (!Array.isArray(value.categories) || value.categories.length !== 3) {
    throw new Error("confirmatory task pool must contain exactly three categories");
  }
  const categories = new Map();
  const taskIds = new Set();
  for (const [categoryIndex, category] of value.categories.entries()) {
    const label = `confirmatory task pool.categories[${categoryIndex}]`;
    requireExactKeys(category, ["category", "tasks"], label);
    if (!CONFIRMATORY_CATEGORIES.includes(category.category) || categories.has(category.category)) {
      throw new Error(`${label}.category is invalid or duplicated`);
    }
    if (!Array.isArray(category.tasks) || category.tasks.length !== 6) {
      throw new Error(`${label} must contain exactly six frozen tasks`);
    }
    const tasks = category.tasks.map((task, taskIndex) => {
      const taskLabel = `${label}.tasks[${taskIndex}]`;
      requireExactKeys(task, ["gates", "taskId"], taskLabel);
      const taskId = requireString(task.taskId, `${taskLabel}.taskId`);
      if (taskIds.has(taskId)) throw new Error(`confirmatory task pool repeats ${taskId}`);
      taskIds.add(taskId);
      requireExactKeys(task.gates, SELECTION_GATE_KEYS, `${taskLabel}.gates`);
      for (const key of SELECTION_GATE_KEYS) {
        if (typeof task.gates[key] !== "boolean") throw new Error(`${taskLabel}.gates.${key} must be boolean`);
      }
      const failedGates = SELECTION_GATE_KEYS.filter((key) => !task.gates[key]);
      const rankSha256 = analysisSha256({
        schema: CONFIRMATORY_SELECTION_SCHEMA,
        seed,
        category: category.category,
        taskId,
      });
      return { taskId, gates: task.gates, failedGates, rankSha256 };
    }).sort((left, right) => compareText(left.rankSha256, right.rankSha256) || compareText(left.taskId, right.taskId));
    categories.set(category.category, tasks);
  }
  if (taskIds.size !== 18 || CONFIRMATORY_CATEGORIES.some((category) => !categories.has(category))) {
    throw new Error("confirmatory task pool must be the frozen 18-task, three-category pool");
  }
  const report = Object.fromEntries(CONFIRMATORY_CATEGORIES.map((category) => {
    const ranked = categories.get(category);
    const eligible = ranked.filter((task) => task.failedGates.length === 0);
    return [category, {
      eligibleCount: eligible.length,
      ineligible: ranked.filter((task) => task.failedGates.length > 0).map((task) => ({
        taskId: task.taskId,
        failedGates: task.failedGates,
      })),
      rankedEligible: eligible.map((task) => ({ taskId: task.taskId, rankSha256: task.rankSha256 })),
      selected: eligible.length >= 4 ? eligible.slice(0, 4).map((task) => task.taskId) : [],
    }];
  }));
  const eligible = Object.values(report).every((category) => category.eligibleCount >= 4);
  const selected = eligible
    ? CONFIRMATORY_CATEGORIES.flatMap((category) => report[category].selected)
    : [];
  const selectionCore = {
    schema: CONFIRMATORY_SELECTION_SCHEMA,
    experiment: value.experiment,
    seed,
    gateKeys: SELECTION_GATE_KEYS,
    selected,
  };
  return {
    ...selectionCore,
    status: eligible ? "ELIGIBLE" : "INELIGIBLE",
    categories: report,
    selectionSha256: analysisSha256(selectionCore),
    execution: { modelCalls: 0, studyRunsStarted: 0, confirmationStarted: false },
  };
}
