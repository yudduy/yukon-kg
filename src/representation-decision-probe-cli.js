#!/usr/bin/env bun

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./openrouter.js";
import {
  CORE_ARMS,
  POSITIVE_CONTROL_ARM,
  analyzeProbeResults,
  buildDecisionProbeCases,
  buildProbeMessages,
  scoreProbeResponse,
} from "./representation-decision-probe.js";
import { canonicalStringify, sha256 } from "./research-view.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODELS = Object.freeze([
  "openai/gpt-5.6-sol",
  "moonshotai/kimi-k3",
]);

function usage() {
  return [
    "Usage:",
    "  bun run src/representation-decision-probe-cli.js preflight --output <freeze.json>",
    "  bun run src/representation-decision-probe-cli.js calibrate --output <calibration.json>",
    "  bun run src/representation-decision-probe-cli.js run --freeze <freeze.json> --output <results.json>",
    "  bun run src/representation-decision-probe-cli.js analyze --results <results.json> --output <analysis.json>",
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.resolve(filePath), "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
}

function sourceRecord(relativePath) {
  const bytes = readFileSync(path.join(moduleRoot, relativePath));
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function publicCaseManifest(probeCase) {
  return {
    case_id: probeCase.caseId,
    variant: probeCase.variant,
    factors: probeCase.factors,
    oracle: probeCase.oracle,
    common_sha256: probeCase.commonSha256,
    atoms_sha256: probeCase.atomsSha256,
    index_sha256: probeCase.indexHashes,
    packet_sha256: Object.fromEntries(
      [...CORE_ARMS, POSITIVE_CONTROL_ARM].map((arm) => [arm, sha256(probeCase.packets[arm])]),
    ),
    diagnostics: probeCase.diagnostics,
  };
}

export function buildFreeze({
  seed = "dungeness-decision-probe-v1",
  variants = 3,
  models = DEFAULT_MODELS,
  maxSpendUsd = 12,
} = {}) {
  const cases = buildDecisionProbeCases({ seed, variants });
  const coreCalls = cases.length * CORE_ARMS.length * models.length;
  const positiveControlCalls = cases.length * models.length;
  return {
    schema: "yukon.representation-decision-probe-freeze.v3",
    created_at: null,
    claim_scope: "Mechanism and construct-validity pilot; not a full-chain representation efficacy result.",
    generation: {
      seed,
      variants,
      factors: ["selection_load", "comparison_opportunity", "comparison_actionable"],
      cases: cases.length,
      source_files: [
        sourceRecord("src/representation-decision-probe.js"),
        sourceRecord("src/representation-decision-probe-cli.js"),
        sourceRecord("src/research-view.js"),
        sourceRecord("src/openrouter.js"),
      ],
    },
    execution: {
      models: [...models],
      core_arms: [...CORE_ARMS],
      positive_control_arm: POSITIVE_CONTROL_ARM,
      core_calls: coreCalls,
      positive_control_calls: positiveControlCalls,
      maximum_calls: coreCalls + positiveControlCalls,
      maximum_direct_model_spend_usd: maxSpendUsd,
      concurrency: 4,
      maximum_per_call_reservation_usd: 0.5,
      generation: {
        temperature: 0,
        max_tokens: 2048,
        response_format: null,
        reasoning: { effort: "low", exclude: false },
      },
      randomization: "sha256-order-v1",
      administrative_retry_limit: 5,
    },
    gates: {
      positive_control_accuracy_per_model: 0.9,
      practical_accuracy_margin: 0.15,
      r1_target: "R1-R0 on frontier-decision cases",
      r2_target: "R2-R1 on comparison-decision cases",
      cross_model_requirement: "target contrast must be nonnegative in every model",
      proceed_to_full_chains: "positive control and both selective mechanism gates pass",
      stop_rule: "If the positive control fails, repair the assay. If a selective gate fails, do not claim that index is useful and do not fund a routed full-chain study from these results.",
    },
    cases: cases.map(publicCaseManifest),
  };
}

function verifyFreeze(freeze) {
  if (freeze.schema !== "yukon.representation-decision-probe-freeze.v3") throw new Error("unsupported probe freeze");
  const rebuilt = buildFreeze({
    seed: freeze.generation.seed,
    variants: freeze.generation.variants,
    models: freeze.execution.models,
    maxSpendUsd: freeze.execution.maximum_direct_model_spend_usd,
  });
  if (canonicalStringify(rebuilt) !== canonicalStringify(freeze)) {
    throw new Error("probe freeze differs from deterministic source or case generation");
  }
  return buildDecisionProbeCases({
    seed: freeze.generation.seed,
    variants: freeze.generation.variants,
  });
}

function executionOrder(freeze, cases) {
  const calls = [];
  for (const model of freeze.execution.models) {
    for (const probeCase of cases) {
      for (const arm of [...CORE_ARMS, POSITIVE_CONTROL_ARM]) {
        calls.push({ model, probeCase, arm });
      }
    }
  }
  return calls.sort((left, right) => {
    const leftKey = sha256(`${freeze.generation.seed}:call:${left.model}:${left.probeCase.caseId}:${left.arm}`);
    const rightKey = sha256(`${freeze.generation.seed}:call:${right.model}:${right.probeCase.caseId}:${right.arm}`);
    return leftKey.localeCompare(rightKey);
  });
}

function resultKey(row) {
  return `${row.model}|${row.caseId}|${row.arm}`;
}

function providerErrorRecord(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    status: Number.isInteger(error?.status) ? error.status : null,
  };
}

function usageCost(usage) {
  const cost = usage?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    throw new Error("OpenRouter usage did not include a finite nonnegative cost");
  }
  return cost;
}

