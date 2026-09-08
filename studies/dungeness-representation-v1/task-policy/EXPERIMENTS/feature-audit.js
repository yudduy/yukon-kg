import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const waypointRoot = resolve(here, "../../../../../");
const evalRoot = resolve(waypointRoot, "eval");
const kgRoot = resolve(waypointRoot, "kg");

const histories = [
  {
    id: "ecdsa-archive-a",
    task: "ecdsa-fail-v2",
    source: "research-event-exports/v28-ecdsa-archive-a.json",
    views: {
      R0: "c389b4668dace4fbaaee266cfbeb24a6d2a5d67f56472cab37249bfed36625a4",
      R1: "47530b315d983283075c1a15ec8a2c83fda5bf3ebb493ca65e9f00dddb4e051d",
      R2: "c241122f15bbed4252ed1082ba006709b872058112a4a160a74a2a718ae5d8d3",
    },
  },
  {
    id: "ecdsa-archive-b",
    task: "ecdsa-fail-v2",
    source: "research-event-exports/v28-ecdsa-archive-b.json",
    views: {
      R0: "41d20c756ca43645126b031a22e965bb242cc613608b0dd255514acf7839b8ea",
      R1: "dd9a7719945437b48b3b6cfa98e424bf5c80ce6c3072fa9e3d6c732d82d50314",
      R2: "23881b0da8b354a1fbd0f21768806e8f9fc4ee90107484af1c024b766e87e4e6",
    },
  },
  {
    id: "toy-dual-prefix",
    task: "toy_isa_opt",
    source: "research-event-exports/v30-toy-dual-prefix.json",
    views: {
      R0: "e71aee50e8f6f46b18bf2072f382d0f7730d9a6879e1216bd7f083f0789f76df",
      R1: "b436853ec9918316b909b995fca1991180d465aea6cc5574330cf9c44782a0ea",
      R2: "03b09da4bc7588ade0beaa91b9d75738f4133b572ba1c66663e45153445e80b1",
    },
  },
  {
    id: "toy-mac-prefix",
    task: "toy_isa_opt",
    source: "research-event-exports/v30-toy-mac-prefix.json",
    views: {
      R0: "b0b6d5b2d8923f458da9378b0981ab2e4bae3d136e620979b807b65b8bac117e",
      R1: "3967139c46fb477612c22f01c73bb29bc39db62a61a337640cfc787087146684",
      R2: "08ddb329c801ba20b6a1966a7e88bc7f50c8737b7d4bb365cb487a07802fa4ce",
    },
  },
  {
    id: "vliw-chain-interleave",
    task: "vliw_scheduler",
    source: "research-event-exports/v30-vliw-chain-interleave.json",
    views: {
      R0: "5ffa3e42248b87fe98bc7c8efef549e4cbe1bee673c44e041379d88c996f58c3",
      R1: "a70344d1421f6a0728089842cf6d1dd965d00885637b92ed960aed576a3e1586",
      R2: "b58b7d02fcbedf5133aa67fd8828fc28ac818cf6fbac72e81ec770abb88c618e",
    },
  },
  {
    id: "vliw-slot-pairing",
    task: "vliw_scheduler",
    source: "research-event-exports/v30-vliw-slot-pairing.json",
    views: {
      R0: "81b9e78c2da0d9b6339ac9435926ed73294fcb6e74be96c935f5ab616cd824f5",
      R1: "a9f381979330a7491d55743006d6a861d5ee61ebcd6fe3fae654e79d3fb911c7",
      R2: "c2b42eb69060b40000e00a80fe8d1e41dc11f92369767f3de64689593e14dd33",
    },
  },
];

