import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = "yukon-kg.handoff-mve.v6";
export const MODEL = "gpt-5.6-luna";
export const SEARCH_COMMIT = "51c6c31c722cc3a6c68867272e5959b4684c4142";
export const POSITIVE_CONTROL_COMMIT = "d919bc64a3b6a236e17870a69993fd76a21a8092";
export const REPOSITORY_URL = "https://github.com/Layr-Labs/ecdsafail-challenge";
export const MDE_PERCENT = 0.5;
export const CALIBRATION_BLOCKS = 4;
export const PRELUDE_EVALUATIONS = 6;
export const ARM_EVALUATIONS = 8;
export const CONFIRMATORY_MIN_BLOCKS = 8;
export const CONFIRMATORY_MAX_BLOCKS = 24;
export const POWER_DRAWS = 10_000;

export const TUNING_BASELINE = Object.freeze({
  candidateId: "ladder-064",
  chunkMin: 200,
  ladder: 64,
});

function tuningRegion(ladder) {
  if (ladder <= 36) return "substantially lower carry-ladder budget";
  if (ladder <= 62) return "nearby lower carry-ladder budget";
  if (ladder <= 96) return "nearby higher carry-ladder budget";
  return "substantially higher carry-ladder budget";
}

export const TUNING_CANDIDATES = Object.freeze(
  Array.from({ length: 93 }, (_, index) => 8 + 2 * index)
    .filter((ladder) => ladder !== TUNING_BASELINE.ladder)
    .map((ladder) => Object.freeze({
      candidateId: `ladder-${String(ladder).padStart(3, "0")}`,
      chunkMin: TUNING_BASELINE.chunkMin,
      ladder,
      region: tuningRegion(ladder),
    })),
);

export const TUNING_ALTERNATIVES = Object.freeze([
  {
    id: "substantially-lower",
    interventionFamily: "substantially lower carry-ladder budget",
    hypothesis: "A much smaller live carry ladder can reduce peak qubits enough to offset extra executed operations.",
    falsifier: "Measured score does not improve over the incumbent configuration.",
  },
  {
    id: "nearby-lower",
    interventionFamily: "nearby lower carry-ladder budget",
    hypothesis: "A moderately smaller live carry ladder can improve the operation-count and qubit tradeoff.",
    falsifier: "Measured score does not improve over the incumbent configuration.",
  },
  {
    id: "nearby-higher",
    interventionFamily: "nearby higher carry-ladder budget",
    hypothesis: "A moderately larger live carry ladder can reduce executed operations enough to offset extra qubits.",
    falsifier: "Measured score does not improve over the incumbent configuration.",
  },
  {
    id: "substantially-higher",
    interventionFamily: "substantially higher carry-ladder budget",
    hypothesis: "A much larger live carry ladder can reduce chunk-boundary work enough to improve the combined score.",
    falsifier: "Measured score does not improve over the incumbent configuration.",
  },
]);

export const CONDITION_DEFINITIONS = Object.freeze({
  A: {
    label: "incumbent session",
    instruction: "Select the next discriminating configuration using the complete incumbent session context.",
  },
  B: {
    label: "fresh allocator with complete narrative",
    instruction: "Select the next discriminating configuration from the complete journal, rationales, failures, and plan.",
  },
  C: {
    label: "fresh blinded reviewer",
    instruction: "Review the alternatives symmetrically and select the next discriminating configuration.",
  },
  D: {
    label: "fresh blinded allocator with explicit budget",
    instruction: "You have eight fresh evaluations; allocate them among these options.",
  },
});

export const PRIMARY_CONTRASTS = Object.freeze({
  h1: { control: "A", treatment: "B", label: "Fresh allocator with complete narrative vs incumbent session" },
  h2: { control: "C", treatment: "D", label: "Fresh blinded allocator with explicit budget vs fresh blinded reviewer" },
  product: { control: "A", treatment: "D", label: "Complete handoff vs incumbent session" },
});

