import {
  bootstrapUpperBound,
  canonicalStringify,
  createPrng,
  exactSignFlipPValue,
  holmAdjust,
  mean,
  sha256,
} from "./protocol.js";

export const PLANNING_PROTOCOL_VERSION = "yukon-kg.mouselab-handoff.v3";
export const PLANNING_MODEL = "gpt-5.6-luna";
export const PLANNING_PRELUDE_EVALUATIONS = 6;
export const PLANNING_CONDITION_EVALUATIONS = 4;
export const PLANNING_CALIBRATION_BLOCKS = 4;
export const PLANNING_CONFIRMATORY_MIN_BLOCKS = 8;
export const PLANNING_CONFIRMATORY_MAX_BLOCKS = 24;
export const PLANNING_MDE_POINTS = 1;

export const PLANNING_CONDITIONS = Object.freeze({
  incumbent: {
    label: "continuing session",
    instruction: "Choose the next inspection using the complete working session.",
  },
  freshNarrative: {
    label: "fresh session with the complete journal",
    instruction: "Choose the next inspection using the complete journal, rationales, failures, and plan.",
  },
  freshNeutral: {
    label: "fresh session with a neutral evidence table",
    instruction: "Review every unrevealed node symmetrically and choose the next informative inspection.",
  },
  freshBudget: {
    label: "fresh session with neutral evidence and an explicit budget",
    instruction: "Allocate the remaining fresh inspections among the unrevealed nodes; choose the next inspection now.",
  },
});

export const PLANNING_CONTRASTS = Object.freeze({
  contextReset: {
    control: "incumbent",
    treatment: "freshNarrative",
    label: "Fresh session with complete journal versus continuing session",
  },
  explicitBudget: {
    control: "freshNeutral",
    treatment: "freshBudget",
    label: "Explicit budget instruction versus neutral review",
  },
  completeHandoff: {
    control: "incumbent",
    treatment: "freshBudget",
    label: "Neutral fresh handoff with explicit budget versus continuing session",
  },
});

export const INCREASING_VARIANCE_SUPPORTS = Object.freeze([
  Object.freeze([-4, -2, 2, 4]),
  Object.freeze([-8, -4, 4, 8]),
  Object.freeze([-48, -24, 24, 48]),
]);

export const HETEROGENEOUS_SUPPORTS = Object.freeze([
  Object.freeze([-64, -32, 32, 64]),
  Object.freeze([-56, -24, 24, 56]),
  Object.freeze([-48, -16, 16, 48]),
  Object.freeze([-64, -16, 32, 80]),
  Object.freeze([-80, -32, 16, 48]),
  Object.freeze([-48, -24, 8, 40]),
  Object.freeze([-32, -16, 16, 32]),
  Object.freeze([-28, -12, 12, 28]),
  Object.freeze([-24, -8, 8, 24]),
  Object.freeze([-32, -8, 16, 40]),
  Object.freeze([-40, -16, 8, 24]),
  Object.freeze([-20, -8, 12, 24]),
  Object.freeze([-12, -6, 6, 12]),
  Object.freeze([-10, -4, 4, 10]),
  Object.freeze([-8, -2, 2, 8]),
  Object.freeze([-12, -2, 6, 16]),
  Object.freeze([-16, -6, 2, 8]),
  Object.freeze([-8, -2, 4, 10]),
]);

function supportMean(support) {
  return support.reduce((sum, value) => sum + value, 0) / support.length;
}

export function createPlanningTask(seed, {
  branches = 6,
  supports = null,
} = {}) {
  const stageCount = supports?.length ?? 3;
  const supportPool = supports
    ? null
    : [...HETEROGENEOUS_SUPPORTS]
      .map((support) => ({ support, order: createPrng(`${seed}:support:${canonicalStringify(support)}`)() }))
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.support);
  const routes = Array.from({ length: branches }, (_, branchIndex) => {
    const routeId = `route-${sha256(`${seed}:route:${branchIndex}`).slice(0, 8)}`;
    const nodes = Array.from({ length: stageCount }, (_, levelIndex) => {
      const support = supports?.[levelIndex]
        ?? supportPool[(branchIndex * stageCount + levelIndex) % supportPool.length];
      return {
      nodeId: `node-${sha256(`${seed}:node:${branchIndex}:${levelIndex}`).slice(0, 12)}`,
      routeId,
      stage: levelIndex + 1,
      support: [...support],
      priorMean: supportMean(support),
      };
    });
    return { routeId, nodes };
  });
  const nodes = routes.flatMap((route) => route.nodes);
  return {
    taskId: `mouselab-${sha256(seed).slice(0, 12)}`,
    source: {
      name: "Mouselab-MDP planning task",
      paper: "https://cocosci.princeton.edu/papers/Mouselab_MDP-CameraReady.pdf",
      optimalPlanningReference: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8944825/",
    },
    branches,
    stages: stageCount,
    routes,
    nodes,
  };
}

