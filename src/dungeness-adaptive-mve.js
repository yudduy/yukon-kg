#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadIndexedAtlasRelease } from "./atlas-local.js";
import {
  buildEcdsaWorkingKnowledgeBrief,
  createEvidenceSigningKeyPair,
  evidenceSignerFromPrivateKey,
  ideasFromRelease,
  ledgerSha256,
  parseEvidenceLedger,
  verifyEvidenceValue,
} from "./atlas-runtime/index.ts";
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
const DEFAULT_SIGNING_KEY_PATH = "/cursor/stores/self/yukon-kg/dungeness-ledger-ed25519.pem";
const RUNTIME_FILES = [
  "src/atlas-runtime/evidence-ledger.ts",
  "src/dungeness-adaptive-mve.js",
  "src/dungeness-adaptive-protocol.js",
  "src/dungeness-campaign-runner.js",
  "src/dungeness-kb-protocol.js",
  "src/openrouter.js",
];

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

async function runtimeSha256() {
  const files = {};
  for (const relative of RUNTIME_FILES) {
    files[relative] = sha256(await fs.readFile(path.join(ROOT, relative)));
  }
  return sha256(files);
}

function providerName() {
  return process.env.OPENROUTER_PROVIDER?.trim() || "OpenAI";
}

function environmentNumber(name, fallback) {
  const raw = process.env[name]?.trim();
  return raw ? Number.parseFloat(raw) : fallback;
}

function signingKeyPath() {
  const pathname = path.resolve(
    process.env.DUNGENESS_LEDGER_PRIVATE_KEY_PATH?.trim() || DEFAULT_SIGNING_KEY_PATH,
  );
  if (pathname.startsWith(`${path.resolve(ROOT)}${path.sep}`)) {
    throw new Error("the ledger private key must stay outside the repository");
  }
  return pathname;
}