const vliwCells = [
  { treatment: "R0", cell: "study-c57f5b9d30bce1474" },
  { treatment: "R1", cell: "study-c502101fb1d334f6b" },
  { treatment: "R2", cell: "study-c5e9582127a51cae7" },
  { treatment: "R0", cell: "study-c8da9974463624662" },
  { treatment: "R1", cell: "study-c42893a6d16f67bfc" },
  { treatment: "R2", cell: "study-cceef56a4f5c05d5b" },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function unique(values) {
  return [...new Set(values)];
}

function mean(values) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractIndex(viewId) {
  const path = resolve(
    evalRoot,
    `research-views/users/bx/${viewId}.payload/index.md`,
  );
  const text = readFileSync(path, "utf8");
  const match = text.match(/```json\n([\s\S]+?)\n```/);
  if (!match) throw new Error(`index JSON not found: ${path}`);
  return JSON.parse(match[1]);
}

function eventFeatures(history) {
  const events = [...history.events].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );
  const interventions = events.flatMap((event) => event.interventions ?? []);
  const sites = interventions.map((item) => item.site ?? "unknown");
  const ideas = interventions.flatMap((item) => item.ideaIds ?? []);
  const configKeys = events.flatMap((event) =>
    (event.changes?.config ?? []).map((entry) => String(entry).split("=", 1)[0]),
  );
  const parents = events.map((event) => event.parent_content_sha256 ?? "unknown");
  const parentCounts = new Map();
  for (const parent of parents) {
    parentCounts.set(parent, (parentCounts.get(parent) ?? 0) + 1);
  }
  const directionalGains = events
    .map((event) => event.development_outcome?.measurement?.directional_gain)
    .filter((value) => Number.isFinite(value));
  const scores = events
    .map((event) => event.development_outcome?.metric?.value)
    .filter((value) => Number.isFinite(value));
  const pairwiseScoreDirections = scores.slice(1).map((score, index) =>
    Math.sign(scores[index] - score),
  );

  return {
    eventCount: events.length,
    validEventCount: events.filter((event) => event.development_outcome?.valid)
      .length,
    historyPayloadBytesMean: mean(
      events.map((event) => event.payload?.bytes).filter(Number.isFinite),
    ),
    changedPaths: unique(
      events.flatMap((event) => event.changes?.paths ?? []),
    ).length,
    changedSymbols: unique(
      events.flatMap((event) => event.changes?.symbols ?? []),
    ).length,
    configDimensions: unique(configKeys).length,
    interventionCount: interventions.length,
    uniqueSites: unique(sites).length,
    uniqueIdeas: unique(ideas).length,
    repeatedSiteFraction:
      sites.length === 0 ? 0 : 1 - unique(sites).length / sites.length,
    bundledEventFraction:
      events.filter((event) => (event.interventions ?? []).length > 1).length /
      events.length,
    branchingParentCount: [...parentCounts.values()].filter((count) => count > 1)
      .length,
    positiveDirectionalGainFraction:
      directionalGains.length === 0
        ? null
        : directionalGains.filter((gain) => gain > 0).length /
          directionalGains.length,
    scoreDirectionChanges: pairwiseScoreDirections
      .slice(1)
      .filter((direction, index) =>
        direction !== 0 &&
        pairwiseScoreDirections[index] !== 0 &&
        direction !== pairwiseScoreDirections[index],
      ).length,
  };
}

function findFiles(root, name) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) found.push(...findFiles(path, name));
    else if (entry === name) found.push(path);
  }
  return found;
}

function vliwTraceAudit() {
  const byRepresentation = Object.fromEntries(
    ["R0", "R1", "R2"].map((arm) => [
      arm,
      {
        sessions: 0,
        sessionsReadingView: 0,
        failedSessions: 0,
        developmentEvaluationCount: 0,
        recognized1200CycleLowerBound: 0,
        mentionedMountedResearch: 0,
        citedConcretePriorScore: 0,
      },
    ]),
  );
  const concretePriorScore = /\b(3180|3360|3540|3720|3780|3900|4080)\b/;

  for (const { treatment, cell } of vliwCells) {
    for (let round = 1; round <= 3; round += 1) {
      const runRoot = resolve(evalRoot, `runs/users/bx/${cell}-r${round}`);
      const trajectories = findFiles(runRoot, "trajectory.json");
      if (trajectories.length !== 1) {
        throw new Error(
          `expected one trajectory for ${cell}-r${round}; found ${trajectories.length}`,
        );
      }
      const trajectory = readJson(trajectories[0]);
      const record = readJson(resolve(runRoot, "record.json"));
      const messages = trajectory.steps
        .filter((step) => step.source === "agent")
        .map((step) => step.message ?? "")
        .join("\n");
      const commands = trajectory.steps
        .flatMap((step) => step.tool_calls ?? [])
        .map((call) => JSON.stringify(call.arguments ?? {}))
        .join("\n");
      const stats = byRepresentation[treatment];
      stats.sessions += 1;
      if (record.data?.status === "failed") stats.failedSessions += 1;
      stats.developmentEvaluationCount +=
        record.data?.development_evaluations?.count ?? 0;
      if (/1,?200[- ]cycle lower bound|lower bound[^\n]{0,100}1,?200/i.test(messages)) {
        stats.recognized1200CycleLowerBound += 1;
      }
      if (/prior research|mounted research|research events|research scores/i.test(messages)) {
        stats.mentionedMountedResearch += 1;
      }
      if (concretePriorScore.test(messages)) stats.citedConcretePriorScore += 1;
      if (!commands.includes("/workspace/research-view/index.md")) {
        throw new Error(`research view was not read in ${cell}-r${round}`);
      }
      stats.sessionsReadingView += 1;
    }
  }
  return byRepresentation;
}

const freezePath = resolve(
  kgRoot,
  "studies/dungeness-representation-v1/research/EXPERIMENTS/v36-result-freeze.json",
);
const freeze = readJson(freezePath);
const outcomesByHistory = new Map();
for (const row of freeze.block_outcomes) {
  if (!outcomesByHistory.has(row.history)) outcomesByHistory.set(row.history, []);
  outcomesByHistory.get(row.history).push(row);
}