export function samplePlanningWorld(task, seed) {
  const random = createPrng(seed);
  return Object.fromEntries(task.nodes.map((node) => [
    node.nodeId,
    node.support[Math.floor(random() * node.support.length)],
  ]));
}

export function publicTask(task) {
  return {
    taskId: task.taskId,
    rules: [
      "Each route pays the sum of its three node values.",
      "A node inspection reveals its exact value and consumes one measurement.",
      "Unrevealed nodes retain the displayed independent prior distribution.",
      "After the budget is spent, the host chooses the route with the highest posterior expected total.",
      "The objective is to maximize that final expected total, not the largest value revealed in isolation.",
    ],
    routes: task.routes.map((route) => ({
      routeId: route.routeId,
      nodes: route.nodes.map((node) => ({
        nodeId: node.nodeId,
        stage: node.stage,
        possibleValues: [...node.support],
      })),
    })),
  };
}

export function posteriorRouteValues(task, observations = {}) {
  return task.routes.map((route) => ({
    routeId: route.routeId,
    expectedTotal: route.nodes.reduce((sum, node) => (
      sum + (Object.hasOwn(observations, node.nodeId) ? observations[node.nodeId] : node.priorMean)
    ), 0),
  }));
}

export function terminalDecision(task, observations = {}) {
  const routes = posteriorRouteValues(task, observations);
  const expectedValue = Math.max(...routes.map((route) => route.expectedTotal));
  return {
    expectedValue,
    bestRouteIds: routes.filter((route) => route.expectedTotal === expectedValue).map((route) => route.routeId).sort(),
    routes,
  };
}

function observationKey(task, observations) {
  return task.nodes.map((node) => (
    Object.hasOwn(observations, node.nodeId) ? String(observations[node.nodeId]) : "?"
  )).join(",");
}

export function createPlanningOracle(task) {
  const memo = new Map();
  const value = (observations, remaining) => {
    if (remaining <= 0) return terminalDecision(task, observations).expectedValue;
    const key = `${remaining}|${observationKey(task, observations)}`;
    if (memo.has(key)) return memo.get(key);
    const unknown = task.nodes.filter((node) => !Object.hasOwn(observations, node.nodeId));
    if (unknown.length === 0) return terminalDecision(task, observations).expectedValue;
    let best = Number.NEGATIVE_INFINITY;
    for (const node of unknown) {
      const candidate = node.support.reduce((sum, outcome) => value({
        ...observations,
        [node.nodeId]: outcome,
      }, remaining - 1) + sum, 0) / node.support.length;
      if (candidate > best) best = candidate;
    }
    memo.set(key, best);
    return best;
  };
  const qValues = (observations, remaining) => {
    if (remaining <= 0) return [];
    return task.nodes
      .filter((node) => !Object.hasOwn(observations, node.nodeId))
      .map((node) => ({
        nodeId: node.nodeId,
        value: node.support.reduce((sum, outcome) => value({
          ...observations,
          [node.nodeId]: outcome,
        }, remaining - 1) + sum, 0) / node.support.length,
      }));
  };
  const decision = (observations, remaining) => {
    const choices = qValues(observations, remaining);
    const optimalValue = choices.length === 0
      ? terminalDecision(task, observations).expectedValue
      : Math.max(...choices.map((choice) => choice.value));
    return {
      optimalValue,
      optimalNodeIds: choices.filter((choice) => Math.abs(choice.value - optimalValue) < 1e-9)
        .map((choice) => choice.nodeId)
        .sort(),
      qValues: choices,
    };
  };
  return { value, qValues, decision, memo };
}

export function scorePlanningInspection({ task, oracle, observations, remaining, nodeId, world }) {
  const before = terminalDecision(task, observations);
  const oracleDecision = oracle.decision(observations, remaining);
  const selected = oracleDecision.qValues.find((choice) => choice.nodeId === nodeId);
  if (!selected) {
    return {
      validity: "invalid",
      reason: Object.hasOwn(observations, nodeId) ? "node_already_revealed" : "unknown_node",
      decisionLoss: oracleDecision.optimalValue - before.expectedValue,
      observations: { ...observations },
      before,
      after: before,
      oracle: oracleDecision,
    };
  }
  const revealedValue = world[nodeId];
  if (!Number.isFinite(revealedValue)) throw new Error(`sealed world is missing ${nodeId}`);
  const nextObservations = { ...observations, [nodeId]: revealedValue };
  return {
    validity: "valid",
    nodeId,
    revealedValue,
    decisionLoss: Math.max(0, oracleDecision.optimalValue - selected.value),
    selectedExpectedValue: selected.value,
    observations: nextObservations,
    before,
    after: terminalDecision(task, nextObservations),
    oracle: oracleDecision,
  };
}