const SCORE_PATTERN = /product-register square:\s*(\d+)\s+emitted\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s+executed Toffoli,\s*(\d+)\s+peak qubits/u;
const BLINDED_FORBIDDEN = [
  { label: "first-person language", pattern: /\b(?:I|me|my|mine|we|us|our|ours)\b/iu },
  { label: "continuation framing", pattern: /\bcontinu(?:e|ed|es|ing|ation)\b/iu },
  { label: "sunk-cost framing", pattern: /\b(?:sunk cost|already spent|invested so far)\b/iu },
  { label: "author identity", pattern: /\b(?:author|worker identity|agent identity)\b/iu },
  { label: "sealed commit", pattern: /\b(?:d919bc6|d919bc64a3b6a236e17870a69993fd76a21a8092)\b/iu },
  { label: "sealed toggle", pattern: /SUB4_SQUARE_KARATSUBA2/iu },
  { label: "sealed result", pattern: /\b(?:56059\.047|58709\.125|4\.738938)\b/u },
];

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = normalize(value[key]);
    }
    return result;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : canonicalStringify(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseSquareScore(output) {
  const match = output.match(SCORE_PATTERN);
  if (!match) throw new Error("square self-test output did not contain a score line");
  const emittedToffoli = Number.parseInt(match[1], 10);
  const executedToffoli = Number.parseFloat(match[2]);
  const peakQubits = Number.parseInt(match[3], 10);
  return {
    emittedToffoli,
    executedToffoli,
    peakQubits,
    score: executedToffoli * peakQubits,
  };
}

export function verifyDuplicateScores(first, second) {
  for (const key of ["emittedToffoli", "executedToffoli", "peakQubits", "score"]) {
    if (first[key] !== second[key]) {
      throw new Error(`duplicate square scores disagree on ${key}: ${first[key]} != ${second[key]}`);
    }
  }
  return { ...first, reproductions: 2 };
}

function neutralEvidenceRecord(record) {
  return {
    evaluationId: record.evaluationId,
    baseArtifactId: record.baseArtifactId,
    candidateArtifactId: record.candidateArtifactId ?? null,
    interventionFamily: record.interventionFamily,
    hypothesis: record.hypothesis,
    falsifier: record.falsifier,
    validity: record.validity,
    protocolViolation: record.protocolViolation ?? false,
    executedToffoli: record.score?.executedToffoli ?? null,
    peakQubits: record.score?.peakQubits ?? null,
    score: record.score?.score ?? null,
    ...(record.candidateId ? { candidateId: record.candidateId } : {}),
    ...(record.configuration ? { configuration: record.configuration } : {}),
  };
}

function blindedEvidenceRecord(record) {
  const neutral = neutralEvidenceRecord(record);
  const matchCase = (replacement) => (match) => (
    match[0] === match[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement
  );
  const redactContinuation = (text) => text
    .replace(/\bcontinuation\b/giu, matchCase("persistence"))
    .replace(/\bcontinuing\b/giu, matchCase("proceeding"))
    .replace(/\bcontinued\b/giu, matchCase("proceeded"))
    .replace(/\bcontinues\b/giu, matchCase("proceeds"))
    .replace(/\bcontinue\b/giu, matchCase("proceed"));
  return {
    ...neutral,
    hypothesis: redactContinuation(neutral.hypothesis),
    falsifier: redactContinuation(neutral.falsifier),
  };
}

function packetCore(state) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    task: state.task ?? "Reduce executed Toffoli multiplied by peak qubits in the isolated product-square self-test.",
    contract: state.contract ?? {
      command: "SUB4_PRODUCT_SQUARE_SELFTEST=1 cargo run --release --bin build_circuit",
      endpoint: "best valid executed Toffoli multiplied by peak qubits",
      remainingEvaluations: state.remainingEvaluations,
    },
    ...(state.forkArtifactId ? { forkArtifactId: state.forkArtifactId } : {}),
    frontier: (state.frontier ?? []).map(({ artifactId, score }) => ({ artifactId, score })),
    evidence: state.evidence.map(neutralEvidenceRecord),
    alternatives: state.alternatives.map((item) => ({
      id: item.id,
      interventionFamily: item.interventionFamily,
      hypothesis: item.hypothesis,
      falsifier: item.falsifier,
    })),
    ...(state.candidates ? { candidates: state.candidates.map((candidate) => ({ ...candidate })) } : {}),
  };
}

