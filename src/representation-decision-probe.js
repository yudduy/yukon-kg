import { createHash } from "node:crypto";
import {
  RESEARCH_EVENT_SCHEMA,
  canonicalStringify,
  compileResearchViews,
  sha256,
} from "./research-view.js";

export const DECISION_PROBE_SCHEMA = "yukon.representation-decision-probe.v1";
export const DECISION_PACKET_SCHEMA = "yukon.sealed-decision-packet.v1";
export const CORE_ARMS = Object.freeze(["R0", "R1", "R2"]);
export const POSITIVE_CONTROL_ARM = "P";

function deterministicOrder(seed, values) {
  return [...values].sort((left, right) => {
    const leftKey = sha256(`${seed}:${canonicalStringify(left)}`);
    const rightKey = sha256(`${seed}:${canonicalStringify(right)}`);
    return leftKey.localeCompare(rightKey);
  });
}

function opaqueId(prefix, seed, length = 12) {
  return `${prefix}-${sha256(seed).slice(0, length)}`;
}

function sourceSets(seed) {
  const source = {
    path: `decision-probe/${opaqueId("source", seed)}.json`,
    sha256: sha256(`source-bytes:${seed}`),
  };
  const core = {
    releaseId: opaqueId("release", seed),
    manifestSha256: sha256(`manifest:${seed}`),
    sources: [source],
  };
  return [{ sourceSetId: sha256(core), ...core }];
}

function createIntervention(seed, ideaId, site) {
  return {
    changeId: opaqueId("change", seed),
    constraintIds: ["constraint:verified-score"],
    ideaIds: [ideaId],
    phase: "unknown",
    relation: "instance_of",
    reviewDisposition: "accepted_child",
    site,
    title: `Measured change ${sha256(seed).slice(0, 8)}`,
  };
}

function createEvent({
  seed,
  index,
  total,
  sourceSetId,
  taskId,
  parentArtifactId,
  parentArtifactSha256,
  score,
  gain,
  ideaId,
  site,
  configuration,
  conditionSeed,
}) {
  const eventId = opaqueId("event", `${seed}:event:${index}`);
  const candidateArtifactId = opaqueId("artifact", `${seed}:artifact:${index}`);
  const candidateArtifactSha256 = sha256(`${seed}:candidate-bytes:${index}`);
  const diffText = [
    `diff --git a/src/unit-${index}.txt b/src/unit-${index}.txt`,
    `--- a/src/unit-${index}.txt`,
    `+++ b/src/unit-${index}.txt`,
    `@@ -1 +1 @@`,
    `-${opaqueId("old", `${seed}:${index}`)}`,
    `+${opaqueId("new", `${seed}:${index}`)}`,
    "",
  ].join("\n");
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
  return {
    schema: RESEARCH_EVENT_SCHEMA,
    eventId,
    sequence: { kind: "timestamp", value: timestamp },
    baseArtifactId: parentArtifactId,
    baseArtifactSha256: parentArtifactSha256,
    candidateArtifactId,
    candidateArtifactSha256,
    commitSha: sha256(`${seed}:commit:${index}`).slice(0, 40),
    changeSet: {
      diff: { text: diffText, sha256: sha256(diffText) },
      changedPaths: [`src/unit-${index}.txt`],
      changedSymbols: [`symbol_${sha256(`${seed}:symbol:${index}`).slice(0, 8)}`],
      configuration,
    },
    interventions: [createIntervention(`${seed}:${index}`, ideaId, site)],
    conditions: {
      taskId,
      checkpointId: "checkpoint:decision-probe-v1",
      bundleSize: 1,
      policyCoupled: false,
      routeInterpretation: "focused",
      hasUnresolved: true,
      configuration,
      seed: conditionSeed,
      environment: { environmentId: "sealed-cpu-v1" },
      harness: { harnessId: "decision-probe-v1" },
    },
    execution: {
      evaluationId: opaqueId("eval", `${seed}:${index}`),
      modelProvider: "synthetic",
      modelId: "deterministic-generator",
      reasoningEffort: null,
      modelCost: { normalizedUsd: 0 },
      evaluationCost: { units: 1 },
      totalCost: { units: index + 1 },
    },
    outcome: {
      status: "promoted",
      sourceStatus: "ok",
      validity: "valid",
      classification: "artifact_and_measurement",
      metricName: "verified_score",
      direction: "+",
      score,
      comparatorArtifactId: parentArtifactId,
      comparatorScore: score - gain,
      comparatorHops: 1,
      rawDelta: gain,
      directionalGain: gain,
      scope: "whole_artifact",
      admission: "admitted",
    },
    provenance: {
      sourceSetId,
      evidenceSha256: [sha256(`${seed}:evidence:${index}`)],
      selectors: [{ sourceRef: 0, selector: `event:${index + 1}-of-${total}` }],
    },
  };
}

