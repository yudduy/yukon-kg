import { createHash } from "node:crypto";

export const REPRESENTATION_MEANINGFUL_EFFECT = 0.25;
export const REPRESENTATION_PILOT_BLOCKS = 6;
export const REPRESENTATION_PILOT_MIN_WINS = 4;
export const REPRESENTATION_BUDGET_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

const DIRECTIONS = new Set(["maximize", "minimize"]);
const MILESTONE_STATUSES = new Set(["valid", "treatment_failure", "administrative_failure"]);

function requireFinite(value, context) {
  if (!Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function requirePositive(value, context) {
  requireFinite(value, context);
  if (!(value > 0)) throw new Error(`${context} must be positive`);
  return value;
}

function requireNonemptyString(value, context) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function mean(values, context = "values") {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${context} must be non-empty`);
  return values.reduce((sum, value, index) => sum + requireFinite(value, `${context}[${index}]`), 0) / values.length;
}

function quantile(sorted, probability) {
  if (sorted.length === 0) throw new Error("quantile input must be non-empty");
  if (!(probability >= 0 && probability <= 1)) throw new Error("quantile probability must be between zero and one");
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createPrng(seed) {
  const digest = createHash("sha256").update(String(seed)).digest();
  let state = digest.readUInt32LE(0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function sample(values, random) {
  return values[Math.floor(random() * values.length)];
}

function groupByTask(pairs, field) {
  const groups = new Map();
  for (const [index, pair] of pairs.entries()) {
    const taskId = requireNonemptyString(pair.taskId, `pairs[${index}].taskId`);
    const value = requireFinite(pair[field], `pairs[${index}].${field}`);
    if (!groups.has(taskId)) groups.set(taskId, []);
    groups.get(taskId).push(value);
  }
  if (groups.size === 0) throw new Error("pairs must contain at least one task");
  return groups;
}

function taskEqualStatistic(groups) {
  return mean([...groups.values()].map((values) => mean(values)), "task means");
}

function taskEqualTStatistic(groups) {
  return taskEqualEstimateAndStandardError(groups).tStatistic;
}

function taskEqualEstimateAndStandardError(groups) {
  const taskMeans = [...groups.values()].map((values) => mean(values));
  if (taskMeans.length < 2) throw new Error("max-T inference requires at least two tasks");
  const estimate = mean(taskMeans, "task means");
  const squared = taskMeans.reduce((sum, value) => sum + (value - estimate) ** 2, 0);
  const standardError = Math.sqrt(squared / (taskMeans.length - 1)) / Math.sqrt(taskMeans.length);
  if (standardError === 0) {
    return {
      estimate,
      standardError,
      tStatistic: estimate === 0 ? 0 : Math.sign(estimate) * Number.MAX_VALUE,
    };
  }
  return { estimate, standardError, tStatistic: estimate / standardError };
}

function sampledTaskEqualStatistic(groups, random, taskCount = groups.size, historiesPerTask = null) {
  const taskGroups = [...groups.values()];
  const selectedTaskMeans = Array.from({ length: taskCount }, () => {
    const histories = sample(taskGroups, random);
    const count = historiesPerTask ?? histories.length;
    const sampledHistories = Array.from({ length: count }, () => sample(histories, random));
    return mean(sampledHistories, "sampled histories");
  });
  return mean(selectedTaskMeans, "sampled task means");
}

export function normalizeMeaningfulGain({ baselineScore, score, direction, meaningfulGain }) {
  requireFinite(baselineScore, "baselineScore");
  requireFinite(score, "score");
  requirePositive(meaningfulGain, "meaningfulGain");
  if (!DIRECTIONS.has(direction)) throw new Error("direction must be maximize or minimize");
  const signedDifference = direction === "maximize"
    ? score - baselineScore
    : baselineScore - score;
  return signedDifference / meaningfulGain;
}

export function meaningfulGainFromReference({ baselineScore, referenceScore, direction }) {
  requireFinite(baselineScore, "baselineScore");
  requireFinite(referenceScore, "referenceScore");
  if (!DIRECTIONS.has(direction)) throw new Error("direction must be maximize or minimize");
  const gap = direction === "maximize"
    ? referenceScore - baselineScore
    : baselineScore - referenceScore;
  if (!(gap > 0)) {
    throw new Error("referenceScore must be strictly better than baselineScore");
  }
  return gap * 0.10;
}

export function milestoneProgressAuc({
  baselineScore,
  meaningfulGain,
  direction,
  milestones,
  expectedFractions = null,
}) {
  requireFinite(baselineScore, "baselineScore");
  requirePositive(meaningfulGain, "meaningfulGain");
  if (!DIRECTIONS.has(direction)) throw new Error("direction must be maximize or minimize");
  if (!Array.isArray(milestones) || milestones.length < 2) {
    throw new Error("milestones must contain at least the zero and final budget fractions");
  }
  const ordered = milestones.map((milestone, index) => {
    if (milestone === null || typeof milestone !== "object" || Array.isArray(milestone)) {
      throw new Error(`milestones[${index}] must be an object`);
    }
    const fraction = requireFinite(milestone.fraction, `milestones[${index}].fraction`);
    if (!(fraction >= 0 && fraction <= 1)) {
      throw new Error(`milestones[${index}].fraction must be between zero and one`);
    }
    if (!MILESTONE_STATUSES.has(milestone.status)) {
      throw new Error(`milestones[${index}].status is invalid`);
    }
    if (milestone.status === "valid") requireFinite(milestone.score, `milestones[${index}].score`);
    return { ...milestone, fraction };
  }).sort((left, right) => left.fraction - right.fraction);
  if (ordered[0].fraction !== 0 || ordered.at(-1).fraction !== 1) {
    throw new Error("milestones must include exact budget fractions zero and one");
  }
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].fraction === ordered[index - 1].fraction) {
      throw new Error(`milestones contain duplicate fraction ${ordered[index].fraction}`);
    }
  }
  if (expectedFractions !== null) {
    if (!Array.isArray(expectedFractions) || expectedFractions.length < 2) {
      throw new Error("expectedFractions must be null or an array with at least two fractions");
    }
    const expected = expectedFractions.map((fraction, index) => {
      requireFinite(fraction, `expectedFractions[${index}]`);
      return fraction;
    });
    if (expected.length !== ordered.length
      || expected.some((fraction, index) => fraction !== ordered[index].fraction)) {
      throw new Error(`milestone fractions must equal ${expected.join(", ")}`);
    }
  }
  if (ordered.some((milestone) => milestone.status === "administrative_failure")) {
    return {
      eligible: false,
      exclusionReason: "administrative_failure",
      curve: [],
      progressAuc: null,
      finalGain: null,
    };
  }
  const curve = ordered.map((milestone) => {
    if (milestone.status === "valid") {
      return {
        fraction: milestone.fraction,
        gain: normalizeMeaningfulGain({
          baselineScore,
          score: milestone.score,
          direction,
          meaningfulGain,
        }),
        sourceStatus: milestone.status,
      };
    }
    const previous = ordered
      .slice(0, ordered.indexOf(milestone))
      .toReversed()
      .find((candidate) => candidate.status === "valid");
    if (previous === undefined) {
      throw new Error("a treatment failure cannot precede the first valid milestone");
    }
    return {
      fraction: milestone.fraction,
      gain: normalizeMeaningfulGain({
        baselineScore,
        score: previous.score,
        direction,
        meaningfulGain,
      }),
      sourceStatus: milestone.status,
    };
  });
  let progressAuc = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const width = curve[index].fraction - curve[index - 1].fraction;
    progressAuc += width * (curve[index - 1].gain + curve[index].gain) / 2;
  }
  return {
    eligible: true,
    exclusionReason: null,
    curve,
    progressAuc,
    finalGain: curve.at(-1).gain,
  };
}

function rowBlockId(row, index) {
  return requireNonemptyString(row.blockId, `rows[${index}].blockId`);
}

function validateOutcomeRow(row, index) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`rows[${index}] must be an object`);
  }
  rowBlockId(row, index);
  requireNonemptyString(row.taskId, `rows[${index}].taskId`);
  requireNonemptyString(row.historyId, `rows[${index}].historyId`);
  requireNonemptyString(row.representation, `rows[${index}].representation`);
  if (typeof row.eligible !== "boolean") throw new Error(`rows[${index}].eligible must be boolean`);
  if (row.eligible) {
    requireFinite(row.progressAuc, `rows[${index}].progressAuc`);
    requireFinite(row.finalGain, `rows[${index}].finalGain`);
  }
  return row;
}

export function pairedWithinHistoryContrasts(rows, definitions) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("rows must be non-empty");
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error("definitions must be non-empty");
  const blocks = new Map();
  rows.map(validateOutcomeRow).forEach((row, index) => {
    const blockId = rowBlockId(row, index);
    if (!blocks.has(blockId)) blocks.set(blockId, new Map());
    const byRepresentation = blocks.get(blockId);
    if (byRepresentation.has(row.representation)) {
      throw new Error(`block ${blockId} contains duplicate representation ${row.representation}`);
    }
    byRepresentation.set(row.representation, row);
  });
  const result = {};
  const exclusions = [];
  for (const [definitionIndex, definition] of definitions.entries()) {
    const id = requireNonemptyString(definition.id, `definitions[${definitionIndex}].id`);
    const treatment = requireNonemptyString(definition.treatment, `definitions[${definitionIndex}].treatment`);
    const control = requireNonemptyString(definition.control, `definitions[${definitionIndex}].control`);
    if (treatment === control) throw new Error(`contrast ${id} must compare different representations`);
    if (result[id] !== undefined) throw new Error(`duplicate contrast id ${id}`);
    const pairs = [];
    for (const [blockId, byRepresentation] of blocks.entries()) {
      const treatmentRow = byRepresentation.get(treatment);
      const controlRow = byRepresentation.get(control);
      if (!treatmentRow || !controlRow) {
        exclusions.push({ blockId, contrastId: id, reason: "missing_arm" });
        continue;
      }
      if (!treatmentRow.eligible || !controlRow.eligible) {
        exclusions.push({ blockId, contrastId: id, reason: "administrative_failure" });
        continue;
      }
      if (treatmentRow.taskId !== controlRow.taskId || treatmentRow.historyId !== controlRow.historyId) {
        throw new Error(`block ${blockId} does not pair the same task and history`);
      }
      pairs.push({
        blockId,
        taskId: treatmentRow.taskId,
        historyId: treatmentRow.historyId,
        treatment,
        control,
        treatmentAuc: treatmentRow.progressAuc,
        controlAuc: controlRow.progressAuc,
        difference: treatmentRow.progressAuc - controlRow.progressAuc,
        treatmentFinalGain: treatmentRow.finalGain,
        controlFinalGain: controlRow.finalGain,
        finalDifference: treatmentRow.finalGain - controlRow.finalGain,
      });
    }
    result[id] = { id, treatment, control, pairs };
  }
  return {
    valid: exclusions.every((exclusion) => exclusion.reason !== "missing_arm"),
    contrasts: result,
    exclusions,
  };
}

export function taskEqualMean(pairs, { field = "difference" } = {}) {
  const groups = groupByTask(pairs, field);
  const tasks = [...groups.entries()].map(([taskId, values]) => ({
    taskId,
    histories: values.length,
    mean: mean(values),
  }));
  return {
    mean: mean(tasks.map((task) => task.mean), "task means"),
    taskCount: tasks.length,
    historyCount: pairs.length,
    tasks,
  };
}

export function probabilityOfImprovement(pairs, { field = "difference", tieCredit = 0.5 } = {}) {
  requireFinite(tieCredit, "tieCredit");
  if (!(tieCredit >= 0 && tieCredit <= 1)) throw new Error("tieCredit must be between zero and one");
  const scored = pairs.map((pair, index) => {
    const difference = requireFinite(pair[field], `pairs[${index}].${field}`);
    return {
      ...pair,
      improvement: difference > 0 ? 1 : difference < 0 ? 0 : tieCredit,
    };
  });
  const summary = taskEqualMean(scored, { field: "improvement" });
  return {
    probability: summary.mean,
    taskCount: summary.taskCount,
    historyCount: summary.historyCount,
    tasks: summary.tasks,
  };
}

export function hierarchicalBootstrap(pairs, {
  field = "difference",
  draws = 10_000,
  alpha = 0.05,
  seed = "representation-bootstrap",
  includeSamples = false,
} = {}) {
  if (!Number.isInteger(draws) || draws < 1) throw new Error("draws must be a positive integer");
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be between zero and one");
  const groups = groupByTask(pairs, field);
  const random = createPrng(seed);
  const samples = Array.from({ length: draws }, () => sampledTaskEqualStatistic(groups, random));
  const sorted = [...samples].sort((left, right) => left - right);
  const result = {
    estimate: taskEqualStatistic(groups),
    lowerBound: quantile(sorted, alpha / 2),
    upperBound: quantile(sorted, 1 - alpha / 2),
    alpha,
    draws,
    seed: String(seed),
    taskCount: groups.size,
    historyCount: pairs.length,
  };
  if (includeSamples) result.samples = samples;
  return result;
}

export function assessFinalScoreNoninferiority(interval, { margin = REPRESENTATION_MEANINGFUL_EFFECT } = {}) {
  requirePositive(margin, "margin");
  const estimate = requireFinite(interval.estimate, "interval.estimate");
  const lowerBound = requireFinite(interval.lowerBound, "interval.lowerBound");
  const upperBound = requireFinite(interval.upperBound, "interval.upperBound");
  if (lowerBound > upperBound) throw new Error("interval lowerBound exceeds upperBound");
  return {
    estimate,
    lowerBound,
    upperBound,
    margin,
    supported: lowerBound > -margin,
  };
}

export function assessRepresentationPilot({
  differences,
  estimate,
  upperBound,
  finalNoninferior,
  apparatusGatesPassed,
}, {
  meaningfulEffect = REPRESENTATION_MEANINGFUL_EFFECT,
  minimumWins = REPRESENTATION_PILOT_MIN_WINS,
  expectedBlocks = REPRESENTATION_PILOT_BLOCKS,
} = {}) {
  requirePositive(meaningfulEffect, "meaningfulEffect");
  if (!Array.isArray(differences) || differences.length !== expectedBlocks) {
    throw new Error(`pilot requires exactly ${expectedBlocks} paired differences`);
  }
  const values = differences.map((value, index) => requireFinite(value, `differences[${index}]`));
  const resolvedEstimate = estimate === undefined ? mean(values) : requireFinite(estimate, "estimate");
  const resolvedUpperBound = requireFinite(upperBound, "upperBound");
  if (typeof finalNoninferior !== "boolean") {
    throw new Error("finalNoninferior must be boolean");
  }
  if (typeof apparatusGatesPassed !== "boolean") {
    throw new Error("apparatusGatesPassed must be boolean");
  }
  const wins = values.filter((value) => value > 0).length;
  let decision = "PILOT_INCONCLUSIVE";
  if (resolvedUpperBound < meaningfulEffect) decision = "STOP_FUTILITY";
  else if (
    resolvedEstimate >= meaningfulEffect
    && wins >= minimumWins
    && finalNoninferior
    && apparatusGatesPassed
  ) decision = "GO_REPLICATION";
  return {
    decision,
    estimate: resolvedEstimate,
    upperBound: resolvedUpperBound,
    meaningfulEffect,
    wins,
    blocks: values.length,
    minimumWins,
    finalNoninferior,
    apparatusGatesPassed,
  };
}

export function assessConfirmatoryWinner({
  adjustedPValue,
  estimate,
  simultaneousLowerBound,
  finalNoninferior,
  modelFamilyEffects,
  protocolViolations,
}, {
  alpha = 0.05,
  meaningfulEffect = REPRESENTATION_MEANINGFUL_EFFECT,
} = {}) {
  requireFinite(adjustedPValue, "adjustedPValue");
  requireFinite(estimate, "estimate");
  requireFinite(simultaneousLowerBound, "simultaneousLowerBound");
  if (!(adjustedPValue >= 0 && adjustedPValue <= 1)) {
    throw new Error("adjustedPValue must be between zero and one");
  }
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be between zero and one");
  requirePositive(meaningfulEffect, "meaningfulEffect");
  if (typeof finalNoninferior !== "boolean") throw new Error("finalNoninferior must be boolean");
  if (!Array.isArray(modelFamilyEffects) || modelFamilyEffects.length < 2) {
    throw new Error("modelFamilyEffects must contain at least two model effects");
  }
  const effects = modelFamilyEffects.map((value, index) => (
    requireFinite(value, `modelFamilyEffects[${index}]`)
  ));
  if (!Number.isInteger(protocolViolations) || protocolViolations < 0) {
    throw new Error("protocolViolations must be a non-negative integer");
  }
  const criteria = {
    adjustedSignificant: adjustedPValue <= alpha,
    practicallyMeaningful: estimate >= meaningfulEffect,
    intervalExcludesZero: simultaneousLowerBound > 0,
    finalNoninferior,
    improvesInEveryModelFamily: effects.every((value) => value > 0),
    protocolClean: protocolViolations === 0,
  };
  return {
    winner: Object.values(criteria).every(Boolean),
    criteria,
  };
}

export function holmAdjustPValues(pValues) {
  if (pValues === null || typeof pValues !== "object" || Array.isArray(pValues)) {
    throw new Error("pValues must be an object");
  }
  const entries = Object.entries(pValues).map(([id, value]) => {
    requireNonemptyString(id, "p-value id");
    requireFinite(value, `pValues.${id}`);
    if (!(value >= 0 && value <= 1)) throw new Error(`pValues.${id} must be between zero and one`);
    return [id, value];
  }).sort((left, right) => left[1] - right[1]);
  const adjusted = {};
  let runningMaximum = 0;
  entries.forEach(([id, value], index) => {
    runningMaximum = Math.max(runningMaximum, Math.min(1, value * (entries.length - index)));
    adjusted[id] = runningMaximum;
  });
  return adjusted;
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function withinBlockMaxTPermutation(rows, definitions, {
  draws = 100_000,
  seed = "representation-max-t",
  alpha = 0.05,
} = {}) {
  if (!Number.isInteger(draws) || draws < 1) throw new Error("draws must be a positive integer");
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be between zero and one");
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error("definitions must be non-empty");
  }
  const representations = [...new Set(definitions.flatMap((definition) => [
    requireNonemptyString(definition.treatment, "definition treatment"),
    requireNonemptyString(definition.control, "definition control"),
  ]))].sort();
  const blocks = new Map();
  rows.map(validateOutcomeRow).forEach((row) => {
    if (!row.eligible) throw new Error("max-T inference requires frozen complete blocks");
    if (!blocks.has(row.blockId)) blocks.set(row.blockId, new Map());
    const block = blocks.get(row.blockId);
    if (block.has(row.representation)) throw new Error(`duplicate arm in block ${row.blockId}`);
    block.set(row.representation, row);
  });
  for (const [blockId, block] of blocks.entries()) {
    if (representations.some((representation) => !block.has(representation))) {
      throw new Error(`max-T block ${blockId} is incomplete`);
    }
    const taskIds = new Set([...block.values()].map((row) => row.taskId));
    if (taskIds.size !== 1) throw new Error(`max-T block ${blockId} mixes tasks`);
  }
  const contrastPairs = (assignedBlocks, definition) => [...assignedBlocks.entries()].map(([blockId, block]) => {
    const treatment = block.get(definition.treatment);
    const control = block.get(definition.control);
    return {
      blockId,
      taskId: treatment.taskId,
      difference: treatment.progressAuc - control.progressAuc,
    };
  });
  const statistic = (assignedBlocks, definition) => taskEqualTStatistic(
    groupByTask(contrastPairs(assignedBlocks, definition), "difference"),
  );
  const observedSummaries = Object.fromEntries(definitions.map((definition) => {
    const groups = groupByTask(contrastPairs(blocks, definition), "difference");
    return [definition.id, taskEqualEstimateAndStandardError(groups)];
  }));
  const observed = Object.fromEntries(definitions.map((definition) => [
    definition.id,
    observedSummaries[definition.id].tStatistic,
  ]));
  const rawExceedances = Object.fromEntries(definitions.map((definition) => [definition.id, 0]));
  const maxExceedances = Object.fromEntries(definitions.map((definition) => [definition.id, 0]));
  const maximumAbsoluteT = [];
  const random = createPrng(seed);
  for (let draw = 0; draw < draws; draw += 1) {
    const permuted = new Map();
    for (const [blockId, block] of blocks.entries()) {
      const values = shuffle(representations.map((representation) => block.get(representation)), random);
      permuted.set(blockId, new Map(representations.map((representation, index) => [representation, values[index]])));
    }
    const permutation = Object.fromEntries(definitions.map((definition) => [
      definition.id,
      statistic(permuted, definition),
    ]));
    const maximum = Math.max(...Object.values(permutation).map(Math.abs));
    maximumAbsoluteT.push(maximum);
    for (const definition of definitions) {
      const id = definition.id;
      if (Math.abs(permutation[id]) >= Math.abs(observed[id])) rawExceedances[id] += 1;
      if (maximum >= Math.abs(observed[id])) maxExceedances[id] += 1;
    }
  }
  const rawPValues = Object.fromEntries(definitions.map((definition) => [
    definition.id,
    (rawExceedances[definition.id] + 1) / (draws + 1),
  ]));
  const maxTAdjustedPValues = Object.fromEntries(definitions.map((definition) => [
    definition.id,
    (maxExceedances[definition.id] + 1) / (draws + 1),
  ]));
  const criticalMaxAbsT = quantile(
    [...maximumAbsoluteT].sort((left, right) => left - right),
    1 - alpha,
  );
  const simultaneousIntervals = Object.fromEntries(definitions.map((definition) => {
    const summary = observedSummaries[definition.id];
    const radius = criticalMaxAbsT * summary.standardError;
    const stableStandardError = summary.standardError
      > Number.EPSILON * Math.max(1, Math.abs(summary.estimate)) * 16;
    const finite = stableStandardError && Number.isFinite(radius);
    return [definition.id, {
      estimate: summary.estimate,
      standardError: summary.standardError,
      lowerBound: finite ? summary.estimate - radius : null,
      upperBound: finite ? summary.estimate + radius : null,
    }];
  }));
  return {
    method: "within-block-label-permutation-max-t.v1",
    draws,
    seed: String(seed),
    alpha,
    blocks: blocks.size,
    tasks: new Set([...blocks.values()].map((block) => block.values().next().value.taskId)).size,
    observedT: observed,
    rawPValues,
    holmAdjustedPValues: holmAdjustPValues(rawPValues),
    maxTAdjustedPValues,
    criticalMaxAbsT,
    simultaneousIntervals,
  };
}

export function prepareConfirmatoryContrasts(rows, definitions, {
  bootstrapDraws = 10_000,
  alpha = 0.05,
  seed = "representation-confirmatory",
  noninferiorityMargin = REPRESENTATION_MEANINGFUL_EFFECT,
} = {}) {
  const paired = pairedWithinHistoryContrasts(rows, definitions);
  const contrasts = {};
  for (const [id, contrast] of Object.entries(paired.contrasts)) {
    if (contrast.pairs.length === 0) {
      contrasts[id] = { ...contrast, analyzable: false };
      continue;
    }
    const aucInterval = hierarchicalBootstrap(contrast.pairs, {
      draws: bootstrapDraws,
      alpha,
      seed: `${seed}:${id}:auc`,
    });
    const finalInterval = hierarchicalBootstrap(contrast.pairs, {
      field: "finalDifference",
      draws: bootstrapDraws,
      alpha,
      seed: `${seed}:${id}:final`,
    });
    contrasts[id] = {
      ...contrast,
      analyzable: true,
      auc: {
        ...aucInterval,
        probabilityOfImprovement: probabilityOfImprovement(contrast.pairs).probability,
      },
      final: {
        ...finalInterval,
        noninferiority: assessFinalScoreNoninferiority(finalInterval, { margin: noninferiorityMargin }),
      },
      inference: {
        rawPValue: null,
        holmAdjustedPValue: null,
        maxTAdjustedPValue: null,
      },
    };
  }
  const blocks = [...new Set(rows.map((row) => row.blockId))].sort().map((blockId) => {
    const blockRows = rows.filter((row) => row.blockId === blockId && row.eligible);
    return {
      blockId,
      taskId: blockRows[0]?.taskId ?? null,
      historyId: blockRows[0]?.historyId ?? null,
      outcomes: Object.fromEntries(blockRows.map((row) => [row.representation, {
        progressAuc: row.progressAuc,
        finalGain: row.finalGain,
      }])),
    };
  });
  return {
    valid: paired.valid,
    contrasts,
    exclusions: paired.exclusions,
    permutationFrame: {
      method: "permute representation labels within complete blocks",
      contrastIds: definitions.map((definition) => definition.id),
      blocks,
    },
  };
}

export function simulateHierarchicalPower(pairs, {
  field = "difference",
  targetEffect = REPRESENTATION_MEANINGFUL_EFFECT,
  taskCounts,
  historiesPerTask = null,
  draws = 10_000,
  alpha = 0.05,
  familySize = 1,
  seed = "representation-power",
} = {}) {
  requireFinite(targetEffect, "targetEffect");
  if (!Array.isArray(taskCounts) || taskCounts.length === 0
    || taskCounts.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new Error("taskCounts must contain positive integers");
  }
  if (historiesPerTask !== null && (!Number.isInteger(historiesPerTask) || historiesPerTask < 1)) {
    throw new Error("historiesPerTask must be null or a positive integer");
  }
  if (!Number.isInteger(draws) || draws < 1) throw new Error("draws must be a positive integer");
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be between zero and one");
  if (!Number.isInteger(familySize) || familySize < 1) throw new Error("familySize must be a positive integer");
  const groups = groupByTask(pairs, field);
  const center = taskEqualStatistic(groups);
  const centeredGroups = new Map([...groups.entries()].map(([taskId, values]) => [
    taskId,
    values.map((value) => value - center),
  ]));
  const results = taskCounts.map((taskCount) => {
    const random = createPrng(`${seed}:${taskCount}`);
    const nullEstimates = Array.from({ length: draws }, () => sampledTaskEqualStatistic(
      centeredGroups,
      random,
      taskCount,
      historiesPerTask,
    ));
    const sortedNull = [...nullEstimates].sort((left, right) => left - right);
    const criticalValue = quantile(sortedNull, 1 - alpha / familySize);
    const rejected = nullEstimates.filter((noise) => noise + targetEffect > criticalValue).length;
    return {
      taskCount,
      historiesPerTask,
      criticalValue,
      estimatedPower: rejected / draws,
    };
  });
  return {
    targetEffect,
    alpha,
    familySize,
    draws,
    seed: String(seed),
    calibrationTaskCount: groups.size,
    results,
  };
}