export function scorePlanningPreludeInspection({ task, observations, nodeId, world }) {
  const node = task.nodes.find((candidate) => candidate.nodeId === nodeId);
  const before = terminalDecision(task, observations);
  if (!node || Object.hasOwn(observations, nodeId)) {
    return {
      validity: "invalid",
      reason: node ? "node_already_revealed" : "unknown_node",
      observations: { ...observations },
      before,
      after: before,
    };
  }
  const revealedValue = world[nodeId];
  if (!Number.isFinite(revealedValue)) throw new Error(`sealed world is missing ${nodeId}`);
  const nextObservations = { ...observations, [nodeId]: revealedValue };
  return {
    validity: "valid",
    nodeId,
    revealedValue,
    observations: nextObservations,
    before,
    after: terminalDecision(task, nextObservations),
  };
}

export function verifyPlanningDuplicate(first, second) {
  if (canonicalStringify(first) !== canonicalStringify(second)) {
    throw new Error("duplicate planning scores disagree");
  }
  return { ...first, reproductions: 2 };
}

function neutralRecord(record) {
  return {
    evaluationId: record.evaluationId,
    nodeId: record.nodeId ?? null,
    validity: record.validity,
    revealedValue: record.revealedValue ?? null,
    posteriorBestExpectedTotal: record.posteriorBestExpectedTotal,
  };
}

export function compilePlanningPacket(condition, {
  task,
  records,
  remainingEvaluations,
  incumbentPlan = null,
}) {
  const base = {
    protocolVersion: PLANNING_PROTOCOL_VERSION,
    task: publicTask(task),
    remainingEvaluations,
    evidence: records.map(neutralRecord),
    availableNodeIds: task.nodes
      .filter((node) => !records.some((record) => record.validity === "valid" && record.nodeId === node.nodeId))
      .map((node) => node.nodeId),
  };
  if (condition === "prelude") {
    return {
      ...base,
      instruction: "Choose the next inspection and maintain a plan for later measurements.",
      journal: records.map((record) => ({
        ...neutralRecord(record),
        rationale: record.rationale ?? null,
        planUpdate: record.planUpdate ?? null,
      })),
      incumbentPlan,
    };
  }
  if (!PLANNING_CONDITIONS[condition]) throw new Error(`unknown planning condition: ${condition}`);
  if (condition === "incumbent" || condition === "freshNarrative") {
    return {
      ...base,
      instruction: PLANNING_CONDITIONS[condition].instruction,
      journal: records.map((record) => ({
        ...neutralRecord(record),
        rationale: record.rationale ?? null,
        planUpdate: record.planUpdate ?? null,
      })),
      incumbentPlan,
    };
  }
  return { ...base, instruction: PLANNING_CONDITIONS[condition].instruction };
}

export function planningPacketDifference(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].sort().filter((key) => canonicalStringify(left[key]) !== canonicalStringify(right[key]));
}

export function planningContrastDifferences(blocks, contrast) {
  const definition = PLANNING_CONTRASTS[contrast];
  if (!definition) throw new Error(`unknown planning contrast: ${contrast}`);
  return blocks.map((block) => (
    block.conditions[definition.control].totalDecisionLoss
    - block.conditions[definition.treatment].totalDecisionLoss
  ));
}

export function analyzePlanningBlocks(blocks, {
  mdePoints = PLANNING_MDE_POINTS,
  alpha = 0.05,
  bootstrapDraws = 10_000,
  seed = "mouselab-confirmatory",
} = {}) {
  if (blocks.length === 0) throw new Error("planning analysis requires blocks");
  const differences = Object.fromEntries(Object.keys(PLANNING_CONTRASTS).map((key) => [
    key,
    planningContrastDifferences(blocks, key),
  ]));
  const rawP = Object.fromEntries(Object.entries(differences).map(([key, values]) => [
    key,
    exactSignFlipPValue(values),
  ]));
  const adjustedP = holmAdjust(rawP);
  const comparisons = {};
  for (const [key, values] of Object.entries(differences)) {
    const effect = mean(values);
    const upperBound = bootstrapUpperBound(values, {
      alpha: alpha / Object.keys(PLANNING_CONTRASTS).length,
      draws: bootstrapDraws,
      seed: `${seed}:${key}`,
    });
    let verdict = "INCONCLUSIVE_AT_CAP";
    if (adjustedP[key] < alpha && effect >= mdePoints) verdict = "SUPPORTED";
    else if (upperBound < mdePoints) verdict = "NOT_SUPPORTED_AT_MDE";
    comparisons[key] = {
      label: PLANNING_CONTRASTS[key].label,
      pairedDecisionLossReductions: values,
      meanDecisionLossReduction: effect,
      rawP: rawP[key],
      adjustedP: adjustedP[key],
      simultaneousUpperBound: upperBound,
      verdict,
    };
  }
  return {
    comparisons,
    proceedToLiveYukonTest: comparisons.completeHandoff.verdict === "SUPPORTED",
    informationRemovalDiagnostic: blocks.map((block) => (
      block.conditions.freshNarrative.totalDecisionLoss
      - block.conditions.freshNeutral.totalDecisionLoss
    )),
  };
}
