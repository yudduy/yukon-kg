import { canonicalStringify, createPrng, mean, sha256 } from "./protocol.js";
import path from "node:path";

export const DUNGENESS_ADAPTIVE_SCHEMA = "yukon-kg.dungeness-adaptive";
export const DUNGENESS_ADAPTIVE_PROTOCOL_VERSION = "yukon-kg.dungeness-adaptive.v1";
export const DUNGENESS_ADAPTER_SCHEMA = "yukon-kg.dungeness-adapter.v1";
export const KNOWLEDGE_ARMS = Object.freeze(["state_static", "state_adaptive"]);
export const PROCEDURE_MODES = Object.freeze(["fixed", "adaptive_procedures"]);
export const CALIBRATION_PAIR_COUNT = 16;
export const CONFIRMATORY_INTERIMS = Object.freeze([20, 40, 60, 80]);
export const CONFIRMATORY_MAX_PAIRS = CONFIRMATORY_INTERIMS.at(-1);
export const CONFIRMATORY_FINAL_PAIR_COUNTS = Object.freeze([80]);
export const CONFIRMATORY_ALPHA = 0.025;
export const CONFIRMATORY_POWER = 0.90;
export const POWER_SIMULATION_DRAWS = 20_000;
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
  if (!Number.isInteger(parsed.evaluatorCalls) || parsed.evaluatorCalls < 2) {
    throw new Error("budget.evaluatorCalls must be an integer of at least 2");
  }
  if (!Number.isInteger(parsed.turns)) throw new Error("budget.turns must be an integer");
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
  const isolation = requireObject(input.isolation, "isolation");
  if (
    isolation.kind !== "external_microvm"
    || isolation.network !== "none"
    || isolation.hostWorkspaceMounted !== false
  ) {
    throw new Error("Dungeness evaluation requires a networkless external microVM without the host workspace mounted");
  }
  const evaluator = requireObject(input.evaluator, "evaluator");
  const attestationCommand = requireCommand(evaluator.attestationCommand, "evaluator.attestationCommand");
  const developmentCommand = requireCommand(evaluator.developmentCommand, "evaluator.developmentCommand");
  const hiddenCommand = requireCommand(evaluator.hiddenCommand, "evaluator.hiddenCommand");
  const evaluatorRunner = developmentCommand[0];
  if (
    !path.isAbsolute(evaluatorRunner)
    || attestationCommand[0] !== evaluatorRunner
    || hiddenCommand[0] !== evaluatorRunner
  ) {
    throw new Error("all evaluator commands must use the same absolute microVM runner path");
  }
  const setupCommand = input.setupCommand == null ? null : requireCommand(input.setupCommand, "setupCommand");
  if (setupCommand !== null && setupCommand[0] !== evaluatorRunner) {
    throw new Error("setupCommand must run through the same absolute microVM runner");
  }
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
      taskStateSha256: requireSha(item.taskStateSha256, `checkpoints[${index}].taskStateSha256`),
      baselineScore: item.baselineScore,
      developmentPanelSha256: requireSha(
        item.developmentPanelSha256,
        `checkpoints[${index}].developmentPanelSha256`,
      ),
      hiddenPanelSha256: requireSha(item.hiddenPanelSha256, `checkpoints[${index}].hiddenPanelSha256`),
    };
  });
  if (new Set(parsedCheckpoints.map((checkpoint) => checkpoint.gitRef)).size !== parsedCheckpoints.length) {
    throw new Error("the eight checkpoints must pin distinct Git commits");
  }
  if (new Set(parsedCheckpoints.map((checkpoint) => checkpoint.taskStateSha256)).size !== parsedCheckpoints.length) {
    throw new Error("the eight checkpoints must pin distinct task-state digests");
  }
  return {
    schema: DUNGENESS_ADAPTER_SCHEMA,
    repoSha,
    mutableGlobs: [...input.mutableGlobs],
    setupCommand,
    isolation: {
      kind: "external_microvm",
      network: "none",
      hostWorkspaceMounted: false,
      runnerSha256: requireSha(isolation.runnerSha256, "isolation.runnerSha256"),
      imageSha256: requireSha(isolation.imageSha256, "isolation.imageSha256"),
      evaluatorSha256: requireSha(isolation.evaluatorSha256, "isolation.evaluatorSha256"),
    },
    evaluator: {
      attestationCommand,
      developmentCommand,
      hiddenCommand,
      timeoutMs: Number.isFinite(evaluator.timeoutMs) && evaluator.timeoutMs > 0
        ? evaluator.timeoutMs
        : 15 * 60_000,
      outputSchema: "yukon-kg.dungeness-evaluation.v1",
    },
    checkpoints: parsedCheckpoints,
  };
}