const rows = histories.map((definition) => {
  const sourcePath = resolve(evalRoot, definition.source);
  const history = readJson(sourcePath);
  const features = eventFeatures(history);
  const viewStats = {};
  for (const [arm, viewId] of Object.entries(definition.views)) {
    const manifestPath = resolve(
      evalRoot,
      `research-views/users/bx/${viewId}.yaml`,
    );
    const manifest = readJson(manifestPath);
    viewStats[arm] = {
      id: viewId,
      bytes: manifest.data.tree.bytes,
      totalTokens: manifest.data.tokens.total,
      indexTokens: manifest.data.tokens.index,
    };
  }
  const r2Index = extractIndex(definition.views.R2);
  const unresolved = r2Index.data.unresolved;
  const outcomes = [...outcomesByHistory.get(definition.id)].sort((a, b) =>
    a.representation.localeCompare(b.representation),
  );
  const bestAuc = Math.max(...outcomes.map((outcome) => outcome.progress_auc));
  const practicalBestSet = outcomes
    .filter((outcome) => bestAuc - outcome.progress_auc <= 0.25)
    .map((outcome) => outcome.representation);

  const routingSignature = [
    features.eventCount,
    features.validEventCount,
    features.configDimensions,
    features.uniqueSites,
    features.uniqueIdeas,
    features.bundledEventFraction,
    features.branchingParentCount,
    unresolved.mixedObservedOutcomes.length,
    unresolved.bundledAttribution.length,
    unresolved.oneConditionDifferent.length,
    unresolved.unreplicatedPositiveGain.length,
  ].join("|");

  return {
    history: definition.id,
    task: definition.task,
    source: {
      path: `eval/${definition.source}`,
      sha256: sha256(sourcePath),
    },
    features,
    views: viewStats,
    viewOverheadVsR0: {
      R1Tokens: viewStats.R1.totalTokens - viewStats.R0.totalTokens,
      R2Tokens: viewStats.R2.totalTokens - viewStats.R0.totalTokens,
    },
    r2MechanicalFlags: {
      mixedObservedOutcomes: unresolved.mixedObservedOutcomes.length,
      bundledAttribution: unresolved.bundledAttribution.length,
      oneConditionDifferent: unresolved.oneConditionDifferent.length,
      unreplicatedPositiveGain: unresolved.unreplicatedPositiveGain.length,
      missingMatchedControlEncoded: unresolved.missingMatchedControl,
    },
    outcomes: outcomes.map((outcome) => ({
      representation: outcome.representation,
      progressAuc: outcome.progress_auc,
      finalGain: outcome.final_gain,
    })),
    exactBestArm: outcomes.find(
      (outcome) => outcome.progress_auc === bestAuc,
    ).representation,
    practicalBestSetAt025: practicalBestSet,
    routingSignature,
  };
});

const signatureGroups = new Map();
for (const row of rows) {
  if (!signatureGroups.has(row.routingSignature)) {
    signatureGroups.set(row.routingSignature, []);
  }
  signatureGroups.get(row.routingSignature).push({
    history: row.history,
    task: row.task,
    exactBestArm: row.exactBestArm,
    practicalBestSetAt025: row.practicalBestSetAt025,
  });
}

const collisions = [...signatureGroups.entries()]
  .filter(([, group]) => group.length > 1)
  .map(([signature, group]) => ({
    signature,
    histories: group,
    distinctExactBestArms: unique(group.map((item) => item.exactBestArm)),
  }));

const output = {
  schema: "dungeness.task-policy.feature-audit.v1",
  generatedAt: null,
  claimScope:
    "Exploratory model-free audit of six frozen v36 histories; not a trained or validated router.",
  inputs: [
    {
      path: "kg/studies/dungeness-representation-v1/research/EXPERIMENTS/v36-result-freeze.json",
      sha256: sha256(freezePath),
    },
    ...rows.map((row) => row.source),
  ],
  histories: rows,
  routingSignatureDefinition: [
    "eventCount",
    "validEventCount",
    "configDimensions",
    "uniqueSites",
    "uniqueIdeas",
    "bundledEventFraction",
    "branchingParentCount",
    "r2MixedObservedOutcomes",
    "r2BundledAttribution",
    "r2OneConditionDifferent",
    "r2UnreplicatedPositiveGain",
  ],
  routingSignatureCollisions: collisions,
  vliwTraceMechanismAudit: vliwTraceAudit(),
  conclusionsSupportedByAudit: [
    "The six histories are too few to train or validate a task-to-representation classifier.",
    "Current mechanical history features collide across histories with different exact winning arms.",
    "All VLIW arms usually recognized the same 1200-cycle lower bound, so the trace does not isolate a representation-specific idea-discovery mechanism.",
    "A future router must include task/actionability features and be evaluated on held-out task families.",
  ],
};

const outputPath = resolve(here, "v1-feature-audit.json");
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(outputPath);