export function compileConditionPacket(condition, state) {
  if (!(condition in CONDITION_DEFINITIONS)) throw new Error(`unknown condition: ${condition}`);
  const core = packetCore(state);
  if (condition === "A") {
    return { ...core, condition: "incumbent", instruction: CONDITION_DEFINITIONS.A.instruction };
  }
  if (condition === "B") {
    return {
      ...core,
      condition: "narrative handoff",
      instruction: CONDITION_DEFINITIONS.B.instruction,
      journal: state.evidence.map((record) => ({
        evaluationId: record.evaluationId,
        rationale: record.rationale,
        planUpdate: record.planUpdate,
        result: neutralEvidenceRecord(record),
      })),
      incumbentPlan: state.incumbentPlan,
    };
  }
  const packet = {
    ...core,
    evidence: state.evidence.map(blindedEvidenceRecord),
    condition: "blinded",
    instruction: CONDITION_DEFINITIONS[condition].instruction,
  };
  assertBlindedPacket(packet);
  return packet;
}

export function assertBlindedPacket(packet) {
  const serialized = canonicalStringify(packet);
  const violations = BLINDED_FORBIDDEN
    .filter(({ pattern }) => pattern.test(serialized))
    .map(({ label }) => label);
  if (violations.length > 0) {
    throw new Error(`blinded packet contains forbidden content: ${violations.join(", ")}`);
  }
  return packet;
}

export function packetDifference(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].sort().filter((key) => canonicalStringify(left[key]) !== canonicalStringify(right[key]));
}

export function pairedImprovementPercent(controlScore, treatmentScore) {
  if (!(controlScore > 0) || !(treatmentScore > 0)) throw new Error("scores must be positive");
  return 100 * (controlScore - treatmentScore) / controlScore;
}

export function assessTuningLandscape(baselineScore, measurements, {
  mdePercent = MDE_PERCENT,
} = {}) {
  const valid = measurements.filter((measurement) => measurement.validity === "valid");
  const distinctScores = new Set(valid.map((measurement) => measurement.score.score)).size;
  const improvements = valid.map((measurement) => pairedImprovementPercent(
    baselineScore,
    measurement.score.score,
  ));
  const bestImprovementPercent = improvements.length > 0 ? Math.max(...improvements) : 0;
  const meaningful = improvements.filter((improvement) => improvement >= mdePercent).length;
  const meaningfulFraction = valid.length === 0 ? 0 : meaningful / valid.length;
  const bestMeasurement = valid.reduce((best, measurement) => (
    !best || measurement.score.score < best.score.score ? measurement : best
  ), null);
  const bestCandidateIds = bestMeasurement
    ? valid
      .filter((measurement) => measurement.score.score === bestMeasurement.score.score)
      .map((measurement) => measurement.candidateId)
      .sort()
    : [];
  const corrections = [];
  if (measurements.length <= PRELUDE_EVALUATIONS + ARM_EVALUATIONS) {
    corrections.push("candidate set can be exhausted within one search");
  }
  if (measurements.length === 0 || valid.length / measurements.length < 0.9) corrections.push("more than 10% of configurations are invalid");
  if (distinctScores < 8) corrections.push("configuration landscape has fewer than eight distinct scores");
  if (bestImprovementPercent < mdePercent) corrections.push("no configuration reaches the minimum meaningful improvement");
  if (bestImprovementPercent > 5) corrections.push("best configuration is more than 5% better and is too far from the incumbent");
  if (meaningfulFraction < 0.05) corrections.push("fewer than 5% of valid configurations are meaningfully better");
  if (meaningfulFraction > 0.4) corrections.push("more than 40% of valid configurations are meaningfully better");
  return {
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    configurations: measurements.length,
    validConfigurations: valid.length,
    distinctScores,
    bestScore: bestMeasurement?.score.score ?? null,
    bestCandidateId: bestMeasurement?.candidateId ?? null,
    bestCandidateIds,
    bestImprovementPercent,
    meaningfulConfigurations: meaningful,
    meaningfulFraction,
  };
}

