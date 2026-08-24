#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CodexRunner,
  runIsolationCanary,
  runProcess,
} from "./mve.js";
import {
  PLANNING_CALIBRATION_BLOCKS,
  PLANNING_CONDITION_EVALUATIONS,
  PLANNING_CONDITIONS,
  PLANNING_CONFIRMATORY_MAX_BLOCKS,
  PLANNING_CONFIRMATORY_MIN_BLOCKS,
  PLANNING_CONTRASTS,
  PLANNING_MDE_POINTS,
  PLANNING_MODEL,
  PLANNING_PRELUDE_EVALUATIONS,
  PLANNING_PROTOCOL_VERSION,
  analyzePlanningBlocks,
  compilePlanningPacket,
  createPlanningOracle,
  createPlanningTask,
  planningContrastDifferences,
  planningPacketDifference,
  posteriorRouteValues,
  samplePlanningWorld,
  scorePlanningInspection,
  scorePlanningPreludeInspection,
  terminalDecision,
  verifyPlanningDuplicate,
} from "./mouselab.js";
import {
  canonicalStringify,
  createPrng,
  estimateConfirmatoryBlocks,
  mean,
  sha256,
} from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_ROOT = path.join(ROOT, ".runs", "mouselab-handoff");
const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodeId", "hypothesis", "rationale", "planUpdate"],
  properties: {
    nodeId: { type: "string", pattern: "^node-[0-9a-f]{12}$" },
    hypothesis: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    planUpdate: { type: "string", minLength: 1 },
  },
};
const CANARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "model"],
  properties: {
    status: { type: "string", enum: ["READY", "NETWORK_OPEN"] },
    model: { type: "string", const: PLANNING_MODEL },
  },
};
const WORKER_CANARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "model"],
  properties: {
    status: { type: "string", enum: ["NO_FORBIDDEN_TOOLS", "FORBIDDEN_TOOL_VISIBLE"] },
    model: { type: "string", const: PLANNING_MODEL },
  },
};

function nowIso() {
  return new Date().toISOString();
}