function cellSeed(seed, phase, checkpointId, repeatIndex) {
  return Number.parseInt(
    sha256(`${seed}\0${phase}\0${checkpointId}\0${repeatIndex}`).slice(0, 8),
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
    const blockCells = [];
    for (const procedureMode of procedureModes) {
      if (!PROCEDURE_MODES.includes(procedureMode)) throw new Error(`unknown procedure mode ${procedureMode}`);
      const blockId = `${phase}:${checkpoint.id}:p${String(pairIndex + 1).padStart(3, "0")}`;
      const pairId = `${blockId}:${procedureMode}`;
      blockCells.push(...KNOWLEDGE_ARMS.map((arm) => ({
        campaignId: `${pairId}:${arm}`,
        blockId,
        pairId,
        pairIndex,
        phase,
        checkpointId: checkpoint.id,
        checkpointGitRef: checkpoint.gitRef,
        arm,
        procedureMode,
        seed: cellSeed(seed, phase, checkpoint.id, pairIndex),
      })));
    }
    const ordered = blockCells.sort((left, right) => (
      sha256(`${seed}\0${left.campaignId}\0order`).localeCompare(
        sha256(`${seed}\0${right.campaignId}\0order`),
      )
    ));
    for (const [waveOrder, cell] of ordered.entries()) {
      assignments.push({ ...cell, waveOrder });
    }
  }
  return assignments;
}