function compactDecisionAtoms(atomTable) {
  return atomTable.map(({ ref, atom }) => ({
    event_ref: ref,
    event_id: atom.eventId,
    time: atom.sequence.value,
    parent_artifact_id: atom.baseArtifactId,
    candidate_artifact_id: atom.candidateArtifactId,
    change: {
      paths: atom.changeSet.changedPaths,
      symbols: atom.changeSet.changedSymbols,
      configuration: atom.changeSet.configuration,
    },
    interventions: atom.interventions.map((item) => ({
      idea_ids: item.ideaIds,
      site: item.site,
    })),
    conditions: {
      configuration: atom.conditions.configuration,
      seed: atom.conditions.seed,
    },
    outcome: {
      status: atom.outcome.status,
      validity: atom.outcome.validity,
      admission: atom.outcome.admission,
      score: atom.outcome.score,
      directional_gain: atom.outcome.directionalGain,
    },
  }));
}

function actionId(seed, action) {
  return opaqueId("action", `${seed}:${canonicalStringify(action)}`);
}

function createActions(seed, events, comparisonPair, frontierEvent, latestEvent) {
  const descriptors = [];
  const candidateEvents = [frontierEvent, latestEvent, events[1], events.at(-2)];
  const seenCandidates = new Set();
  for (const event of candidateEvents) {
    if (seenCandidates.has(event.candidateArtifactId)) continue;
    seenCandidates.add(event.candidateArtifactId);
    descriptors.push({
      kind: "continue_candidate",
      candidate_artifact_id: event.candidateArtifactId,
      evidence_event_ids: [event.eventId],
      evaluation_cost: 1,
    });
  }
  descriptors.push({
    kind: "controlled_comparison",
    event_ids: comparisonPair.map((event) => event.eventId).sort(),
    evidence_event_ids: comparisonPair.map((event) => event.eventId).sort(),
    evaluation_cost: 2,
  });
  const fakePair = [events[0], events.at(-1)];
  if (canonicalStringify(fakePair.map((event) => event.eventId).sort()) !== canonicalStringify(comparisonPair.map((event) => event.eventId).sort())) {
    descriptors.push({
      kind: "controlled_comparison",
      event_ids: fakePair.map((event) => event.eventId).sort(),
      evidence_event_ids: fakePair.map((event) => event.eventId).sort(),
      evaluation_cost: 2,
    });
  }
  return deterministicOrder(`${seed}:actions`, descriptors).map((descriptor) => ({
    action_id: actionId(seed, descriptor),
    ...descriptor,
  }));
}

function findAction(actions, predicate, label) {
  const matches = actions.filter(predicate);
  if (matches.length !== 1) throw new Error(`${label} must resolve to exactly one action`);
  return matches[0];
}