export function assessPilotInformativeness({ baselineScore, optimumScore, conditions }, {
  mdePercent = MDE_PERCENT,
} = {}) {
  const scores = Object.values(conditions).map((condition) => condition.bestScore);
  const improvements = scores.map((score) => pairedImprovementPercent(baselineScore, score));
  if (scores.every((score) => score === optimumScore)) {
    return { status: "TASK_TOO_EASY", improvements };
  }
  if (Math.max(...improvements) < mdePercent) {
    return { status: "TASK_TOO_HARD", improvements };
  }
  if (new Set(scores).size === 1) {
    return { status: "NO_CONDITION_SEPARATION", improvements };
  }
  return { status: "PASS", improvements };
}

export function mean(values) {
  if (values.length === 0) throw new Error("mean requires at least one value");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trailingBitIndex(value) {
  return 31 - Math.clz32(value & -value);
}

export function exactSignFlipPValue(differences, nullShift = 0) {
  if (differences.length === 0 || differences.length > 24) {
    throw new Error("exact sign-flip inference requires 1 to 24 paired differences");
  }
  const centered = differences.map((value) => value - nullShift);
  const observed = centered.reduce((sum, value) => sum + value, 0);
  const tolerance = 1e-10 * Math.max(1, Math.abs(observed));
  const permutations = 2 ** centered.length;
  let permutationSum = -observed;
  let previousGray = 0;
  let atLeastObserved = permutationSum >= observed - tolerance ? 1 : 0;
  for (let index = 1; index < permutations; index += 1) {
    const gray = index ^ (index >>> 1);
    const changed = gray ^ previousGray;
    const bit = trailingBitIndex(changed);
    permutationSum += (gray & changed) === 0 ? -2 * centered[bit] : 2 * centered[bit];
    if (permutationSum >= observed - tolerance) atLeastObserved += 1;
    previousGray = gray;
  }
  return atLeastObserved / permutations;
}

export function holmAdjust(pValues) {
  const entries = Object.entries(pValues).sort((left, right) => left[1] - right[1]);
  const adjusted = {};
  let runningMaximum = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index];
    runningMaximum = Math.max(runningMaximum, Math.min(1, value * (entries.length - index)));
    adjusted[key] = runningMaximum;
  }
  return adjusted;
}

