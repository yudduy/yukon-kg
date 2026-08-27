#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadIndexedAtlasRelease } from "./atlas-local.js";
import { buildEcdsaWorkingKnowledgeBrief, ideasFromRelease } from "./atlas-runtime/index.ts";
import { inspectDungenessCheckout, readDungenessPin } from "./dungeness-clone.js";
import { compileKnowledgeVariants, OPENROUTER_DECODING } from "./dungeness-kb-protocol.js";
import { pinnedOpenRouterModel } from "./openrouter.js";
import { runDungenessCampaign } from "./dungeness-campaign-runner.js";
import {
  CONFIRMATORY_INTERIMS,
  DEFAULT_CAMPAIGN_BUDGET,
  KNOWLEDGE_ARMS,
  PROCEDURE_MODES,
  analyzeAdaptiveCampaigns,
  analyzePrimeFactorCampaigns,
  assertWithinSpendCap,
  buildPairedAssignments,
  estimateConfirmatoryPairs,
  freezeAdaptiveProtocol,
  parseDungenessAdapter,
  sha256,
} from "./dungeness-adaptive-protocol.js";
import { runProcess } from "./mve.js";
import { verifyPublicData } from "./verify-public-data.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DUNGENESS_REPO = path.join(ROOT, "third_party", "dungeness");
const ADAPTER_PATH = path.join(ROOT, "third_party", "dungeness.adapter.json");
const RUNS_ROOT = path.join(ROOT, ".runs", "dungeness-adaptive");
const EVIDENCE_ROOT = path.join(ROOT, "evidence", "dungeness-adaptive");
const PROTOCOL_PATH = path.join(EVIDENCE_ROOT, "protocol.json");
const POWER_PATH = path.join(EVIDENCE_ROOT, "power.json");
const REPORT_PATH = path.join(EVIDENCE_ROOT, "report.json");
const PRIME_PROTOCOL_PATH = path.join(EVIDENCE_ROOT, "prime-factor-protocol.json");
const PRIME_REPORT_PATH = path.join(EVIDENCE_ROOT, "prime-factor-report.json");