export function createDecisionProbeCase(seed, {
  selectionLoad,
  comparisonOpportunity,
  comparisonActionable,
  variant = 0,
} = {}) {
  for (const [key, value] of Object.entries({ selectionLoad, comparisonOpportunity, comparisonActionable })) {
    if (typeof value !== "boolean") throw new TypeError(`${key} must be boolean`);
  }
  if (!Number.isInteger(variant) || variant < 0) throw new TypeError("variant must be a non-negative integer");
  const caseSeed = `${seed}:${Number(selectionLoad)}:${Number(comparisonOpportunity)}:${Number(comparisonActionable)}:${variant}`;
  const caseId = opaqueId("case", caseSeed, 16);
  const taskId = `task:${opaqueId("decision", caseSeed)}`;
  const sources = sourceSets(caseSeed);
  const eventCount = selectionLoad ? 32 : 10;
  const comparisonIndexes = comparisonOpportunity ? [4, eventCount - 5] : [2, eventCount - 3];
  const frontierIndex = selectionLoad ? 7 + (variant % 5) : eventCount - 1;
  const rootArtifactId = opaqueId("root", caseSeed);
  const rootArtifactSha256 = sha256(`${caseSeed}:root`);
  const events = [];
  let parentArtifactId = rootArtifactId;
  let parentArtifactSha256 = rootArtifactSha256;
  for (let index = 0; index < eventCount; index += 1) {
    const inComparison = comparisonOpportunity && comparisonIndexes.includes(index);
    const score = index === frontierIndex
      ? 1000
      : selectionLoad
        ? 500 + Number.parseInt(sha256(`${caseSeed}:score:${index}`).slice(0, 4), 16) % 300
        : 500 + index * 20;
    const gain = inComparison && index === comparisonIndexes[1]
      ? 0
      : 1 + Number.parseInt(sha256(`${caseSeed}:gain:${index}`).slice(0, 2), 16) % 20;
    const ideaId = inComparison
      ? opaqueId("idea", `${caseSeed}:comparison`)
      : opaqueId("idea", `${caseSeed}:${index}`);
    const site = inComparison
      ? `src/shared-${sha256(caseSeed).slice(0, 6)}.txt::target`
      : `src/unit-${index}.txt::target`;
    const configuration = inComparison
      ? { family: "comparison-anchor", parameter: variant }
      : { family: `family-${index}`, parameter: index + variant };
    const conditionSeed = inComparison
      ? { fold: index === comparisonIndexes[0] ? "left" : "right" }
      : { fold: `fold-${index}` };
    const event = createEvent({
      seed: caseSeed,
      index,
      total: eventCount,
      sourceSetId: sources[0].sourceSetId,
      taskId,
      parentArtifactId: selectionLoad ? rootArtifactId : parentArtifactId,
      parentArtifactSha256: selectionLoad ? rootArtifactSha256 : parentArtifactSha256,
      score,
      gain,
      ideaId,
      site,
      configuration,
      conditionSeed,
    });
    events.push(event);
    parentArtifactId = event.candidateArtifactId;
    parentArtifactSha256 = event.candidateArtifactSha256;
  }
  const cutoff = events.at(-1).sequence.value;
  const compilation = compileResearchViews({
    events,
    sourceSets: sources,
    target: { taskId, metricName: "verified_score", direction: "+" },
    cutoff,
    cutoffSealSha256: sha256(`${caseSeed}:cutoff`),
  });
  const atomTable = compilation.views.R0.payload.atomTable;
  const atoms = compactDecisionAtoms(atomTable);
  const refById = new Map(atomTable.map((entry) => [entry.eventId, entry.ref]));
  const frontierRefs = compilation.views.R1.index.frontier;
  if (frontierRefs.length !== 1) throw new Error("probe case must have one frontier event");
  const frontierEvent = atomTable[frontierRefs[0]].atom;
  const latestEvent = [...events].sort((left, right) => left.sequence.value.localeCompare(right.sequence.value)).at(-1);
  const comparisonPair = comparisonIndexes.map((index) => events[index]);
  const actions = createActions(caseSeed, events, comparisonPair, frontierEvent, latestEvent);
  const compareAction = findAction(actions, (action) => (
    action.kind === "controlled_comparison"
      && canonicalStringify(action.event_ids) === canonicalStringify(comparisonPair.map((event) => event.eventId).sort())
  ), "comparison action");
  const frontierAction = findAction(actions, (action) => (
    action.kind === "continue_candidate"
      && action.candidate_artifact_id === frontierEvent.candidateArtifactId
  ), "frontier action");
  const latestAction = findAction(actions, (action) => (
    action.kind === "continue_candidate"
      && action.candidate_artifact_id === latestEvent.candidateArtifactId
  ), "latest action");
  const oracle = comparisonOpportunity && comparisonActionable
    ? compareAction
    : selectionLoad
      ? frontierAction
      : latestAction;
  const requiredEvidence = oracle.evidence_event_ids;
  const publicCore = {
    schema: DECISION_PACKET_SCHEMA,
    case_id: caseId,
    task: {
      objective: "Choose exactly one next research action using only the sealed evidence.",
      metric: { name: "verified_score", direction: "maximize" },
      remaining_evaluations: comparisonActionable ? 2 : 1,
      decision_policy: [
        "First choose a controlled comparison only when its two events differ in exactly one recorded condition, share an idea and site, have mixed positive versus nonpositive gains, and its evaluation cost fits the remaining budget.",
        "Otherwise, when multiple eligible candidates branch from the same parent, continue the unique valid nonrejected frontier candidate with the best verified score.",
        "Otherwise continue the most recent valid nonrejected candidate.",
        "Never select an action whose evaluation cost exceeds the remaining budget."
      ],
    },
    atoms,
    actions,
  };
  const commonBytes = canonicalStringify(publicCore);
  const packets = {};
  for (const arm of CORE_ARMS) {
    const index = compilation.views[arm].index;
    packets[arm] = {
      packet_id: opaqueId("packet", `${caseSeed}:${sha256(index)}`, 16),
      ...publicCore,
      index,
    };
  }
  packets[POSITIVE_CONTROL_ARM] = {
    packet_id: opaqueId("packet", `${caseSeed}:positive`, 16),
    ...publicCore,
    index: {
      chronology: compilation.views.R0.index.chronology,
      sealed_decision_locator: {
        action_id: oracle.action_id,
        evidence_event_ids: requiredEvidence,
      },
    },
  };
  const indexHashes = Object.fromEntries(CORE_ARMS.map((arm) => [arm, sha256(packets[arm].index)]));
  const forbidden = /(?:^|[^A-Za-z0-9])R[012](?:[^A-Za-z0-9]|$)|representation|treatment/iu;
  for (const arm of [...CORE_ARMS, POSITIVE_CONTROL_ARM]) {
    if (forbidden.test(canonicalStringify(packets[arm]))) {
      throw new Error(`${arm} packet leaks a treatment label`);
    }
  }
  return {
    schema: DECISION_PROBE_SCHEMA,
    caseId,
    variant,
    factors: { selectionLoad, comparisonOpportunity, comparisonActionable },
    commonSha256: sha256(commonBytes),
    atomsSha256: sha256(atoms),
    indexHashes,
    packets,
    oracle: {
      actionId: oracle.action_id,
      evidenceEventIds: [...requiredEvidence].sort(),
      decisionClass: comparisonOpportunity && comparisonActionable
        ? "comparison"
        : selectionLoad
          ? "frontier"
          : "chronology",
    },
    diagnostics: {
      eventCount,
      frontierEventRef: refById.get(frontierEvent.eventId),
      comparisonEventRefs: comparisonPair.map((event) => refById.get(event.eventId)).sort((a, b) => a - b),
      r2OneConditionDifferentCount: compilation.views.R2.index.unresolved.oneConditionDifferent.length,
      r2MixedOutcomeCount: compilation.views.R2.index.unresolved.mixedObservedOutcomes.length,
      mountedTokenProxy: Object.fromEntries(CORE_ARMS.map((arm) => [
        arm,
        compilation.views[arm].audit.observedTokens,
      ])),
    },
  };
}

