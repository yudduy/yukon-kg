import { canonicalStringify, mean, sha256 } from "./protocol.js";

export const DUNGENESS_ADAPTIVE_SCHEMA = "yukon-kg.dungeness-adaptive";
export const DUNGENESS_ADAPTIVE_PROTOCOL_VERSION = "yukon-kg.dungeness-adaptive.v1";
export const DUNGENESS_ADAPTER_SCHEMA = "yukon-kg.dungeness-adapter.v1";
export const KNOWLEDGE_ARMS = Object.freeze(["state_static", "state_adaptive"]);
export const PROCEDURE_MODES = Object.freeze(["fixed", "adaptive_procedures"]);
export const CALIBRATION_PAIR_COUNT = 16;
export const CONFIRMATORY_INTERIMS = Object.freeze([20, 40, 60, 80]);
export const CONFIRMATORY_MAX_PAIRS = CONFIRMATORY_INTERIMS.at(-1);
export const PRACTICAL_MDE = 0.05;
export const TARGET_ADVANTAGE = 0.10;
export const INVALID_NONINFERIORITY_MARGIN = 0.05;
export const DEFAULT_CAMPAIGN_BUDGET = Object.freeze({
  turns: 24,
  rootTokens: 120_000,
  descendantTokens: 0,
  evaluatorCalls: 32,
  wallClockMs: 3_600_000,
  costUsd: 25,
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireSha(value, name) {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256`);
  return value;
}

function requireCommit(value, name) {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${name} must be a Git commit hash`);
  return value;
}

function requireCommand(value, name) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${name} must be a non-empty string array`);
  }
  return [...value];
}

function requireBudget(value) {
  const budget = requireObject(value, "budget");
  const parsed = {};
  for (const key of Object.keys(DEFAULT_CAMPAIGN_BUDGET)) {
    const item = budget[key];
    const valid = key === "descendantTokens"
      ? Number.isFinite(item) && item >= 0
      : Number.isFinite(item) && item > 0;
    if (!valid) throw new Error(`budget.${key} must be ${key === "descendantTokens" ? "non-negative" : "positive"}`);
    parsed[key] = item;
  }
  return parsed;
}

export function parseDungenessAdapter(value, { expectedRepoSha = null } = {}) {
  const input = requireObject(value, "Dungeness adapter");
  if (input.schema !== DUNGENESS_ADAPTER_SCHEMA) throw new Error("unsupported Dungeness adapter schema");
  const repoSha = requireCommit(input.repoSha, "repoSha");
  if (expectedRepoSha !== null && repoSha !== expectedRepoSha) {
    throw new Error(`Dungeness adapter pins ${repoSha}, checkout is ${expectedRepoSha}`);
  }
  if (!Array.isArray(input.mutableGlobs) || input.mutableGlobs.length === 0) {
    throw new Error("mutableGlobs must be non-empty");
  }
  if (input.mutableGlobs.some((glob) => typeof glob !== "string" || !glob.startsWith("src/point_add/"))) {
    throw new Error("Dungeness mutable globs must stay under src/point_add/");
  }
  const evaluator = requireObject(input.evaluator, "evaluator");
  const checkpoints = input.checkpoints;
  if (!Array.isArray(checkpoints) || checkpoints.length !== 8) {
    throw new Error("the confirmatory adapter must freeze exactly eight checkpoints");
  }
  const checkpointIds = new Set();
  const parsedCheckpoints = checkpoints.map((checkpoint, index) => {
    const item = requireObject(checkpoint, `checkpoints[${index}]`);
    const id = requireString(item.id, `checkpoints[${index}].id`);
    if (checkpointIds.has(id)) throw new Error(`duplicate checkpoint ${id}`);
    checkpointIds.add(id);
    if (!Number.isFinite(item.baselineScore) || item.baselineScore <= 0) {
      throw new Error(`checkpoints[${index}].baselineScore must be positive`);
    }
    return {
      id,
      gitRef: requireCommit(item.gitRef, `checkpoints[${index}].gitRef`),
      baselineScore: item.baselineScore,
      developmentPanelSha256: requireSha(
        item.developmentPanelSha256,
        `checkpoints[${index}].developmentPanelSha256`,
      ),
      hiddenPanelSha256: requireSha(item.hiddenPanelSha256, `checkpoints[${index}].hiddenPanelSha256`),
    };
  });
  return {
    schema: DUNGENESS_ADAPTER_SCHEMA,
    repoSha,
    mutableGlobs: [...input.mutableGlobs],
    setupCommand: input.setupCommand == null ? null : requireCommand(input.setupCommand, "setupCommand"),
    evaluator: {
      developmentCommand: requireCommand(evaluator.developmentCommand, "evaluator.developmentCommand"),
      hiddenCommand: requireCommand(evaluator.hiddenCommand, "evaluator.hiddenCommand"),
      timeoutMs: Number.isFinite(evaluator.timeoutMs) && evaluator.timeoutMs > 0
        ? evaluator.timeoutMs
        : 15 * 60_000,
      outputSchema: "yukon-kg.dungeness-evaluation.v1",
    },
    checkpoints: parsedCheckpoints,
  };
}

function cellSeed(seed, phase, checkpointId, repeatIndex, arm, procedureMode) {
  return Number.parseInt(
    sha256(`${seed}\0${phase}\0${checkpointId}\0${repeatIndex}\0${arm}\0${procedureMode}`).slice(0, 8),
    16,
  );
}

export function buildPairedAssignments({
  checkpoints,
  pairCount,
  phase,
  seed,
  procedureModes = ["fixed"],
}) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) throw new Error("checkpoints are required");
  if (!Number.isInteger(pairCount) || pairCount < 1) throw new Error("pairCount must be positive");
  if (!["calibration", "confirmatory", "prime_factor"].includes(phase)) throw new Error(`unknown phase ${phase}`);
  const assignments = [];
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const checkpoint = checkpoints[pairIndex % checkpoints.length];
    for (const procedureMode of procedureModes) {
      if (!PROCEDURE_MODES.includes(procedureMode)) throw new Error(`unknown procedure mode ${procedureMode}`);
      const pairId = `${phase}:${checkpoint.id}:p${String(pairIndex + 1).padStart(3, "0")}:${procedureMode}`;
      const cells = KNOWLEDGE_ARMS.map((arm) => ({
        campaignId: `${pairId}:${arm}`,
        pairId,
        pairIndex,
        phase,
        checkpointId: checkpoint.id,
        checkpointGitRef: checkpoint.gitRef,
        arm,
        procedureMode,
        seed: cellSeed(seed, phase, checkpoint.id, pairIndex, arm, procedureMode),
      }));
      const reverse = sha256(`${seed}\0${pairId}\0order`).charCodeAt(0) % 2 === 1;
      for (const [waveOrder, cell] of (reverse ? cells.reverse() : cells).entries()) {
        assignments.push({ ...cell, waveOrder });
      }
    }
  }
  return assignments;
}

export function freezeAdaptiveProtocol({
  adapter,
  dungenessPin,
  atlasReleaseId,
  atlasManifestSha256,
  model,
  provider,
  decoding,
  seed,
  budget = DEFAULT_CAMPAIGN_BUDGET,
  createdAt,
}) {
  if (dungenessPin?.sha !== adapter.repoSha) throw new Error("Dungeness pin and adapter SHA differ");
  requireString(model, "model");
  requireString(provider, "provider");
  requireString(seed, "seed");
  requireString(createdAt, "createdAt");
  requireSha(atlasReleaseId, "atlasReleaseId");
  requireSha(atlasManifestSha256, "atlasManifestSha256");
  const frozen = {
    schema: DUNGENESS_ADAPTIVE_SCHEMA,
    protocolVersion: DUNGENESS_ADAPTIVE_PROTOCOL_VERSION,
    createdAt,
    dungeness: {
      repo: dungenessPin.repo,
      sha: dungenessPin.sha,
      adapterSha256: sha256(adapter),
    },
    atlas: {
      releaseId: atlasReleaseId,
      manifestSha256: atlasManifestSha256,
    },
    model: {
      id: model,
      provider,
      decoding: requireObject(decoding, "decoding"),
    },
    seed,
    budget: requireBudget(budget),
    arms: [...KNOWLEDGE_ARMS],
    calibration: {
      pairCount: CALIBRATION_PAIR_COUNT,
      assignments: buildPairedAssignments({
        checkpoints: adapter.checkpoints,
        pairCount: CALIBRATION_PAIR_COUNT,
        phase: "calibration",
        seed,
      }),
    },
    confirmatory: {
      maxPairs: CONFIRMATORY_MAX_PAIRS,
      interims: [...CONFIRMATORY_INTERIMS],
      practicalMde: PRACTICAL_MDE,
      invalidNoninferiorityMargin: INVALID_NONINFERIORITY_MARGIN,
      assignments: buildPairedAssignments({
        checkpoints: adapter.checkpoints,
        pairCount: CONFIRMATORY_MAX_PAIRS,
        phase: "confirmatory",
        seed,
      }),
    },
  };
  return { ...frozen, protocolSha256: sha256(frozen) };
}

export function normalizedGain(baselineScore, bestValidScore) {
  if (!Number.isFinite(baselineScore) || baselineScore <= 0) throw new Error("baselineScore must be positive");
  if (!Number.isFinite(bestValidScore) || bestValidScore <= 0) throw new Error("bestValidScore must be positive");
  return Math.max(0, (baselineScore - bestValidScore) / baselineScore);
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function pairedRows(campaigns) {
  const byPair = new Map();
  for (const campaign of campaigns) {
    const row = byPair.get(campaign.pairId) ?? {};
    if (row[campaign.arm] !== undefined) throw new Error(`duplicate ${campaign.arm} campaign for ${campaign.pairId}`);
    row[campaign.arm] = campaign;
    byPair.set(campaign.pairId, row);
  }
  return [...byPair.entries()].map(([pairId, row]) => {
    if (row.state_static === undefined || row.state_adaptive === undefined) {
      throw new Error(`pair ${pairId} is incomplete`);
    }
    if (row.state_static.checkpointId !== row.state_adaptive.checkpointId) {
      throw new Error(`pair ${pairId} checkpoint mismatch`);
    }
    return {
      pairId,
      checkpointId: row.state_static.checkpointId,
      static: row.state_static,
      adaptive: row.state_adaptive,
      difference: row.state_adaptive.normalizedGain - row.state_static.normalizedGain,
    };
  }).sort((left, right) => left.pairId.localeCompare(right.pairId));
}

export function estimateConfirmatoryPairs(calibrationCampaigns, {
  practicalMde = PRACTICAL_MDE,
  targetAdvantage = TARGET_ADVANTAGE,
  minimum = CONFIRMATORY_INTERIMS[0],
  maximum = CONFIRMATORY_MAX_PAIRS,
} = {}) {
  const pairs = pairedRows(calibrationCampaigns);
  if (pairs.length < 12) throw new Error("power calibration requires at least 12 matched pairs");
  const differences = pairs.map((pair) => pair.difference);
  const observedSd = sampleStandardDeviation(differences);
  const conservativeSd = Math.max(0.05, observedSd * 1.5);
  if (targetAdvantage <= practicalMde) throw new Error("target advantage must exceed the practical MDE");
  const raw = Math.ceil(((1.959963984540054 + 1.2815515655446004) * conservativeSd
    / (targetAdvantage - practicalMde)) ** 2);
  const scheduled = CONFIRMATORY_INTERIMS.find((count) => count >= Math.max(minimum, raw)) ?? maximum;
  const pairCosts = pairs.map((pair) => pair.static.costUsd + pair.adaptive.costUsd);
  const projectedMaxSpendUsd = 1.1 * mean(pairCosts) * scheduled;
  return {
    calibrationPairs: pairs.length,
    observedMeanDifference: mean(differences),
    observedSd,
    conservativeSd,
    practicalMde,
    targetAdvantage,
    rawRequiredPairs: raw,
    scheduledPairs: Math.min(maximum, scheduled),
    attainableAtCap: raw <= maximum,
    meanPairCostUsd: mean(pairCosts),
    projectedMaxSpendUsd,
  };
}

function groupSequentialCriticalZ(pairCount, maximumPairs) {
  const informationFraction = pairCount / maximumPairs;
  return 1.959963984540054 / Math.sqrt(informationFraction);
}

function interval(values, criticalZ) {
  const center = mean(values);
  const sd = sampleStandardDeviation(values);
  const standardError = Number.isFinite(sd) ? sd / Math.sqrt(values.length) : Number.POSITIVE_INFINITY;
  return {
    mean: center,
    sd,
    standardError,
    lower: center - criticalZ * standardError,
    upper: center + criticalZ * standardError,
  };
}

export function analyzeAdaptiveCampaigns(campaigns, {
  maximumPairs = CONFIRMATORY_MAX_PAIRS,
  practicalMde = PRACTICAL_MDE,
  invalidMargin = INVALID_NONINFERIORITY_MARGIN,
} = {}) {
  const pairs = pairedRows(campaigns);
  if (!CONFIRMATORY_INTERIMS.includes(pairs.length)) {
    throw new Error(`analysis requires an interim at ${CONFIRMATORY_INTERIMS.join(", ")} pairs`);
  }
  const criticalZ = groupSequentialCriticalZ(pairs.length, maximumPairs);
  const effect = interval(pairs.map((pair) => pair.difference), criticalZ);
  const invalidEffect = interval(pairs.map((pair) => (
    pair.adaptive.invalidRate - pair.static.invalidRate
  )), criticalZ);
  const checkpointMeans = Object.fromEntries(
    [...new Set(pairs.map((pair) => pair.checkpointId))].sort().map((checkpointId) => {
      const values = pairs.filter((pair) => pair.checkpointId === checkpointId).map((pair) => pair.difference);
      return [checkpointId, mean(values)];
    }),
  );
  const positiveCheckpoints = Object.values(checkpointMeans).filter((value) => value > 0).length;
  const leaveOneCheckpointOut = Object.fromEntries(Object.keys(checkpointMeans).map((checkpointId) => {
    const values = pairs.filter((pair) => pair.checkpointId !== checkpointId).map((pair) => pair.difference);
    return [checkpointId, mean(values)];
  }));
  const provenanceViolations = campaigns.reduce(
    (total, campaign) => total + (campaign.provenanceViolations?.length ?? 0),
    0,
  );
  const safetyPass = invalidEffect.upper <= invalidMargin && provenanceViolations === 0;
  const breadthPass = positiveCheckpoints >= 6
    && Object.values(leaveOneCheckpointOut).every((value) => value > 0);
  let decision = "CONTINUE";
  if (effect.lower > practicalMde && safetyPass && breadthPass) decision = "ADOPT_ADAPTIVE_STATE";
  else if (pairs.length === maximumPairs) {
    decision = effect.upper < practicalMde || !safetyPass
      ? "RETAIN_STATIC_STATE"
      : "INCONCLUSIVE_RETAIN_STATIC";
  }
  return {
    schema: DUNGENESS_ADAPTIVE_SCHEMA,
    protocolVersion: DUNGENESS_ADAPTIVE_PROTOCOL_VERSION,
    analysis: "paired O'Brien-Fleming-style normal approximation; one confirmatory contrast",
    pairCount: pairs.length,
    maximumPairs,
    criticalZ,
    practicalMde,
    effect,
    invalidNoninferiority: {
      margin: invalidMargin,
      ...invalidEffect,
      pass: invalidEffect.upper <= invalidMargin,
    },
    checkpointMeans,
    positiveCheckpoints,
    leaveOneCheckpointOut,
    provenanceViolations,
    safetyPass,
    breadthPass,
    decision,
  };
}

export function assertWithinSpendCap(campaigns, spendCapUsd) {
  if (!Number.isFinite(spendCapUsd) || spendCapUsd <= 0) throw new Error("spend cap must be positive");
  const spentUsd = campaigns.reduce((total, campaign) => total + campaign.costUsd, 0);
  if (spentUsd > spendCapUsd) {
    throw new Error(`campaign spend ${spentUsd.toFixed(6)} exceeds cap ${spendCapUsd.toFixed(6)}`);
  }
  return { spentUsd, remainingUsd: spendCapUsd - spentUsd };
}

export function canonicalProtocolJson(value) {
  return `${canonicalStringify(value)}\n`;
}

export { sha256 };