function nowIso() {
  return new Date().toISOString();
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function readJsonIfPresent(pathname) {
  try {
    return await readJson(pathname);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, pathname);
}

function providerName() {
  return process.env.OPENROUTER_PROVIDER?.trim() || "OpenAI";
}

function adaptiveDecoding() {
  return {
    temperature: OPENROUTER_DECODING.temperature,
    maxTokens: Number.parseInt(process.env.DUNGENESS_MAX_OUTPUT_TOKENS ?? "4096", 10),
  };
}

function campaignBudget() {
  return {
    turns: Number.parseInt(process.env.DUNGENESS_CAMPAIGN_TURNS ?? String(DEFAULT_CAMPAIGN_BUDGET.turns), 10),
    rootTokens: Number.parseInt(
      process.env.DUNGENESS_CAMPAIGN_ROOT_TOKENS ?? String(DEFAULT_CAMPAIGN_BUDGET.rootTokens),
      10,
    ),
    descendantTokens: 0,
    evaluatorCalls: Number.parseInt(
      process.env.DUNGENESS_CAMPAIGN_EVALUATOR_CALLS ?? String(DEFAULT_CAMPAIGN_BUDGET.evaluatorCalls),
      10,
    ),
    wallClockMs: Number.parseInt(
      process.env.DUNGENESS_CAMPAIGN_WALL_MS ?? String(DEFAULT_CAMPAIGN_BUDGET.wallClockMs),
      10,
    ),
    costUsd: Number.parseFloat(
      process.env.DUNGENESS_CAMPAIGN_COST_USD ?? String(DEFAULT_CAMPAIGN_BUDGET.costUsd),
    ),
  };
}

async function adapterPathFor() {
  if (process.env.DUNGENESS_ADAPTER_PATH?.trim()) {
    const configured = path.resolve(ROOT, process.env.DUNGENESS_ADAPTER_PATH.trim());
    if (configured.startsWith(`${path.resolve(DUNGENESS_REPO)}${path.sep}`)) {
      throw new Error("DUNGENESS_ADAPTER_PATH must stay outside the agent-readable checkout");
    }
    return configured;
  }
  try {
    await fs.access(ADAPTER_PATH);
    return ADAPTER_PATH;
  } catch {
    return null;
  }
}

async function loadAdapter(inspection, pin) {
  const pathname = await adapterPathFor();
  if (pathname === null) return { path: null, adapter: null, error: "no Dungeness adapter file is available" };
  try {
    const value = await readJson(pathname);
    return {
      path: pathname,
      adapter: parseDungenessAdapter(value, { expectedRepoSha: pin?.sha ?? inspection.sha }),
      error: null,
    };
  } catch (error) {
    return { path: pathname, adapter: null, error: error.message };
  }
}

async function checkpointRefsPresent(adapter) {
  if (adapter === null) return { ok: false, missing: [] };
  const missing = [];
  for (const checkpoint of adapter.checkpoints) {
    const result = await runProcess("git", ["cat-file", "-e", `${checkpoint.gitRef}^{commit}`], {
      cwd: DUNGENESS_REPO,
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) missing.push(checkpoint.id);
  }
  return { ok: missing.length === 0, missing };
}

export async function runAdaptivePreflight() {
  const atlas = await verifyPublicData();
  const inspection = await inspectDungenessCheckout();
  const pin = await readDungenessPin();
  const loadedAdapter = await loadAdapter(inspection, pin);
  const refs = inspection.present
    ? await checkpointRefsPresent(loadedAdapter.adapter)
    : { ok: false, missing: [] };
  const apiKeyPresent = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const checks = {
    atlasPass: atlas.status === "PASS",
    dungenessPresent: inspection.present === true,
    dungenessPinned: inspection.present === true
      && typeof pin?.sha === "string"
      && pin.sha === inspection.sha,
    adapterValid: loadedAdapter.adapter !== null,
    checkpointRefsPresent: refs.ok,
    openRouterKeyPresent: apiKeyPresent,
    providerPinned: providerName().length > 0,
    modelPinned: pinnedOpenRouterModel() === "openai/gpt-5.4",
  };
  return {
    schema: "yukon-kg.dungeness-adaptive-preflight.v1",
    createdAt: nowIso(),
    status: Object.values(checks).every(Boolean) ? "PASS" : "BLOCKED",
    checks,
    atlas,
    dungeness: { inspection, pin },
    adapter: {
      path: loadedAdapter.path,
      sha256: loadedAdapter.adapter === null ? null : sha256(loadedAdapter.adapter),
      error: loadedAdapter.error,
      missingCheckpointRefs: refs.missing,
    },
    model: {
      id: pinnedOpenRouterModel(),
      provider: providerName(),
      decoding: adaptiveDecoding(),
    },
  };
}

async function courtInputs() {
  const loaded = await loadIndexedAtlasRelease("default");
  const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
  const variants = compileKnowledgeVariants(
    brief,
    ideasFromRelease(loaded.release),
    loaded.release.submissions.submissions,
  );
  return { loaded, brief, briefText: variants.state_brief.text };
}

export async function freezeProtocol() {
  const preflight = await runAdaptivePreflight();
  if (preflight.status !== "PASS") {
    throw new Error(`adaptive preflight is blocked: ${JSON.stringify(preflight.checks)}`);
  }
  const inspection = preflight.dungeness.inspection;
  const pin = preflight.dungeness.pin;
  const { adapter, error } = await loadAdapter(inspection, pin);
  if (adapter === null) throw new Error(error);
  const { loaded } = await courtInputs();
  const protocol = freezeAdaptiveProtocol({
    adapter,
    dungenessPin: pin,
    atlasReleaseId: loaded.release.pointer.id,
    atlasManifestSha256: loaded.release.pointer.manifestSha256,
    model: pinnedOpenRouterModel(),
    provider: providerName(),
    decoding: adaptiveDecoding(),
    seed: process.env.DUNGENESS_PROTOCOL_SEED?.trim() || "dungeness-adaptive-v1",
    budget: campaignBudget(),
    createdAt: nowIso(),
  });
  const calibrationSpendCapUsd = Number.parseFloat(
    process.env.DUNGENESS_CALIBRATION_SPEND_CAP_USD ?? "100",
  );
  const frozen = {
    ...protocol,
    calibration: {
      ...protocol.calibration,
      spendCapUsd: calibrationSpendCapUsd,
    },
  };
  const withHash = {
    ...frozen,
    protocolSha256: sha256({
      ...frozen,
      protocolSha256: undefined,
    }),
  };
  await writeJson(PROTOCOL_PATH, withHash);
  await writeJson(path.join(EVIDENCE_ROOT, "preflight.json"), preflight);
  return withHash;
}

function campaignDirectoryName(campaignId) {
  return campaignId.replaceAll(":", "_");
}

function campaignResultPath(campaignId) {
  return path.join(RUNS_ROOT, campaignDirectoryName(campaignId), "result.json");
}

async function loadCampaignResults(assignments) {
  const results = [];
  for (const assignment of assignments) {
    const result = await readJsonIfPresent(campaignResultPath(assignment.campaignId));
    if (result !== null) results.push(result);
  }
  return results;
}

async function runAssignments(protocol, adapter, assignments, {
  spendCapUsd,
} = {}) {
  const { briefText } = await courtInputs();
  const existing = await loadCampaignResults(assignments);
  const byCampaign = new Map(existing.map((result) => [result.campaignId, result]));
  for (const assignment of assignments) {
    if (byCampaign.has(assignment.campaignId)) continue;
    const spent = [...byCampaign.values()].reduce((total, result) => total + result.costUsd, 0);
    if (Number.isFinite(spendCapUsd) && spent + protocol.budget.costUsd > spendCapUsd) {
      throw new Error(
        `refusing to start ${assignment.campaignId}: remaining spend cap is below one campaign hard limit`,
      );
    }
    const checkpoint = adapter.checkpoints.find((item) => item.id === assignment.checkpointId);
    if (checkpoint === undefined) throw new Error(`unknown checkpoint ${assignment.checkpointId}`);
    const result = await runDungenessCampaign({
      assignment,
      protocol,
      adapter,
      checkpoint,
      briefText,
      dungenessRepo: DUNGENESS_REPO,
      runRoot: RUNS_ROOT,
    });
    byCampaign.set(assignment.campaignId, result);
    if (Number.isFinite(spendCapUsd)) assertWithinSpendCap([...byCampaign.values()], spendCapUsd);
  }
  return assignments.map((assignment) => byCampaign.get(assignment.campaignId));
}

async function loadFrozenContext() {
  const protocol = await readJson(PROTOCOL_PATH);
  const inspection = await inspectDungenessCheckout();
  const pin = await readDungenessPin();
  const loaded = await loadAdapter(inspection, pin);
  if (loaded.adapter === null) throw new Error(loaded.error);
  if (sha256({ ...protocol, protocolSha256: undefined }) !== protocol.protocolSha256) {
    throw new Error("frozen protocol hash mismatch");
  }
  if (protocol.dungeness.sha !== inspection.sha || protocol.dungeness.sha !== pin?.sha) {
    throw new Error("frozen protocol no longer matches Dungeness checkout");
  }
  return { protocol, adapter: loaded.adapter };
}

export async function runCalibration() {
  const { protocol, adapter } = await loadFrozenContext();
  const results = await runAssignments(protocol, adapter, protocol.calibration.assignments, {
    spendCapUsd: protocol.calibration.spendCapUsd,
  });
  const summary = {
    schema: "yukon-kg.dungeness-adaptive-calibration.v1",
    protocolSha256: protocol.protocolSha256,
    createdAt: nowIso(),
    campaigns: results.length,
    pairs: results.length / KNOWLEDGE_ARMS.length,
    spentUsd: results.reduce((total, result) => total + result.costUsd, 0),
    results,
  };
  await writeJson(path.join(EVIDENCE_ROOT, "calibration.json"), summary);
  return summary;
}

export async function freezePower() {
  const { protocol } = await loadFrozenContext();
  const calibration = await readJson(path.join(EVIDENCE_ROOT, "calibration.json"));
  if (calibration.protocolSha256 !== protocol.protocolSha256) throw new Error("calibration protocol mismatch");
  const power = estimateConfirmatoryPairs(calibration.results);
  const frozen = {
    schema: "yukon-kg.dungeness-adaptive-power.v1",
    protocolSha256: protocol.protocolSha256,
    createdAt: nowIso(),
    ...power,
    spendCapUsd: power.projectedMaxSpendUsd,
    assignments: protocol.confirmatory.assignments.slice(0, power.scheduledPairs * KNOWLEDGE_ARMS.length),
  };
  await writeJson(POWER_PATH, frozen);
  return frozen;
}

export async function analyzeConfirmatory() {
  const { protocol } = await loadFrozenContext();
  const power = await readJson(POWER_PATH);
  const results = await loadCampaignResults(power.assignments);
  const pairCount = results.length / KNOWLEDGE_ARMS.length;
  if (!Number.isInteger(pairCount) || !CONFIRMATORY_INTERIMS.includes(pairCount)) {
    throw new Error(`confirmatory results do not end at a scheduled interim: ${pairCount} pairs`);
  }
  const analysis = analyzeAdaptiveCampaigns(results, {
    maximumPairs: power.scheduledPairs,
  });
  const report = {
    ...analysis,
    protocolSha256: protocol.protocolSha256,
    powerSha256: sha256(power),
    createdAt: nowIso(),
    spentUsd: results.reduce((total, result) => total + result.costUsd, 0),
    results,
  };
  await writeJson(REPORT_PATH, report);
  return report;
}

export async function runConfirmatory() {
  const { protocol, adapter } = await loadFrozenContext();
  const power = await readJson(POWER_PATH);
  for (const interim of CONFIRMATORY_INTERIMS.filter((count) => count <= power.scheduledPairs)) {
    const assignments = power.assignments.slice(0, interim * KNOWLEDGE_ARMS.length);
    await runAssignments(protocol, adapter, assignments, { spendCapUsd: power.spendCapUsd });
    const report = await analyzeConfirmatory();
    if (report.decision !== "CONTINUE") return report;
  }
  return analyzeConfirmatory();
}

export async function freezePrimeFactorProtocol() {
  const report = await readJsonIfPresent(REPORT_PATH);
  if (report?.decision !== "ADOPT_ADAPTIVE_STATE") {
    const notWarranted = {
      schema: "yukon-kg.dungeness-prime-factor-decision.v1",
      createdAt: nowIso(),
      status: "NOT_WARRANTED",
      reason: report === null
        ? "no confirmatory adaptive-evidence result exists"
        : `adaptive evidence decision is ${report.decision}`,
      parentReportSha256: report === null ? null : sha256(report),
    };
    await writeJson(PRIME_REPORT_PATH, notWarranted);
    return notWarranted;
  }
  const { protocol, adapter } = await loadFrozenContext();
  const frozen = {
    schema: "yukon-kg.dungeness-prime-factor-protocol.v1",
    createdAt: nowIso(),
    parentProtocolSha256: protocol.protocolSha256,
    parentReportSha256: sha256(report),
    pairCount: 20,
    procedureModes: [...PROCEDURE_MODES],
    assignments: buildPairedAssignments({
      checkpoints: adapter.checkpoints,
      pairCount: 20,
      phase: "prime_factor",
      seed: `${protocol.seed}:prime-factor`,
      procedureModes: PROCEDURE_MODES,
    }),
  };
  const withHash = { ...frozen, protocolSha256: sha256(frozen) };
  await writeJson(PRIME_PROTOCOL_PATH, withHash);
  return withHash;
}

export async function runPrimeFactor() {
  const frozen = await freezePrimeFactorProtocol();
  if (frozen.status === "NOT_WARRANTED") return frozen;
  const { protocol, adapter } = await loadFrozenContext();
  const spendCapUsd = Number.parseFloat(process.env.DUNGENESS_PRIME_SPEND_CAP_USD ?? "100");
  const results = await runAssignments(protocol, adapter, frozen.assignments, { spendCapUsd });
  const analysis = analyzePrimeFactorCampaigns(results);
  const report = {
    ...analysis,
    createdAt: nowIso(),
    parentProtocolSha256: protocol.protocolSha256,
    primeProtocolSha256: frozen.protocolSha256,
    spentUsd: results.reduce((total, result) => total + result.costUsd, 0),
    results,
  };
  await writeJson(PRIME_REPORT_PATH, report);
  return report;
}

if (import.meta.main) {
  const command = process.argv[2] ?? "preflight";
  const operation = command === "preflight"
    ? runAdaptivePreflight().then(async (value) => {
      await writeJson(path.join(EVIDENCE_ROOT, "preflight.json"), value);
      return value;
    })
    : command === "freeze"
      ? freezeProtocol()
      : command === "calibrate"
        ? runCalibration()
        : command === "freeze-power"
          ? freezePower()
          : command === "confirmatory"
            ? runConfirmatory()
            : command === "analyze"
              ? analyzeConfirmatory()
              : command === "prime-factor"
                ? runPrimeFactor()
                : command === "report"
                  ? readJson(REPORT_PATH)
                  : Promise.reject(new Error(`unknown command ${command}`));
  operation.then(
    (value) => {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      if (value?.status === "BLOCKED") process.exitCode = 1;
    },
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}