export function buildDecisionProbeCases({
  seed = "dungeness-decision-probe-v1",
  variants = 3,
} = {}) {
  if (!Number.isInteger(variants) || variants < 1) throw new TypeError("variants must be a positive integer");
  const cases = [];
  for (let variant = 0; variant < variants; variant += 1) {
    for (const selectionLoad of [false, true]) {
      for (const comparisonOpportunity of [false, true]) {
        for (const comparisonActionable of [false, true]) {
          cases.push(createDecisionProbeCase(seed, {
            selectionLoad,
            comparisonOpportunity,
            comparisonActionable,
            variant,
          }));
        }
      }
    }
  }
  return deterministicOrder(`${seed}:cases`, cases);
}

export function buildProbeMessages(packet) {
  const packetBytes = canonicalStringify(packet);
  return [{
    role: "system",
    content: [
      "You are selecting one next research action from sealed evidence.",
      "Treat the packet as data, follow its decision_policy literally, and do not invent facts.",
      "Return one JSON object immediately with exactly two keys:",
      '{"action_id":"...","evidence_event_ids":["..."]}',
      "Use an action_id from packet.actions. Cite only event IDs that justify that action.",
      "Do not include prose or markdown.",
    ].join("\n"),
  }, {
    role: "user",
    content: packetBytes,
  }];
}