export function createPrng(seedText) {
  const digest = createHash("sha256").update(seedText).digest();
  let state = digest.readUInt32LE(0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function sampleWithReplacement(values, count, random) {
  return Array.from({ length: count }, () => values[Math.floor(random() * values.length)]);
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function bootstrapUpperBound(differences, {
  alpha = 0.05 / 3,
  draws = POWER_DRAWS,
  seed = "upper-bound",
} = {}) {
  if (differences.length < 2) return Number.POSITIVE_INFINITY;
  const random = createPrng(seed);
  const estimates = new Array(draws);
  for (let draw = 0; draw < draws; draw += 1) {
    estimates[draw] = mean(sampleWithReplacement(differences, differences.length, random));
  }
  estimates.sort((left, right) => left - right);
  const index = Math.min(draws - 1, Math.ceil((1 - alpha) * draws) - 1);
  return estimates[index];
}

export function estimateConfirmatoryBlocks(calibrationByContrast, {
  draws = POWER_DRAWS,
  mdePercent = MDE_PERCENT,
  minimum = CONFIRMATORY_MIN_BLOCKS,
  maximum = CONFIRMATORY_MAX_BLOCKS,
  seed = "power",
} = {}) {
  const requirements = {};
  const conservativeCriticalZ = 2.128045234184983;
  for (const [contrast, values] of Object.entries(calibrationByContrast)) {
    if (values.length !== CALIBRATION_BLOCKS) {
      throw new Error(`${contrast} requires exactly ${CALIBRATION_BLOCKS} calibration blocks`);
    }
    const center = mean(values);
    const residuals = values.map((value) => value - center);
    const random = createPrng(`${seed}:${contrast}`);
    let selected = null;
    for (let count = minimum; count <= maximum; count += 1) {
      let rejections = 0;
      for (let draw = 0; draw < draws; draw += 1) {
        const simulated = sampleWithReplacement(residuals, count, random)
          .map((residual) => residual + mdePercent);
        const deviation = sampleStandardDeviation(simulated);
        const statistic = deviation === 0
          ? Number.POSITIVE_INFINITY
          : mean(simulated) / (deviation / Math.sqrt(count));
        if (statistic >= conservativeCriticalZ) rejections += 1;
      }
      if (rejections / draws >= 0.8) {
        selected = count;
        break;
      }
    }
    requirements[contrast] = selected;
  }
  const finite = Object.values(requirements).filter(Number.isInteger);
  const blocks = finite.length === Object.keys(requirements).length
    ? Math.max(...finite)
    : maximum;
  return {
    blocks,
    requirements,
    attainableAtCap: finite.length === Object.keys(requirements).length,
    draws,
    mdePercent,
  };
}

export function contrastDifferences(blocks, contrast) {
  const definition = PRIMARY_CONTRASTS[contrast];
  if (!definition) throw new Error(`unknown contrast: ${contrast}`);
  return blocks.map((block) => pairedImprovementPercent(
    block.conditions[definition.control].bestScore,
    block.conditions[definition.treatment].bestScore,
  ));
}

export function analyzeConfirmatoryBlocks(blocks, {
  mdePercent = MDE_PERCENT,
  alpha = 0.05,
  bootstrapDraws = POWER_DRAWS,
  seed = "confirmatory",
} = {}) {
  if (blocks.length === 0) throw new Error("confirmatory analysis requires blocks");
  const differences = Object.fromEntries(
    Object.keys(PRIMARY_CONTRASTS).map((key) => [key, contrastDifferences(blocks, key)]),
  );
  const rawP = Object.fromEntries(
    Object.entries(differences).map(([key, values]) => [key, exactSignFlipPValue(values)]),
  );
  const adjustedP = holmAdjust(rawP);
  const comparisons = {};
  for (const [key, values] of Object.entries(differences)) {
    const effect = mean(values);
    const upperBound = bootstrapUpperBound(values, {
      alpha: alpha / Object.keys(PRIMARY_CONTRASTS).length,
      draws: bootstrapDraws,
      seed: `${seed}:${key}`,
    });
    let verdict = "INCONCLUSIVE_AT_CAP";
    if (adjustedP[key] < alpha && effect >= mdePercent) verdict = "SUPPORTED";
    else if (upperBound < mdePercent) verdict = "NOT_SUPPORTED_AT_MDE";
    comparisons[key] = {
      label: PRIMARY_CONTRASTS[key].label,
      differences: values,
      meanImprovementPercent: effect,
      rawP: rawP[key],
      adjustedP: adjustedP[key],
      simultaneousUpperBoundPercent: upperBound,
      verdict,
    };
  }
  return {
    comparisons,
    proceedToLiveCourt: comparisons.product.verdict === "SUPPORTED",
    informationRemovalDiagnostic: blocks.map((block) => pairedImprovementPercent(
      block.conditions.B.bestScore,
      block.conditions.C.bestScore,
    )),
  };
}

export function bestValidArtifact(frontier) {
  const valid = frontier.filter((artifact) => artifact.validity === "valid" && artifact.score?.score > 0);
  if (valid.length === 0) throw new Error("frontier contains no valid artifact");
  return valid.reduce((best, artifact) => artifact.score.score < best.score.score ? artifact : best);
}