async function ensureSigningKey() {
  const pathname = signingKeyPath();
  try {
    const metadata = await fs.stat(pathname);
    if ((metadata.mode & 0o077) !== 0) throw new Error("ledger signing key permissions must be 0600");
    const privateKeyPem = await fs.readFile(pathname, "utf8");
    return { pathname, privateKeyPem, signer: evidenceSignerFromPrivateKey(privateKeyPem) };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const created = createEvidenceSigningKeyPair();
  await fs.mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
  await fs.writeFile(pathname, created.privateKeyPem, { mode: 0o600, flag: "wx" });
  return { pathname, privateKeyPem: created.privateKeyPem, signer: created.signer };
}

async function loadSigningKey(expectedSignerSha256) {
  const pathname = signingKeyPath();
  const metadata = await fs.stat(pathname);
  if ((metadata.mode & 0o077) !== 0) throw new Error("ledger signing key permissions must be 0600");
  const privateKeyPem = await fs.readFile(pathname, "utf8");
  const signer = evidenceSignerFromPrivateKey(privateKeyPem);
  if (signer.publicKeySha256 !== expectedSignerSha256) {
    throw new Error("local ledger signing key does not match the frozen protocol");
  }
  return { pathname, privateKeyPem, signer };
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

async function isolationRunnerStatus(adapter) {
  if (adapter === null) return { ok: false, path: null, sha256: null };
  const development = adapter.evaluator.developmentCommand[0];
  const hidden = adapter.evaluator.hiddenCommand[0];
  const attestation = adapter.evaluator.attestationCommand[0];
  if (development !== hidden || development !== attestation) {
    return { ok: false, path: null, sha256: null, error: "development and hidden evaluators use different runners" };
  }
  let pathname = development;
  if (!path.isAbsolute(pathname)) {
    const resolved = await runProcess("which", [pathname], { timeoutMs: 30_000 });
    if (resolved.exitCode !== 0) {
      return { ok: false, path: null, sha256: null, error: `evaluator runner ${pathname} is not installed` };
    }
    pathname = resolved.stdout.trim();
  }
  try {
    const digest = sha256(await fs.readFile(pathname));
    return {
      ok: digest === adapter.isolation.runnerSha256,
      path: pathname,
      sha256: digest,
      error: digest === adapter.isolation.runnerSha256 ? null : "evaluator runner hash mismatch",
    };
  } catch (error) {
    return { ok: false, path: pathname, sha256: null, error: error.message };
  }
}

async function evaluatorAttestationStatus(adapter) {
  if (adapter === null) return { ok: false, sha256: null };
  const command = adapter.evaluator.attestationCommand;
  const result = await runProcess(command[0], command.slice(1), {
    cwd: DUNGENESS_REPO,
    timeoutMs: adapter.evaluator.timeoutMs,
    unsetEnv: ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "YUDDUY_GITHUB_TOKEN"],
  });
  if (result.exitCode !== 0) {
    return { ok: false, sha256: null, error: result.stderr || result.stdout };
  }
  try {
    const value = JSON.parse(result.stdout);
    const expected = {
      schema: "yukon-kg.dungeness-evaluator-attestation.v1",
      repoSha: adapter.repoSha,
      isolationRunnerSha256: adapter.isolation.runnerSha256,
      checkpoints: adapter.checkpoints,
    };
    const ok = sha256(value) === sha256(expected);
    return {
      ok,
      sha256: sha256(value),
      error: ok ? null : "evaluator attestation differs from the frozen adapter",
    };
  } catch (error) {
    return { ok: false, sha256: null, error: `invalid evaluator attestation: ${error.message}` };
  }
}

export async function runAdaptivePreflight() {
  const atlas = await verifyPublicData();
  const inspection = await inspectDungenessCheckout();
  const pin = await readDungenessPin();
  const loadedAdapter = await loadAdapter(inspection, pin);
  const refs = inspection.present
    ? await checkpointRefsPresent(loadedAdapter.adapter)
    : { ok: false, missing: [] };
  const isolationRunner = await isolationRunnerStatus(loadedAdapter.adapter);
  const evaluatorAttestation = inspection.present
    ? await evaluatorAttestationStatus(loadedAdapter.adapter)
    : { ok: false, sha256: null };
  const apiKeyPresent = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const checks = {
    atlasPass: atlas.status === "PASS",
    dungenessPresent: inspection.present === true,
    dungenessPinned: inspection.present === true
      && typeof pin?.sha === "string"
      && pin.sha === inspection.sha,
    adapterValid: loadedAdapter.adapter !== null,
    isolationRunnerPinned: isolationRunner.ok,
    evaluatorAttestation: evaluatorAttestation.ok,
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
      isolationRunner,
      evaluatorAttestation,
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
  return {
    loaded,
    brief,
    briefText: variants.state_brief.text,
    briefSha256: variants.state_brief.sha256,
  };
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
  const { loaded, briefSha256 } = await courtInputs();
  const signing = await ensureSigningKey();
  const protocol = freezeAdaptiveProtocol({
    adapter,
    dungenessPin: pin,
    atlasReleaseId: loaded.release.pointer.id,
    atlasManifestSha256: loaded.release.pointer.manifestSha256,
    stateBriefSha256: briefSha256,
    runtimeSha256: await runtimeSha256(),
    model: pinnedOpenRouterModel(),
    provider: providerName(),
    decoding: adaptiveDecoding(),
    signer: signing.signer,
    seed: process.env.DUNGENESS_PROTOCOL_SEED?.trim() || "dungeness-adaptive-v1",
    budget: campaignBudget(),
    createdAt: nowIso(),
  });
  const calibrationSpendCapUsd = environmentNumber("DUNGENESS_CALIBRATION_SPEND_CAP_USD", 100);
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

function campaignResultPath(protocolSha256, campaignId) {
  return path.join(RUNS_ROOT, protocolSha256, campaignDirectoryName(campaignId), "result.json");
}

async function loadCampaignResults(assignments, protocol) {
  const results = [];
  for (const assignment of assignments) {
    const resultPath = campaignResultPath(protocol.protocolSha256, assignment.campaignId);
    const result = await readJsonIfPresent(resultPath);
    if (result === null) continue;
    const { attestation, ...resultBody } = result;
    if (!verifyEvidenceValue(resultBody, attestation, protocol.signer)) {
      throw new Error(`campaign ${assignment.campaignId} result signature mismatch`);
    }
    if (
      result.protocolSha256 !== protocol.protocolSha256
      || result.campaignId !== assignment.campaignId
      || result.pairId !== assignment.pairId
      || result.checkpointId !== assignment.checkpointId
      || result.arm !== assignment.arm
      || result.procedureMode !== assignment.procedureMode
      || result.seed !== assignment.seed
    ) continue;
    const ledgerText = await fs.readFile(path.join(path.dirname(resultPath), "ledger.jsonl"), "utf8");
    const ledger = parseEvidenceLedger(ledgerText, {
      expectedSignerSha256: protocol.signer.publicKeySha256,
    });
    if (
      ledger.header.campaignId !== assignment.campaignId
      || ledger.header.protocolSha256 !== protocol.protocolSha256
      || ledgerSha256(ledgerText) !== result.ledgerSha256
    ) {
      throw new Error(`campaign ${assignment.campaignId} ledger binding mismatch`);
    }
    const checkpoint = protocol.dungeness.checkpoints.find((item) => item.id === assignment.checkpointId);
    const hiddenReceipts = ledger.receipts.filter((receipt) => (
      receipt.panelSha256 === checkpoint?.hiddenPanelSha256
    ));
    if (
      hiddenReceipts.length !== result.hiddenAdjudication.length
      || hiddenReceipts.length > 1
      || (result.finalOutputValid && hiddenReceipts.length !== 1)
    ) {
      throw new Error(`campaign ${assignment.campaignId} hidden receipt mismatch`);
    }
    if (
      hiddenReceipts.length === 1
      && hiddenReceipts[0].receiptSha256 !== result.hiddenAdjudication[0]?.receiptSha256
    ) throw new Error(`campaign ${assignment.campaignId} hidden receipt ID mismatch`);
    const recomputedGain = Math.max(0, (result.baselineScore - result.bestValidScore) / result.baselineScore);
    if (Math.abs(recomputedGain - result.normalizedGain) > 1e-12) {
      throw new Error(`campaign ${assignment.campaignId} normalized gain mismatch`);
    }
    results.push(result);
  }
  return results;
}

async function runAssignments(protocol, adapter, assignments, {
  spendCapUsd,
  signingPrivateKeyPem,
} = {}) {
  const { briefText } = await courtInputs();
  const existing = await loadCampaignResults(assignments, protocol);
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
    await runDungenessCampaign({
      assignment,
      protocol,
      adapter,
      checkpoint,
      briefText,
      dungenessRepo: DUNGENESS_REPO,
      runRoot: path.join(RUNS_ROOT, protocol.protocolSha256),
      signingPrivateKeyPem,
    });
    const verified = await loadCampaignResults([assignment], protocol);
    if (verified.length !== 1) throw new Error(`campaign ${assignment.campaignId} did not verify after execution`);
    byCampaign.set(assignment.campaignId, verified[0]);
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
  if (sha256(loaded.adapter) !== protocol.dungeness.adapterSha256) {
    throw new Error("frozen protocol no longer matches the Dungeness adapter");
  }
  const isolationRunner = await isolationRunnerStatus(loaded.adapter);
  if (!isolationRunner.ok) throw new Error(isolationRunner.error);
  const evaluatorAttestation = await evaluatorAttestationStatus(loaded.adapter);
  if (!evaluatorAttestation.ok) throw new Error(evaluatorAttestation.error);
  if (await runtimeSha256() !== protocol.runtimeSha256) {
    throw new Error("frozen protocol no longer matches the experiment runtime");
  }
  const court = await courtInputs();
  if (
    court.loaded.release.pointer.id !== protocol.atlas.releaseId
    || court.loaded.release.pointer.manifestSha256 !== protocol.atlas.manifestSha256
    || court.briefSha256 !== protocol.atlas.stateBriefSha256
  ) {
    throw new Error("frozen protocol no longer matches the Atlas state brief");
  }
  const signing = await loadSigningKey(protocol.signer.publicKeySha256);
  return { protocol, adapter: loaded.adapter, signing };
}

export async function runCalibration() {
  const { protocol, adapter, signing } = await loadFrozenContext();
  const results = await runAssignments(protocol, adapter, protocol.calibration.assignments, {
    spendCapUsd: protocol.calibration.spendCapUsd,
    signingPrivateKeyPem: signing.privateKeyPem,
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
  const verifiedCalibration = await loadCampaignResults(protocol.calibration.assignments, protocol);
  if (verifiedCalibration.length !== protocol.calibration.assignments.length) {
    throw new Error("calibration is incomplete or contains an unverifiable campaign");
  }
  const power = estimateConfirmatoryPairs(verifiedCalibration);
  if (!power.attainableAtCap) throw new Error("the practical MDE is not attainable at the confirmatory cap");
  const assignments = protocol.confirmatory.assignments.slice(
    0,
    power.scheduledPairs * KNOWLEDGE_ARMS.length,
  );
  const guaranteedMaxSpendUsd = assignments.length * protocol.budget.costUsd;
  const spendCapUsd = environmentNumber(
    "DUNGENESS_CONFIRMATORY_SPEND_CAP_USD",
    guaranteedMaxSpendUsd,
  );
  if (spendCapUsd < guaranteedMaxSpendUsd) {
    throw new Error(
      `confirmatory spend cap ${spendCapUsd} is below the guaranteed campaign maximum ${guaranteedMaxSpendUsd}`,
    );
  }
  const body = {
    schema: "yukon-kg.dungeness-adaptive-power.v1",
    protocolSha256: protocol.protocolSha256,
    createdAt: nowIso(),
    ...power,
    guaranteedMaxSpendUsd,
    spendCapUsd,
    assignments,
  };
  const powerSha256 = sha256(body);
  const frozen = {
    ...body,
    powerSha256,
    confirmatoryProtocolSha256: sha256({
      phase: "confirmatory",
      parentProtocolSha256: protocol.protocolSha256,
      powerSha256,
    }),
  };
  await writeJson(POWER_PATH, frozen);
  return frozen;
}

async function loadPower(protocol) {
  const power = await readJson(POWER_PATH);
  const { powerSha256, confirmatoryProtocolSha256, ...body } = power;
  if (power.protocolSha256 !== protocol.protocolSha256) throw new Error("power protocol mismatch");
  if (sha256(body) !== powerSha256) throw new Error("power file hash mismatch");
  const expectedConfirmatory = sha256({
    phase: "confirmatory",
    parentProtocolSha256: protocol.protocolSha256,
    powerSha256,
  });
  if (confirmatoryProtocolSha256 !== expectedConfirmatory) {
    throw new Error("confirmatory protocol binding mismatch");
  }
  return power;
}

function confirmatoryProtocol(protocol, power) {
  return {
    ...protocol,
    parentProtocolSha256: protocol.protocolSha256,
    powerSha256: power.powerSha256,
    protocolSha256: power.confirmatoryProtocolSha256,
  };
}

export async function analyzeConfirmatory() {
  const { protocol } = await loadFrozenContext();
  const power = await loadPower(protocol);
  const phaseProtocol = confirmatoryProtocol(protocol, power);
  const results = await loadCampaignResults(power.assignments, phaseProtocol);
  const pairCount = results.length / KNOWLEDGE_ARMS.length;
  if (!Number.isInteger(pairCount) || !CONFIRMATORY_INTERIMS.includes(pairCount)) {
    throw new Error(`confirmatory results do not end at a scheduled interim: ${pairCount} pairs`);
  }
  const analysis = analyzeAdaptiveCampaigns(results, {
    maximumPairs: power.scheduledPairs,
  });
  const report = {
    ...analysis,
    protocolSha256: phaseProtocol.protocolSha256,
    parentProtocolSha256: protocol.protocolSha256,
    powerSha256: power.powerSha256,
    createdAt: nowIso(),
    spentUsd: results.reduce((total, result) => total + result.costUsd, 0),
    results,
  };
  await writeJson(REPORT_PATH, report);
  return report;
}

export async function runConfirmatory() {
  const { protocol, adapter, signing } = await loadFrozenContext();
  const power = await loadPower(protocol);
  const phaseProtocol = confirmatoryProtocol(protocol, power);
  for (const interim of CONFIRMATORY_INTERIMS.filter((count) => count <= power.scheduledPairs)) {
    const assignments = power.assignments.slice(0, interim * KNOWLEDGE_ARMS.length);
    await runAssignments(phaseProtocol, adapter, assignments, {
      spendCapUsd: power.spendCapUsd,
      signingPrivateKeyPem: signing.privateKeyPem,
    });
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
  const existing = await readJsonIfPresent(PRIME_PROTOCOL_PATH);
  if (existing !== null) {
    const { protocolSha256, ...body } = existing;
    if (
      sha256(body) !== protocolSha256
      || existing.parentProtocolSha256 !== protocol.protocolSha256
      || existing.parentReportSha256 !== sha256(report)
    ) throw new Error("existing Prime-factor protocol does not match its frozen parents");
    return existing;
  }
  const frozen = {
    schema: "yukon-kg.dungeness-prime-factor-protocol.v1",
    createdAt: nowIso(),
    parentProtocolSha256: protocol.protocolSha256,
    parentReportSha256: sha256(report),
    pairCount: 40,
    procedureModes: [...PROCEDURE_MODES],
    assignments: buildPairedAssignments({
      checkpoints: adapter.checkpoints,
      pairCount: 40,
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
  const { protocol, adapter, signing } = await loadFrozenContext();
  const phaseProtocol = {
    ...protocol,
    parentProtocolSha256: protocol.protocolSha256,
    protocolSha256: frozen.protocolSha256,
  };
  const guaranteedMaxSpendUsd = frozen.assignments.length * protocol.budget.costUsd;
  const spendCapUsd = environmentNumber("DUNGENESS_PRIME_SPEND_CAP_USD", guaranteedMaxSpendUsd);
  if (spendCapUsd < guaranteedMaxSpendUsd) {
    throw new Error(`Prime-factor spend cap is below the guaranteed campaign maximum ${guaranteedMaxSpendUsd}`);
  }
  const results = await runAssignments(phaseProtocol, adapter, frozen.assignments, {
    spendCapUsd,
    signingPrivateKeyPem: signing.privateKeyPem,
  });
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