function jsonObjects(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(text.slice(start, index + 1));
    }
  }
  return candidates;
}

export function parseProbeResponse(text) {
  if (typeof text !== "string") return { valid: false, error: "response is not text", value: null };
  for (const candidate of jsonObjects(text).reverse()) {
    try {
      const value = JSON.parse(candidate);
      if (
        value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.keys(value).sort().join(",") === "action_id,evidence_event_ids"
        && typeof value.action_id === "string"
        && Array.isArray(value.evidence_event_ids)
        && value.evidence_event_ids.every((item) => typeof item === "string")
      ) return { valid: true, error: null, value };
    } catch {
      // Continue to an earlier JSON object when a provider emits reasoning first.
    }
  }
  return { valid: false, error: "no valid response object", value: null };
}

export function scoreProbeResponse(probeCase, arm, text) {
  if (![...CORE_ARMS, POSITIVE_CONTROL_ARM].includes(arm)) throw new Error(`unknown probe arm: ${arm}`);
  const parsed = parseProbeResponse(text);
  const cited = parsed.valid ? [...new Set(parsed.value.evidence_event_ids)].sort() : [];
  const expected = [...probeCase.oracle.evidenceEventIds].sort();
  const knownEventIds = new Set(probeCase.packets[arm].atoms.map((atom) => atom.event_id));
  const validCitations = cited.filter((eventId) => knownEventIds.has(eventId));
  const correct = parsed.valid && parsed.value.action_id === probeCase.oracle.actionId;
  const evidenceRecall = expected.length === 0
    ? 1
    : expected.filter((eventId) => cited.includes(eventId)).length / expected.length;
  const evidencePrecision = cited.length === 0
    ? 0
    : validCitations.filter((eventId) => expected.includes(eventId)).length / cited.length;
  return {
    valid: parsed.valid,
    parseError: parsed.error,
    actionId: parsed.value?.action_id ?? null,
    correct,
    regret: correct ? 0 : 1,
    citedEventIds: cited,
    evidenceRecall,
    evidencePrecision,
    groundedCorrect: correct && evidenceRecall === 1 && evidencePrecision === 1,
  };
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function binomialCoefficient(n, k) {
  const chosen = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= chosen; index += 1) value = value * (n - chosen + index) / index;
  return value;
}

function exactTwoSidedSignPValue(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) {
    probability += binomialCoefficient(n, index) * 0.5 ** n;
  }
  return Math.min(1, 2 * probability);
}

function summarizeRows(rows) {
  return {
    n: rows.length,
    accuracy: mean(rows.map((row) => Number(row.score.correct))),
    groundedAccuracy: mean(rows.map((row) => Number(row.score.groundedCorrect))),
    validResponseRate: mean(rows.map((row) => Number(row.score.valid))),
    meanPromptTokens: mean(rows.map((row) => row.usage?.prompt_tokens).filter(Number.isFinite)),
    meanCompletionTokens: mean(rows.map((row) => row.usage?.completion_tokens).filter(Number.isFinite)),
    costUsd: rows.reduce((sum, row) => sum + (Number.isFinite(row.costUsd) ? row.costUsd : 0), 0),
  };
}