function makeRunId() {
  return `${nowIso().replace(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeFileAtomic(target, contents) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, target);
}

async function writeJson(target, value) {
  await writeFileAtomic(target, `${canonicalStringify(value)}\n`);
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function readJsonIfPresent(target) {
  return await exists(target) ? readJson(target) : null;
}

async function writeSchemas(runDirectory) {
  const directory = path.join(runDirectory, "schemas");
  const schemas = {
    decision: path.join(directory, "planning-decision.json"),
    canary: path.join(directory, "canary.json"),
    workerCanary: path.join(directory, "worker-canary.json"),
  };
  await writeJson(schemas.decision, DECISION_SCHEMA);
  await writeJson(schemas.canary, CANARY_SCHEMA);
  await writeJson(schemas.workerCanary, WORKER_CANARY_SCHEMA);
  return schemas;
}

function manifest(runId, mode = "main") {
  return {
    protocolVersion: PLANNING_PROTOCOL_VERSION,
    runId,
    mode,
    createdAt: nowIso(),
    model: PLANNING_MODEL,
    task: {
      name: "paper-derived Mouselab information-allocation task",
      branches: 6,
      stages: 3,
      source: "https://cocosci.princeton.edu/papers/Mouselab_MDP-CameraReady.pdf",
      exactLossReference: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8944825/",
      scorer: "exact finite-horizon dynamic program",
    },
    budgets: {
      sharedPrelude: PLANNING_PRELUDE_EVALUATIONS,
      perCondition: PLANNING_CONDITION_EVALUATIONS,
      calibrationBlocks: PLANNING_CALIBRATION_BLOCKS,
      confirmatoryMinimum: PLANNING_CONFIRMATORY_MIN_BLOCKS,
      confirmatoryMaximum: PLANNING_CONFIRMATORY_MAX_BLOCKS,
    },
    conditions: PLANNING_CONDITIONS,
    primaryContrasts: PLANNING_CONTRASTS,
    minimumMeaningfulDecisionLossReduction: PLANNING_MDE_POINTS,
    reasoning: { sharedPrelude: "low", postFork: "low" },
    toolPolicy: { allocator: "none", scorer: "host dynamic program", canary: "shell only" },
  };
}

function decisionPrompt(packet, lastResult = null) {
  return [
    "You choose one information-gathering measurement. Do not use tools, inspect files, or access the network.",
    "Return only the JSON object required by the response schema.",
    "Choose exactly one nodeId from availableNodeIds. Optimize the final expected route total after the entire remaining budget.",
    "A large isolated revealed value is not sufficient; account for its route, other observations, priors, and later measurements.",
    `Decision packet:\n${canonicalStringify(packet)}`,
    lastResult ? `Result of the immediately preceding choice:\n${canonicalStringify(lastResult)}` : "",
  ].filter(Boolean).join("\n\n");
}

function toolEvents(result) {
  const allowed = new Set(["agent_message", "error", "reasoning", "todo_list"]);
  return result.events.filter((event) => (
    (event.type === "item.started" || event.type === "item.completed")
    && !allowed.has(event.item?.type)
  ));
}

async function archiveModelCall(slotDirectory, prompt, result) {
  const promptHash = sha256(prompt);
  const responseHash = sha256(result.process.stdout);
  const objects = path.join(slotDirectory, "objects");
  await writeFileAtomic(path.join(objects, `${promptHash}.prompt.txt`), prompt);
  for (const [index, attempt] of (result.attempts ?? [result]).entries()) {
    const attemptHash = sha256(attempt.process.stdout);
    await writeFileAtomic(path.join(objects, `${attemptHash}.events.jsonl`), attempt.process.stdout);
    if (attempt.process.stderr) {
      await writeFileAtomic(path.join(objects, `${attemptHash}.stderr.txt`), attempt.process.stderr);
    }
    await writeJson(path.join(objects, `${attemptHash}.process.json`), {
      index,
      command: attempt.process.command,
      args: attempt.process.args,
      exitCode: attempt.process.exitCode,
      signal: attempt.process.signal,
      timedOut: attempt.process.timedOut,
      durationMs: attempt.process.durationMs,
      usage: attempt.usage,
    });
  }
  return { promptHash, responseHash };
}

async function chooseNode({
  codexRunner,
  schemas,
  allocatorDirectory,
  slotDirectory,
  packet,
  sessionId,
  reasoning,
  lastResult,
}) {
  await fs.mkdir(allocatorDirectory, { recursive: true });
  const prompt = decisionPrompt(packet, lastResult);
  const savedPath = path.join(slotDirectory, "allocator-message.json");
  const saved = await readJsonIfPresent(savedPath);
  if (saved?.promptHash === sha256(prompt)) return saved;
  let result;
  try {
    result = await codexRunner.invokeWithRetries({
      cwd: allocatorDirectory,
      prompt,
      reasoning,
      schemaPath: schemas.decision,
      sessionId,
      sandbox: "read-only",
    });
  } catch (error) {
    const outcome = {
      decision: null,
      invalid: { reason: "infrastructure_failure_after_retries", detail: error.message, protocolViolation: false },
      sessionId,
      promptHash: sha256(prompt),
      responseHash: null,
      usage: null,
    };
    await writeJson(savedPath, outcome);
    return outcome;
  }
  const refs = await archiveModelCall(slotDirectory, prompt, result);
  let decision = null;
  let invalid = null;
  if (result.process.exitCode !== 0) {
    invalid = { reason: "allocator_model_failure", protocolViolation: false };
  } else if (toolEvents(result).length > 0) {
    invalid = { reason: "allocator_used_forbidden_tool", protocolViolation: true, toolEvents: toolEvents(result) };
  } else {
    try {
      decision = JSON.parse(result.lastMessage);
    } catch {
      invalid = { reason: "allocator_invalid_structured_output", protocolViolation: false };
    }
  }
  if (decision && !packet.availableNodeIds.includes(decision.nodeId)) {
    invalid = { reason: "allocator_selected_unavailable_node", protocolViolation: false };
    decision = null;
  }
  const outcome = {
    decision,
    invalid,
    sessionId: sessionId ?? result.threadId,
    ...refs,
    usage: result.usage,
  };
  await writeJson(savedPath, outcome);
  if (decision) await writeJson(path.join(slotDirectory, "decision.json"), { ...decision, ...refs });
  return outcome;
}

function observationsFromRecords(records) {
  return Object.fromEntries(records
    .filter((record) => record.validity === "valid")
    .map((record) => [record.nodeId, record.revealedValue]));
}

async function runPreludeEvaluation({
  index,
  records,
  incumbentPlan,
  task,
  world,
  sessionId,
  allocatorDirectory,
  blockDirectory,
  codexRunner,
  schemas,
}) {
  const slotDirectory = path.join(blockDirectory, "slots", "prelude", String(index).padStart(2, "0"));
  const recordPath = path.join(slotDirectory, "record.json");
  const existing = await readJsonIfPresent(recordPath);
  if (existing) return { record: existing, sessionId: existing.allocatorSessionId };
  const packet = compilePlanningPacket("prelude", {
    task,
    records,
    remainingEvaluations: PLANNING_PRELUDE_EVALUATIONS - index,
    incumbentPlan,
  });
  await writeJson(path.join(slotDirectory, "condition-packet.json"), packet);
  const choice = await chooseNode({
    codexRunner,
    schemas,
    allocatorDirectory,
    slotDirectory,
    packet,
    sessionId,
    reasoning: "low",
    lastResult: records.at(-1) ?? null,
  });
  const observations = observationsFromRecords(records);
  let record;
  if (!choice.decision) {
    record = {
      evaluationId: `prelude-${index}`,
      validity: "invalid",
      reason: choice.invalid?.reason ?? "missing_decision",
      protocolViolation: choice.invalid?.protocolViolation ?? false,
      posteriorBestExpectedTotal: terminalDecision(task, observations).expectedValue,
      rationale: null,
      planUpdate: incumbentPlan,
      allocatorSessionId: choice.sessionId,
      promptHash: choice.promptHash,
      responseHash: choice.responseHash,
    };
  } else {
    const nodeId = choice.decision.nodeId;
    const scoring = verifyPlanningDuplicate(
      scorePlanningPreludeInspection({ task, observations, nodeId, world }),
      scorePlanningPreludeInspection({ task, observations, nodeId, world }),
    );
    await writeJson(path.join(slotDirectory, "scoring.json"), scoring);
    record = {
      evaluationId: `prelude-${index}`,
      nodeId,
      validity: "valid",
      protocolViolation: false,
      revealedValue: scoring.revealedValue,
      posteriorBestExpectedTotal: scoring.after.expectedValue,
      rationale: choice.decision.rationale,
      planUpdate: choice.decision.planUpdate,
      hypothesis: choice.decision.hypothesis,
      allocatorSessionId: choice.sessionId,
      promptHash: choice.promptHash,
      responseHash: choice.responseHash,
      reproductions: 2,
    };
  }
  await writeJson(recordPath, record);
  return { record, sessionId: choice.sessionId };
}

async function runConditionEvaluation({
  condition,
  index,
  records,
  incumbentPlan,
  task,
  world,
  sessionId,
  allocatorDirectory,
  blockDirectory,
  codexRunner,
  schemas,
}) {
  const slotDirectory = path.join(blockDirectory, "slots", condition, String(index).padStart(2, "0"));
  const recordPath = path.join(slotDirectory, "record.json");
  const existing = await readJsonIfPresent(recordPath);
  if (existing) return { record: existing, sessionId: existing.allocatorSessionId };
  const packet = compilePlanningPacket(condition, {
    task,
    records,
    remainingEvaluations: PLANNING_CONDITION_EVALUATIONS - index,
    incumbentPlan,
  });
  await writeJson(path.join(slotDirectory, "condition-packet.json"), packet);
  const choice = await chooseNode({
    codexRunner,
    schemas,
    allocatorDirectory,
    slotDirectory,
    packet,
    sessionId,
    reasoning: "low",
    lastResult: records.at(-1) ?? null,
  });
  const observations = observationsFromRecords(records);
  const remaining = PLANNING_CONDITION_EVALUATIONS - index;
  const oracle = createPlanningOracle(task);
  const nodeId = choice.decision?.nodeId ?? "invalid-node";
  const first = scorePlanningInspection({ task, oracle, observations, remaining, nodeId, world });
  const second = scorePlanningInspection({ task, oracle, observations, remaining, nodeId, world });
  const scoring = verifyPlanningDuplicate(first, second);
  await writeJson(path.join(slotDirectory, "scoring.json"), scoring);
  const record = {
    evaluationId: `${condition}-${index}`,
    nodeId: choice.decision?.nodeId ?? null,
    validity: choice.decision ? scoring.validity : "invalid",
    reason: choice.decision ? scoring.reason ?? null : choice.invalid?.reason ?? "missing_decision",
    protocolViolation: choice.invalid?.protocolViolation ?? false,
    revealedValue: scoring.revealedValue ?? null,
    posteriorBestExpectedTotal: scoring.after.expectedValue,
    posteriorBestRouteIds: scoring.after.bestRouteIds,
    decisionLoss: scoring.decisionLoss,
    oracleNodeIds: scoring.oracle.optimalNodeIds,
    selectedExpectedValue: scoring.selectedExpectedValue ?? null,
    rationale: choice.decision?.rationale ?? null,
    planUpdate: choice.decision?.planUpdate ?? incumbentPlan,
    hypothesis: choice.decision?.hypothesis ?? null,
    allocatorSessionId: choice.sessionId,
    promptHash: choice.promptHash,
    responseHash: choice.responseHash,
    reproductions: 2,
  };
  await writeJson(recordPath, record);
  return { record, sessionId: choice.sessionId };
}

export async function runPlanningBlock({
  blockId,
  runDirectory,
  codexRunner,
  schemas,
}) {
  const blockDirectory = path.join(runDirectory, "blocks", blockId);
  const resultPath = path.join(blockDirectory, "result.json");
  const existing = await readJsonIfPresent(resultPath);
  if (existing) return existing;
  await fs.mkdir(blockDirectory, { recursive: true });
  const task = createPlanningTask(`${path.basename(runDirectory)}:${blockId}:task`);
  const world = samplePlanningWorld(task, `${path.basename(runDirectory)}:${blockId}:world`);
  await writeJson(path.join(blockDirectory, "task.json"), task);
  await writeJson(path.join(blockDirectory, "sealed-world.json"), world);

  const preludeRecords = [];
  let preludeSessionId = null;
  let incumbentPlan = "Compare the value of information across routes and stages before concentrating measurements.";
  const preludeAllocatorDirectory = path.join(blockDirectory, "allocators", "prelude");
  for (let index = 0; index < PLANNING_PRELUDE_EVALUATIONS; index += 1) {
    const outcome = await runPreludeEvaluation({
      index,
      records: preludeRecords,
      incumbentPlan,
      task,
      world,
      sessionId: preludeSessionId,
      allocatorDirectory: preludeAllocatorDirectory,
      blockDirectory,
      codexRunner,
      schemas,
    });
    preludeRecords.push(outcome.record);
    preludeSessionId = outcome.sessionId;
    incumbentPlan = outcome.record.planUpdate || incumbentPlan;
  }

  const forkObservations = observationsFromRecords(preludeRecords);
  const forkDecision = terminalDecision(task, forkObservations);
  const runCondition = async (condition) => {
    const records = [...preludeRecords];
    const postFork = [];
    let sessionId = condition === "incumbent" ? preludeSessionId : null;
    const allocatorDirectory = condition === "incumbent"
      ? preludeAllocatorDirectory
      : path.join(blockDirectory, "allocators", condition);
    for (let index = 0; index < PLANNING_CONDITION_EVALUATIONS; index += 1) {
      const outcome = await runConditionEvaluation({
        condition,
        index,
        records,
        incumbentPlan,
        task,
        world,
        sessionId,
        allocatorDirectory,
        blockDirectory,
        codexRunner,
        schemas,
      });
      records.push(outcome.record);
      postFork.push(outcome.record);
      sessionId = outcome.sessionId;
    }
    const finalObservations = observationsFromRecords(records);
    const finalDecision = terminalDecision(task, finalObservations);
    return {
      condition,
      label: PLANNING_CONDITIONS[condition].label,
      evaluations: postFork.length,
      validEvaluations: postFork.filter((record) => record.validity === "valid").length,
      protocolViolations: postFork.filter((record) => record.protocolViolation).length,
      totalDecisionLoss: postFork.reduce((sum, record) => sum + record.decisionLoss, 0),
      oracleChoices: postFork.filter((record) => record.oracleNodeIds?.includes(record.nodeId)).length,
      finalPosteriorExpectedValue: finalDecision.expectedValue,
      finalBestRouteIds: finalDecision.bestRouteIds,
      selectedNodeIds: postFork.map((record) => record.nodeId),
    };
  };
  const entries = await Promise.all(Object.keys(PLANNING_CONDITIONS).map(async (condition) => [
    condition,
    await runCondition(condition),
  ]));
  const conditions = Object.fromEntries(entries);
  const apparatusStatus = preludeRecords.length === PLANNING_PRELUDE_EVALUATIONS
    && !preludeRecords.some((record) => record.protocolViolation)
    && Object.values(conditions).every((condition) => (
      condition.evaluations === PLANNING_CONDITION_EVALUATIONS
      && condition.protocolViolations === 0
    ))
    ? "PASS"
    : "INVALID";
  const neutralPacket = compilePlanningPacket("freshNeutral", {
    task,
    records: preludeRecords,
    remainingEvaluations: PLANNING_CONDITION_EVALUATIONS,
    incumbentPlan,
  });
  const budgetPacket = compilePlanningPacket("freshBudget", {
    task,
    records: preludeRecords,
    remainingEvaluations: PLANNING_CONDITION_EVALUATIONS,
    incumbentPlan,
  });
  const result = {
    protocolVersion: PLANNING_PROTOCOL_VERSION,
    blockId,
    apparatusStatus,
    forkPosteriorExpectedValue: forkDecision.expectedValue,
    forkBestRouteIds: forkDecision.bestRouteIds,
    preludeValidEvaluations: preludeRecords.filter((record) => record.validity === "valid").length,
    packetDifference: planningPacketDifference(neutralPacket, budgetPacket),
    conditions,
    completedAt: nowIso(),
  };
  await writeJson(resultPath, result);
  return result;
}

function simulatePolicy(task, world, initialObservations, policy, seed) {
  let observations = { ...initialObservations };
  let totalDecisionLoss = 0;
  const random = createPrng(seed);
  for (let index = 0; index < PLANNING_CONDITION_EVALUATIONS; index += 1) {
    const remaining = PLANNING_CONDITION_EVALUATIONS - index;
    const oracle = createPlanningOracle(task);
    const decision = oracle.decision(observations, remaining);
    const available = task.nodes.filter((node) => !Object.hasOwn(observations, node.nodeId));
    let nodeId;
    if (policy === "oracle") {
      nodeId = decision.optimalNodeIds[0];
    } else if (policy === "myopic") {
      const oneStep = createPlanningOracle(task).decision(observations, 1);
      nodeId = oneStep.optimalNodeIds[0];
    } else {
      nodeId = available[Math.floor(random() * available.length)].nodeId;
    }
    const score = scorePlanningInspection({ task, oracle, observations, remaining, nodeId, world });
    totalDecisionLoss += score.decisionLoss;
    observations = score.observations;
  }
  return {
    totalDecisionLoss,
    finalPosteriorExpectedValue: terminalDecision(task, observations).expectedValue,
  };
}

export function planningScorerPreflight() {
  const trials = [];
  for (let index = 0; index < 4; index += 1) {
    const task = createPlanningTask(`preflight-task-${index}`);
    const world = samplePlanningWorld(task, `preflight-world-${index}`);
    const preludeNodes = task.nodes.filter((_, nodeIndex) => nodeIndex % 2 === 0).slice(0, PLANNING_PRELUDE_EVALUATIONS);
    const initialObservations = Object.fromEntries(preludeNodes.map((node) => [node.nodeId, world[node.nodeId]]));
    trials.push({
      oracle: simulatePolicy(task, world, initialObservations, "oracle", `oracle-${index}`),
      myopic: simulatePolicy(task, world, initialObservations, "myopic", `myopic-${index}`),
      random: simulatePolicy(task, world, initialObservations, "random", `random-${index}`),
    });
  }
  const oracleLoss = mean(trials.map((trial) => trial.oracle.totalDecisionLoss));
  const myopicLoss = mean(trials.map((trial) => trial.myopic.totalDecisionLoss));
  const randomLoss = mean(trials.map((trial) => trial.random.totalDecisionLoss));
  const corrections = [];
  if (Math.abs(oracleLoss) > 1e-9) corrections.push("exact oracle accumulated nonzero decision loss");
  if (!(randomLoss >= PLANNING_MDE_POINTS)) corrections.push("random choices are not separated from the exact oracle by the minimum meaningful effect");
  const task = createPlanningTask("duplicate-golden");
  const world = samplePlanningWorld(task, "duplicate-golden-world");
  const oracle = createPlanningOracle(task);
  const nodeId = oracle.decision({}, 1).optimalNodeIds[0];
  const first = scorePlanningInspection({ task, oracle, observations: {}, remaining: 1, nodeId, world });
  const duplicate = verifyPlanningDuplicate(first, scorePlanningInspection({
    task,
    oracle,
    observations: {},
    remaining: 1,
    nodeId,
    world,
  }));
  if (duplicate.reproductions !== 2) corrections.push("duplicate scorer did not record two reproductions");
  return {
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    trials: trials.length,
    meanDecisionLoss: { exactOracle: oracleLoss, myopic: myopicLoss, random: randomLoss },
    duplicateScoring: { status: duplicate.reproductions === 2 ? "PASS" : "FAIL", reproductions: duplicate.reproductions },
  };
}

async function environmentFingerprint() {
  const commands = {
    bun: ["bun", ["--version"]],
    codex: ["codex", ["--version"]],
    git: ["git", ["--version"]],
  };
  return Object.fromEntries(await Promise.all(Object.entries(commands).map(async ([name, [command, args]]) => {
    const result = await runProcess(command, args, { timeoutMs: 30_000 });
    return [name, {
      exitCode: result.exitCode,
      version: (result.stdout || result.stderr).trim(),
      durationMs: result.durationMs,
    }];
  })));
}

async function preflight(runDirectory, dependencies = {}) {
  const reportPath = path.join(runDirectory, "preflight", "report.json");
  const existing = await readJsonIfPresent(reportPath);
  if (existing?.status === "PASS") {
    return {
      report: existing,
      schemas: await writeSchemas(runDirectory),
      codexRunner: dependencies.codexRunner ?? new CodexRunner(),
    };
  }
  const schemas = await writeSchemas(runDirectory);
  const codexRunner = dependencies.codexRunner ?? new CodexRunner();
  const environment = await environmentFingerprint();
  await writeJson(path.join(runDirectory, "preflight", "environment.json"), environment);
  const isolation = await runIsolationCanary({ runDirectory, codexRunner, schemas });
  const scorer = planningScorerPreflight();
  await writeJson(path.join(runDirectory, "preflight", "planning-scorer.json"), scorer);
  const corrections = [
    ...(isolation.status === "PASS" ? [] : isolation.corrections),
    ...(scorer.status === "PASS" ? [] : scorer.corrections),
  ];
  const report = {
    protocolVersion: PLANNING_PROTOCOL_VERSION,
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    model: PLANNING_MODEL,
    isolation,
    scorer,
    environment,
    completedAt: nowIso(),
  };
  await writeJson(reportPath, report);
  return { report, schemas, codexRunner };
}

async function mapConcurrent(values, limit, operation) {
  const pending = [...values];
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    const outputs = [];
    while (pending.length > 0) outputs.push(await operation(pending.shift()));
    return outputs;
  });
  return (await Promise.all(workers)).flat();
}

function assertValidBlocks(blocks) {
  const invalid = blocks.filter((block) => block.apparatusStatus !== "PASS");
  if (invalid.length > 0) throw new Error(`invalid planning blocks: ${invalid.map((block) => block.blockId).join(", ")}`);
  for (const block of blocks) {
    if (canonicalStringify(block.packetDifference) !== canonicalStringify(["instruction"])) {
      throw new Error(`${block.blockId} neutral packets differ outside the budget instruction`);
    }
  }
}

async function runMain(runDirectory) {
  const admission = await preflight(runDirectory);
  if (admission.report.status !== "PASS") throw new Error("planning preflight failed");
  const calibrationIds = Array.from({ length: PLANNING_CALIBRATION_BLOCKS }, (_, index) => `calibration-${index}`);
  const calibration = await mapConcurrent(calibrationIds, 2, (blockId) => runPlanningBlock({
    blockId,
    runDirectory,
    codexRunner: admission.codexRunner,
    schemas: admission.schemas,
  }));
  assertValidBlocks(calibration);
  const calibrationByContrast = Object.fromEntries(Object.keys(PLANNING_CONTRASTS).map((contrast) => [
    contrast,
    planningContrastDifferences(calibration, contrast),
  ]));
  const power = estimateConfirmatoryBlocks(calibrationByContrast, {
    mdePercent: PLANNING_MDE_POINTS,
    minimum: PLANNING_CONFIRMATORY_MIN_BLOCKS,
    maximum: PLANNING_CONFIRMATORY_MAX_BLOCKS,
    seed: path.basename(runDirectory),
  });
  await writeJson(path.join(runDirectory, "power.json"), {
    ...power,
    unit: "expected reward points of decision loss",
    mdePoints: PLANNING_MDE_POINTS,
  });
  const confirmatoryIds = Array.from({ length: power.blocks }, (_, index) => `confirmatory-${index}`);
  const confirmatory = await mapConcurrent(confirmatoryIds, 2, (blockId) => runPlanningBlock({
    blockId,
    runDirectory,
    codexRunner: admission.codexRunner,
    schemas: admission.schemas,
  }));
  assertValidBlocks(confirmatory);
  const analysis = analyzePlanningBlocks(confirmatory, { seed: path.basename(runDirectory) });
  const conditionSummaries = Object.fromEntries(Object.keys(PLANNING_CONDITIONS).map((condition) => {
    const losses = confirmatory.map((block) => block.conditions[condition].totalDecisionLoss);
    const oracleChoices = confirmatory.map((block) => block.conditions[condition].oracleChoices);
    return [condition, {
      label: PLANNING_CONDITIONS[condition].label,
      meanTotalDecisionLoss: mean(losses),
      totalDecisionLosses: losses,
      meanOracleChoicesOutOfFour: mean(oracleChoices),
      oracleChoices,
    }];
  }));
  const result = {
    protocolVersion: PLANNING_PROTOCOL_VERSION,
    runId: path.basename(runDirectory),
    apparatus: "PASS",
    calibrationBlocks: calibrationIds,
    confirmatoryBlocks: confirmatory.length,
    power,
    conditionSummaries,
    ...analysis,
    completedAt: nowIso(),
  };
  await writeJson(path.join(runDirectory, "result.json"), result);
  return result;
}

async function report(runDirectory) {
  const preflightReport = await readJsonIfPresent(path.join(runDirectory, "preflight", "report.json"));
  const result = await readJsonIfPresent(path.join(runDirectory, "result.json"));
  return {
    runId: path.basename(runDirectory),
    protocolVersion: result?.protocolVersion ?? preflightReport?.protocolVersion ?? null,
    checks: [
      { area: "Luna isolation", verdict: preflightReport?.isolation?.status ?? "NOT_RUN" },
      { area: "Exact planning scorer", verdict: preflightReport?.scorer?.status ?? "NOT_RUN" },
      { area: "Matched experiment", verdict: result?.apparatus ?? "NOT_RUN" },
    ],
    confirmatoryBlocks: result?.confirmatoryBlocks ?? 0,
    conditions: result?.conditionSummaries ?? null,
    comparisons: result?.comparisons ?? null,
    proceedToLiveYukonTest: result?.proceedToLiveYukonTest ?? false,
  };
}

function usage() {
  return [
    "Usage:",
    "  bun run mve -- preflight",
    "  bun run mve -- run",
    "  bun run mve -- resume <run-id>",
    "  bun run mve -- report <run-id>",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const [command, id] = argv;
  if (!command || !["preflight", "run", "resume", "report"].includes(command)) {
    throw new Error(usage());
  }
  if (command === "preflight" || command === "run") {
    const runId = makeRunId();
    const runDirectory = path.join(RUNS_ROOT, runId);
    await fs.mkdir(runDirectory, { recursive: true });
    await writeJson(path.join(runDirectory, "manifest.json"), manifest(runId, command));
    const output = command === "preflight" ? (await preflight(runDirectory)).report : await runMain(runDirectory);
    process.stdout.write(`${canonicalStringify({ runId, runDirectory, result: output })}\n`);
    return;
  }
  if (!id || !/^[A-Za-z0-9_.:-]+$/u.test(id)) throw new Error(`${command} requires a valid run id`);
  const runDirectory = path.join(RUNS_ROOT, id);
  const currentManifest = await readJsonIfPresent(path.join(runDirectory, "manifest.json"));
  if (!currentManifest) throw new Error(`unknown run: ${id}`);
  if (currentManifest.protocolVersion !== PLANNING_PROTOCOL_VERSION) {
    throw new Error(`cannot use ${currentManifest.protocolVersion} with ${PLANNING_PROTOCOL_VERSION}`);
  }
  const output = command === "report"
    ? await report(runDirectory)
    : (await readJsonIfPresent(path.join(runDirectory, "result.json"))) ?? await runMain(runDirectory);
  process.stdout.write(`${canonicalStringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

export { preflight, report, runMain };