async function runFreeze(freezePath, outputPath) {
  const freezeBytes = readFileSync(path.resolve(freezePath), "utf8");
  const freeze = JSON.parse(freezeBytes);
  const cases = verifyFreeze(freeze);
  const freezeSha256 = sha256(freezeBytes);
  const existing = existsSync(outputPath) ? readJson(outputPath) : null;
  const result = existing ?? {
    schema: "yukon.representation-decision-probe-results.v3",
    freeze_sha256: freezeSha256,
    status: "running",
    rows: [],
    administrative_attempts: [],
  };
  if (result.freeze_sha256 !== freezeSha256) throw new Error("results belong to another probe freeze");
  const completed = new Set(result.rows.map(resultKey));
  let spent = result.rows.reduce((sum, row) => sum + row.costUsd, 0);
  const maximumSpend = freeze.execution.maximum_direct_model_spend_usd;
  const remaining = executionOrder(freeze, cases).filter(({ model, probeCase, arm }) => (
    !completed.has(`${model}|${probeCase.caseId}|${arm}`)
  ));
  const concurrency = freeze.execution.concurrency;
  const reservation = freeze.execution.maximum_per_call_reservation_usd;
  for (let offset = 0; offset < remaining.length; offset += concurrency) {
    const batch = remaining.slice(offset, offset + concurrency);
    if (spent + batch.length * reservation > maximumSpend) {
      result.status = "spend_cap_reached";
      writeJsonAtomic(outputPath, result);
      throw new Error(`probe stopped at its $${maximumSpend} direct-model spend cap`);
    }
    const batchRows = await Promise.all(batch.map(async ({ model, probeCase, arm }, batchIndex) => {
      const key = `${model}|${probeCase.caseId}|${arm}`;
      const packet = probeCase.packets[arm];
      const messages = buildProbeMessages(packet);
      let response;
      let lastError;
      for (let attempt = 1; attempt <= freeze.execution.administrative_retry_limit + 1; attempt += 1) {
        try {
          response = await chat({
            model,
            messages,
            maxTokens: freeze.execution.generation.max_tokens,
            temperature: freeze.execution.generation.temperature,
            reasoning: freeze.execution.generation.reasoning,
            responseFormat: freeze.execution.generation.response_format === null
              ? undefined
              : { type: freeze.execution.generation.response_format },
          });
          break;
        } catch (error) {
          lastError = error;
          result.administrative_attempts.push({
            key,
            attempt,
            error: providerErrorRecord(error),
          });
          writeJsonAtomic(outputPath, result);
        }
      }
      if (response === undefined) throw lastError;
      const costUsd = usageCost(response.usage);
      const score = scoreProbeResponse(probeCase, arm, response.content);
      return {
        callIndex: offset + batchIndex,
        key,
        model,
        caseId: probeCase.caseId,
        variant: probeCase.variant,
        arm,
        factors: probeCase.factors,
        oracleDecisionClass: probeCase.oracle.decisionClass,
        packetSha256: sha256(packet),
        promptSha256: sha256(messages),
        responseId: response.id,
        routedModel: response.model,
        contentSource: response.contentSource,
        response: response.content,
        usage: response.usage,
        costUsd,
        score,
      };
    }));
    for (const row of batchRows) {
      spent += row.costUsd;
      result.rows.push(row);
      completed.add(row.key);
    }
    writeJsonAtomic(outputPath, result);
  }
  result.status = "complete";
  result.analysis = analyzeProbeResults(result.rows, {
    practicalMargin: freeze.gates.practical_accuracy_margin,
  });
  writeJsonAtomic(outputPath, result);
  return result;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "preflight") {
    if (!options.output) throw new Error("preflight requires --output");
    const freeze = buildFreeze({
      seed: options.seed ?? "dungeness-decision-probe-v1",
      variants: options.variants === undefined ? 3 : Number.parseInt(options.variants, 10),
      maxSpendUsd: options["max-spend-usd"] === undefined ? 12 : Number.parseFloat(options["max-spend-usd"]),
    });
    writeJsonAtomic(options.output, freeze);
    console.log(path.resolve(options.output));
    return;
  }
  if (command === "calibrate") {
    if (!options.output) throw new Error("calibrate requires --output");
    const [probeCase] = buildDecisionProbeCases({ seed: "dungeness-decision-probe-v3-calibration", variants: 1 });
    const packet = probeCase.packets[POSITIVE_CONTROL_ARM];
    const messages = buildProbeMessages(packet);
    const response = await chat({
      model: "moonshotai/kimi-k3",
      messages,
      maxTokens: 2048,
      temperature: 0,
      reasoning: { effort: "low", exclude: false },
    });
    const calibration = {
      schema: "yukon.representation-decision-probe-calibration.v3",
      model: "moonshotai/kimi-k3",
      packet_sha256: sha256(packet),
      prompt_sha256: sha256(messages),
      response_id: response.id,
      routed_model: response.model,
      content_source: response.contentSource,
      response: response.content,
      usage: response.usage,
      cost_usd: usageCost(response.usage),
      score: scoreProbeResponse(probeCase, POSITIVE_CONTROL_ARM, response.content),
    };
    writeJsonAtomic(options.output, calibration);
    console.log(JSON.stringify({ score: calibration.score, costUsd: calibration.cost_usd }));
    return;
  }
  if (command === "run") {
    if (!options.freeze || !options.output) throw new Error("run requires --freeze and --output");
    const result = await runFreeze(options.freeze, options.output);
    console.log(JSON.stringify({
      status: result.status,
      rows: result.rows.length,
      costUsd: result.analysis.totalCostUsd,
      gates: result.analysis.gates,
    }));
    return;
  }
  if (command === "analyze") {
    if (!options.results || !options.output) throw new Error("analyze requires --results and --output");
    const results = readJson(options.results);
    const analysis = analyzeProbeResults(results.rows);
    writeJsonAtomic(options.output, analysis);
    console.log(path.resolve(options.output));
    return;
  }
  throw new Error(usage());
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