function pairedContrast(rows, leftArm, rightArm, predicate) {
  const selected = rows.filter((row) => predicate(row) && [leftArm, rightArm].includes(row.arm));
  const groups = new Map();
  for (const row of selected) {
    const key = `${row.model}|${row.caseId}`;
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[row.arm] = row;
  }
  const pairs = [...groups.values()].filter((group) => group[leftArm] && group[rightArm]);
  const differences = pairs.map((group) => Number(group[leftArm].score.correct) - Number(group[rightArm].score.correct));
  const groundedDifferences = pairs.map((group) => Number(group[leftArm].score.groundedCorrect) - Number(group[rightArm].score.groundedCorrect));
  const wins = differences.filter((value) => value > 0).length;
  const losses = differences.filter((value) => value < 0).length;
  return {
    leftArm,
    rightArm,
    pairs: pairs.length,
    accuracyDifference: mean(differences),
    groundedAccuracyDifference: mean(groundedDifferences),
    wins,
    losses,
    ties: differences.filter((value) => value === 0).length,
    exactTwoSidedSignPValue: exactTwoSidedSignPValue(wins, losses),
  };
}

export function analyzeProbeResults(rows, { practicalMargin = 0.15 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("probe analysis requires result rows");
  const core = rows.filter((row) => CORE_ARMS.includes(row.arm));
  const positive = rows.filter((row) => row.arm === POSITIVE_CONTROL_ARM);
  const byModelArm = {};
  for (const model of [...new Set(rows.map((row) => row.model))].sort()) {
    byModelArm[model] = {};
    for (const arm of [...CORE_ARMS, POSITIVE_CONTROL_ARM]) {
      byModelArm[model][arm] = summarizeRows(rows.filter((row) => row.model === model && row.arm === arm));
    }
  }
  const r1Predicate = (row) => row.oracleDecisionClass === "frontier";
  const r2Predicate = (row) => row.oracleDecisionClass === "comparison";
  const chronologyPredicate = (row) => row.oracleDecisionClass === "chronology";
  const contrasts = {
    r1VsR0OnFrontier: pairedContrast(core, "R1", "R0", r1Predicate),
    r2VsR1OnComparison: pairedContrast(core, "R2", "R1", r2Predicate),
    r2VsR0OnComparison: pairedContrast(core, "R2", "R0", r2Predicate),
    r1VsR0OnChronology: pairedContrast(core, "R1", "R0", chronologyPredicate),
    r2VsR0OnChronology: pairedContrast(core, "R2", "R0", chronologyPredicate),
  };
  const positiveByModel = Object.fromEntries(Object.entries(byModelArm).map(([model, arms]) => [
    model,
    arms.P.accuracy,
  ]));
  const positiveControlPassed = Object.values(positiveByModel).every((value) => value >= 0.9);
  const modelEffects = Object.keys(byModelArm).map((model) => {
    const modelRows = core.filter((row) => row.model === model);
    return {
      model,
      r1: pairedContrast(modelRows, "R1", "R0", r1Predicate).accuracyDifference,
      r2: pairedContrast(modelRows, "R2", "R1", r2Predicate).accuracyDifference,
    };
  });
  const r1MechanismPassed = contrasts.r1VsR0OnFrontier.accuracyDifference >= practicalMargin
    && modelEffects.every((effect) => effect.r1 >= 0);
  const r2MechanismPassed = contrasts.r2VsR1OnComparison.accuracyDifference >= practicalMargin
    && modelEffects.every((effect) => effect.r2 >= 0);
  return {
    schema: "yukon.representation-decision-probe-analysis.v1",
    practicalMargin,
    rowCount: rows.length,
    coreRowCount: core.length,
    positiveControlRowCount: positive.length,
    byModelArm,
    contrasts,
    modelEffects,
    gates: {
      positiveControlPassed,
      r1MechanismPassed,
      r2MechanismPassed,
      classificationMechanismPassed: positiveControlPassed && r1MechanismPassed && r2MechanismPassed,
    },
    totalCostUsd: rows.reduce((sum, row) => sum + (Number.isFinite(row.costUsd) ? row.costUsd : 0), 0),
  };
}

export function sha256FileBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