export function freezeAdaptiveProtocol({
  adapter,
  dungenessPin,
  atlasReleaseId,
  atlasManifestSha256,
  stateBriefSha256,
  runtimeSha256,
  model,
  provider,
  baseUrl,
  pricing,
  decoding,
  signer,
  seed,
  budget = DEFAULT_CAMPAIGN_BUDGET,
  createdAt,
}) {
  if (dungenessPin?.sha !== adapter.repoSha) throw new Error("Dungeness pin and adapter SHA differ");
  requireString(model, "model");
  requireString(provider, "provider");
  requireString(baseUrl, "baseUrl");
  if (
    !Number.isFinite(pricing?.inputUsdPerMillion)
    || pricing.inputUsdPerMillion <= 0
    || !Number.isFinite(pricing?.outputUsdPerMillion)
    || pricing.outputUsdPerMillion <= 0
  ) throw new Error("positive model pricing is required");
  requireString(seed, "seed");
  requireString(createdAt, "createdAt");
  if (signer?.algorithm !== "ed25519") throw new Error("an Ed25519 ledger signer is required");
  requireSha(signer.publicKeySha256, "signer.publicKeySha256");
  requireString(signer.publicKeyPem, "signer.publicKeyPem");
  requireSha(atlasReleaseId, "atlasReleaseId");
  requireSha(atlasManifestSha256, "atlasManifestSha256");
  requireSha(stateBriefSha256, "stateBriefSha256");
  requireSha(runtimeSha256, "runtimeSha256");
  const frozen = {
    schema: DUNGENESS_ADAPTIVE_SCHEMA,
    protocolVersion: DUNGENESS_ADAPTIVE_PROTOCOL_VERSION,
    createdAt,
    dungeness: {
      repo: dungenessPin.repo,
      sha: dungenessPin.sha,
      adapterSha256: sha256(adapter),
      isolation: adapter.isolation,
      checkpoints: adapter.checkpoints,
    },
    atlas: {
      releaseId: atlasReleaseId,
      manifestSha256: atlasManifestSha256,
      stateBriefSha256,
    },
    runtimeSha256,
    model: {
      id: model,
      provider,
      baseUrl,
      pricing: {
        inputUsdPerMillion: pricing.inputUsdPerMillion,
        outputUsdPerMillion: pricing.outputUsdPerMillion,
      },
      decoding: requireObject(decoding, "decoding"),
    },
    signer,
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

function standardNormal(random) {
  const first = Math.max(Number.MIN_VALUE, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function simulatedNoncentralTPower({
  sampleSize,
  standardizedEffect,
  criticalValue,
  draws = POWER_SIMULATION_DRAWS,
  seed,
}) {
  const random = createPrng(seed);
  const degreesOfFreedom = sampleSize - 1;
  const noncentrality = standardizedEffect * Math.sqrt(sampleSize);
  let rejected = 0;
  for (let draw = 0; draw < draws; draw += 1) {
    let chiSquare = 0;
    for (let index = 0; index < degreesOfFreedom; index += 1) {
      chiSquare += standardNormal(random) ** 2;
    }
    const statistic = (standardNormal(random) + noncentrality)
      / Math.sqrt(chiSquare / degreesOfFreedom);
    if (statistic > criticalValue) rejected += 1;
  }
  return rejected / draws;
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
  if (pairs.length !== CALIBRATION_PAIR_COUNT) {
    throw new Error(`power calibration requires exactly ${CALIBRATION_PAIR_COUNT} matched pairs`);
  }
  if (maximum !== CONFIRMATORY_MAX_PAIRS || minimum > maximum) {
    throw new Error(`confirmatory design is frozen at ${CONFIRMATORY_MAX_PAIRS} pairs`);
  }
  const differences = pairs.map((pair) => pair.difference);
  const observedSd = sampleStandardDeviation(differences);
  const conservativeSd = Math.max(0.05, observedSd * 1.5);
  if (targetAdvantage <= practicalMde) throw new Error("target advantage must exceed the practical MDE");
  const finalCritical = studentTCritical975(maximum - 1);
  const raw = Math.ceil(((finalCritical + 1.2815515655446004) * conservativeSd
    / (targetAdvantage - practicalMde)) ** 2);
  const scheduled = maximum;
  const simulatedPower = simulatedNoncentralTPower({
    sampleSize: scheduled,
    standardizedEffect: (targetAdvantage - practicalMde) / conservativeSd,
    criticalValue: finalCritical,
    seed: sha256(differences),
  });
  const pairCosts = pairs.map((pair) => pair.static.costUsd + pair.adaptive.costUsd);
  const projectedMaxSpendUsd = 1.1 * mean(pairCosts) * scheduled;
  return {
    calibrationPairs: pairs.length,
    observedMeanDifference: mean(differences),
    observedSd,
    conservativeSd,
    practicalMde,
    targetAdvantage,
    alpha: CONFIRMATORY_ALPHA,
    targetPower: CONFIRMATORY_POWER,
    inference: "final-only paired Student interval; interim reports are descriptive",
    rawRequiredPairs: raw,
    scheduledPairs: Math.min(maximum, scheduled),
    attainableAtCap: simulatedPower >= CONFIRMATORY_POWER,
    powerSimulationDraws: POWER_SIMULATION_DRAWS,
    simulatedPowerAtScheduled: simulatedPower,
    meanPairCostUsd: mean(pairCosts),
    projectedMaxSpendUsd,
  };
}

function studentTCritical975(degreesOfFreedom) {
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new Error("Student interval requires positive degrees of freedom");
  }
  const z = 1.959963984540054;
  const inverse = 1 / degreesOfFreedom;
  return z
    + (z ** 3 + z) * inverse / 4
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) * inverse ** 2 / 96
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) * inverse ** 3 / 384;
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

function binomialCdf(k, n, probability) {
  if (k >= n) return 1;
  if (probability <= 0) return 1;
  if (probability >= 1) return 0;
  let term = (1 - probability) ** n;
  let total = term;
  for (let index = 0; index < k; index += 1) {
    term *= ((n - index) / (index + 1)) * (probability / (1 - probability));
    total += term;
  }
  return Math.min(1, total);
}

function clopperPearsonUpper(successes, trials, alpha = CONFIRMATORY_ALPHA) {
  if (!Number.isInteger(successes) || successes < 0 || successes > trials || trials < 1) {
    throw new Error("invalid binomial counts");
  }
  if (successes === trials) return 1;
  let low = successes / trials;
  let high = 1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (binomialCdf(successes, trials, midpoint) > alpha) low = midpoint;
    else high = midpoint;
  }
  return high;
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
  if (!CONFIRMATORY_FINAL_PAIR_COUNTS.includes(maximumPairs)) {
    throw new Error(`maximumPairs must be one of ${CONFIRMATORY_FINAL_PAIR_COUNTS.join(", ")}`);
  }
  if (pairs.length > maximumPairs) throw new Error("pair count exceeds the frozen maximum");
  const isFinal = pairs.length === maximumPairs;
  const criticalValue = studentTCritical975(pairs.length - 1);
  const effect = interval(pairs.map((pair) => pair.difference), criticalValue);
  const adaptiveOnlyInvalid = pairs.filter((pair) => (
    pair.adaptive.invalidRate === 1 && pair.static.invalidRate === 0
  )).length;
  const staticOnlyInvalid = pairs.filter((pair) => (
    pair.adaptive.invalidRate === 0 && pair.static.invalidRate === 1
  )).length;
  const adaptiveNotSubmitted = pairs.filter((pair) => !pair.adaptive.finalOutputSubmitted).length;
  const staticNotSubmitted = pairs.filter((pair) => !pair.static.finalOutputSubmitted).length;
  const submissionNoRegression = adaptiveNotSubmitted <= staticNotSubmitted;
  const invalidRiskDifference = (adaptiveOnlyInvalid - staticOnlyInvalid) / pairs.length;
  const conservativeInvalidUpper = clopperPearsonUpper(
    adaptiveOnlyInvalid,
    pairs.length,
  );
  const proposalInvalidEffect = interval(pairs.map((pair) => (
    pair.adaptive.proposalInvalidRate - pair.static.proposalInvalidRate
  )), criticalValue);
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
  if (Object.keys(checkpointMeans).length !== 8) {
    throw new Error("confirmatory analysis requires all eight frozen checkpoints");
  }
  const safetyPass = conservativeInvalidUpper <= invalidMargin
    && submissionNoRegression
    && provenanceViolations === 0;
  const breadthPass = positiveCheckpoints >= 6
    && Object.values(leaveOneCheckpointOut).every((value) => value > 0);
  let decision = "CONTINUE";
  if (provenanceViolations > 0) decision = "INVALID_PROTOCOL";
  else if (isFinal && effect.lower > practicalMde && safetyPass && breadthPass) decision = "ADOPT_ADAPTIVE_STATE";
  else if (isFinal) {
    decision = effect.upper < practicalMde || !safetyPass
      ? "RETAIN_STATIC_STATE"
      : "INCONCLUSIVE_RETAIN_STATIC";
  }
  return {
    schema: DUNGENESS_ADAPTIVE_SCHEMA,
    protocolVersion: DUNGENESS_ADAPTIVE_PROTOCOL_VERSION,
    analysis: "final-only paired Student interval; interim reports are descriptive and cannot adopt",
    pairCount: pairs.length,
    maximumPairs,
    isFinal,
    alpha: CONFIRMATORY_ALPHA,
    criticalValue,
    practicalMde,
    effect,
    invalidNoninferiority: {
      margin: invalidMargin,
      method: "conservative exact upper bound on adaptive-only final invalidity",
      adaptiveOnlyInvalid,
      staticOnlyInvalid,
      riskDifference: invalidRiskDifference,
      upper: conservativeInvalidUpper,
      pass: conservativeInvalidUpper <= invalidMargin,
    },
    proposalInvalidEffect,
    submissions: {
      adaptiveNotSubmitted,
      staticNotSubmitted,
      noRegression: submissionNoRegression,
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

export function analyzePrimeFactorCampaigns(campaigns, {
  practicalMde = PRACTICAL_MDE,
} = {}) {
  const byBlock = new Map();
  for (const campaign of campaigns) {
    const blockId = campaign.blockId;
    if (typeof blockId !== "string" || blockId.length === 0) {
      throw new Error("prime-factor campaigns require blockId");
    }
    const key = `${campaign.arm}:${campaign.procedureMode}`;
    const cells = byBlock.get(blockId) ?? new Map();
    if (cells.has(key)) throw new Error(`duplicate ${key} in ${blockId}`);
    cells.set(key, campaign);
    byBlock.set(blockId, cells);
  }
  const expected = KNOWLEDGE_ARMS.flatMap((arm) => PROCEDURE_MODES.map((mode) => `${arm}:${mode}`));
  const blocks = [...byBlock.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([blockId, cells]) => {
    for (const key of expected) {
      if (!cells.has(key)) throw new Error(`prime-factor block ${blockId} is missing ${key}`);
    }
    const y = (arm, mode) => cells.get(`${arm}:${mode}`).normalizedGain;
    const knowledgeEffect = (
      (y("state_adaptive", "fixed") - y("state_static", "fixed"))
      + (y("state_adaptive", "adaptive_procedures") - y("state_static", "adaptive_procedures"))
    ) / 2;
    const procedureEffect = (
      (y("state_static", "adaptive_procedures") - y("state_static", "fixed"))
      + (y("state_adaptive", "adaptive_procedures") - y("state_adaptive", "fixed"))
    ) / 2;
    const interaction = (
      y("state_adaptive", "adaptive_procedures") - y("state_static", "adaptive_procedures")
    ) - (
      y("state_adaptive", "fixed") - y("state_static", "fixed")
    );
    const adaptiveStateProcedureEffect = (
      y("state_adaptive", "adaptive_procedures") - y("state_adaptive", "fixed")
    );
    const adaptiveStateInvalidEffect = (
      cells.get("state_adaptive:adaptive_procedures").invalidRate
      - cells.get("state_adaptive:fixed").invalidRate
    );
    return {
      blockId,
      knowledgeEffect,
      procedureEffect,
      adaptiveStateProcedureEffect,
      adaptiveStateInvalidEffect,
      interaction,
      cells: Object.fromEntries(cells),
    };
  });
  if (blocks.length !== 80) throw new Error("prime-factor analysis requires exactly 80 complete blocks");
  const criticalValue = studentTCritical975(blocks.length - 1);
  const knowledge = interval(blocks.map((block) => block.knowledgeEffect), criticalValue);
  const procedure = interval(blocks.map((block) => block.procedureEffect), criticalValue);
  const adaptiveStateProcedure = interval(
    blocks.map((block) => block.adaptiveStateProcedureEffect),
    criticalValue,
  );
  const adaptiveProcedureOnlyInvalid = blocks.filter((block) => (
    block.cells["state_adaptive:adaptive_procedures"].invalidRate === 1
    && block.cells["state_adaptive:fixed"].invalidRate === 0
  )).length;
  const fixedProcedureOnlyInvalid = blocks.filter((block) => (
    block.cells["state_adaptive:adaptive_procedures"].invalidRate === 0
    && block.cells["state_adaptive:fixed"].invalidRate === 1
  )).length;
  const adaptiveStateInvalid = {
    method: "conservative exact upper bound on adaptive-procedure-only final invalidity",
    adaptiveProcedureOnlyInvalid,
    fixedProcedureOnlyInvalid,
    riskDifference: (adaptiveProcedureOnlyInvalid - fixedProcedureOnlyInvalid) / blocks.length,
    upper: clopperPearsonUpper(adaptiveProcedureOnlyInvalid, blocks.length),
  };
  const interaction = interval(blocks.map((block) => block.interaction), criticalValue);
  const provenanceViolations = campaigns.reduce(
    (total, campaign) => total + (campaign.provenanceViolations?.length ?? 0),
    0,
  );
  return {
    schema: DUNGENESS_ADAPTIVE_SCHEMA,
    protocolVersion: DUNGENESS_ADAPTIVE_PROTOCOL_VERSION,
    analysis: "paired 2x2 factorial; adaptive-state procedural effect is primary",
    blocks: blocks.length,
    practicalMde,
    knowledge,
    procedure,
    adaptiveStateProcedure,
    adaptiveStateInvalid,
    interaction,
    provenanceViolations,
    decision: provenanceViolations > 0
      ? "INVALID_PROTOCOL"
      : adaptiveStateInvalid.upper > INVALID_NONINFERIORITY_MARGIN
        ? "REJECT_ADAPTIVE_PROCEDURES"
        : adaptiveStateProcedure.lower > practicalMde
          ? "ADOPT_ADAPTIVE_PROCEDURES"
          : adaptiveStateProcedure.upper < practicalMde
            ? "RETAIN_FIXED_PROCEDURES"
            : "INCONCLUSIVE_RETAIN_FIXED_PROCEDURES",
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
