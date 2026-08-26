#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeAtlasEvidenceParity } from "./atlas-evidence-parity.js";
import { runProcess } from "./mve.js";
import {
  ATLAS_DUPLICATE_MODELS,
  ATLAS_DUPLICATE_REASONING,
  ATLAS_DUPLICATE_PROTOCOL_VERSION,
  CONDITIONS,
  CONFIRMATORY_CASES,
  PILOT_CASES,
  PINNED_MANIFEST_SHA256,
  PINNED_RELEASE_ID,
  QUERY_BYTE_LIMIT,
  QUERY_CALL_LIMIT,
  REPEAT_COUNT,
  RESPONSE_SCHEMA,
  RESPONSE_BYTE_LIMIT,
  SESSION_TIMEOUT_MS,
  analyzeConfirmatoryResults,
  assessPilotResults,
  buildAttemptFacts,
  buildEvidenceIndex,
  materializeConditionCorpora,
  readAndValidateCaseFixture,
  scoreCaseResponse,
  validateResponse,
  writeCanonicalJson,
} from "./atlas-duplicate-protocol.js";
import { verifyAtlasFixtureReachability } from "./atlas-reachability.js";
import { canonicalStringify, sha256 } from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_ROOT = path.join(ROOT, ".runs", "atlas-duplicate");
const QUERY_PROGRAM = path.join(ROOT, "src", "atlas-query.js");
const DEFAULT_RELEASE_DIRECTORY = path.join(
  ROOT,
  "docs",
  "ecdsa",
  "releases",
  PINNED_RELEASE_ID,
);
const DEFAULT_ATLAS_MODULE = path.join(ROOT, "src", "atlas-runtime", "index.ts");
const DEFAULT_FIXTURE_CANDIDATES = [
  path.join(ROOT, "fixtures", "atlas-duplicate-cases.json"),
  path.join(ROOT, "test", "fixtures", "atlas-duplicate-cases.json"),
  path.join(ROOT, "atlas-duplicate-cases.json"),
];
const SESSION_CONCURRENCY = 6;
const ALLOWED_NON_COMMAND_ITEMS = new Set(["agent_message", "reasoning"]);

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

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function readJsonIfPresent(target) {
  return await exists(target) ? readJson(target) : null;
}

async function writeTextAtomic(target, contents) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, target);
}

function runDirectory(runId) {
  if (!/^[A-Za-z0-9_.:-]+$/u.test(runId)) throw new Error("run id contains unsupported characters");
  return path.join(RUNS_ROOT, runId);
}

function manifest(runId, fixturePath) {
  return {
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    runId,
    createdAt: nowIso(),
    models: ATLAS_DUPLICATE_MODELS,
    reasoning: ATLAS_DUPLICATE_REASONING,
    release: { id: PINNED_RELEASE_ID, manifestSha256: PINNED_MANIFEST_SHA256 },
    caseFixtureInput: fixturePath,
    conditions: CONDITIONS,
    budgets: {
      repeatsPerCaseConditionModel: REPEAT_COUNT,
      queryCalls: QUERY_CALL_LIMIT,
      returnedEvidenceBytes: QUERY_BYTE_LIMIT,
      finalMessageBytes: RESPONSE_BYTE_LIMIT,
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
      pilotCases: PILOT_CASES,
      confirmatoryCases: CONFIRMATORY_CASES,
    },
    toolPolicy: {
      allowedCommands: [
        "./atlas-query search \"<argument>\"",
        "./atlas-query read \"<argument>\"",
        "./atlas-query page \"<argument>\"",
      ],
      network: "disabled",
      sessions: "fresh_ephemeral",
    },
  };
}

async function resolveFixturePath(explicit = null) {
  const configured = explicit ?? process.env.ATLAS_DUPLICATE_CASES?.trim() ?? null;
  if (configured !== null) {
    const resolved = path.resolve(configured);
    if (!(await exists(resolved))) throw new Error(`Atlas duplicate case fixture not found: ${resolved}`);
    return resolved;
  }
  for (const candidate of DEFAULT_FIXTURE_CANDIDATES) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    `Atlas duplicate case fixture is required; set ATLAS_DUPLICATE_CASES or create ${DEFAULT_FIXTURE_CANDIDATES[0]}`,
  );
}

function releaseDirectory() {
  return path.resolve(process.env.ATLAS_DUPLICATE_RELEASE_DIR?.trim() || DEFAULT_RELEASE_DIRECTORY);
}

function atlasModulePath() {
  return path.resolve(process.env.ATLAS_DUPLICATE_ATLAS_MODULE?.trim() || DEFAULT_ATLAS_MODULE);
}

function safeReleasePath(directory, relativePath) {
  const decoded = decodeURIComponent(relativePath);
  const target = path.resolve(directory, decoded);
  if (target !== directory && !target.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`sealed Atlas fetch escaped the release directory: ${relativePath}`);
  }
  return target;
}

export async function loadPinnedAtlas({ directory = releaseDirectory(), atlasModulePath: modulePath = atlasModulePath() } = {}) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifestBytes = await fs.readFile(manifestPath);
  if (sha256(manifestBytes) !== PINNED_MANIFEST_SHA256) {
    throw new Error("local Atlas manifest does not match the pinned manifest SHA-256");
  }
  const atlas = await import(pathToFileURL(modulePath).href);
  for (const name of ["loadAtlasRelease", "loadAtlasSubmissionDetail"]) {
    if (typeof atlas[name] !== "function") throw new Error(`production Atlas module does not export ${name}`);
  }
  if (
    typeof (atlas.buildAtlasIdeaEvidenceBrief ?? atlas.buildAtlasDirectionBrief) !== "function"
    || typeof (atlas.listAtlasIdeaAttempts ?? atlas.listAtlasDirectionAttempts) !== "function"
  ) {
    throw new Error("production Atlas module does not export the idea-evidence compiler");
  }
  const baseUrl = `https://atlas-sealed.invalid/${PINNED_RELEASE_ID}/`;
  const basePath = new URL(baseUrl).pathname;
  const pointer = { id: PINNED_RELEASE_ID, manifestSha256: PINNED_MANIFEST_SHA256, baseUrl };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== "https://atlas-sealed.invalid" || !url.pathname.startsWith(basePath)) {
      throw new Error(`network disabled by sealed Atlas fetch adapter: ${url.href}`);
    }
    const target = safeReleasePath(directory, url.pathname.slice(basePath.length));
    try {
      return new Response(await fs.readFile(target), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (error.code === "ENOENT") return new Response("not found", { status: 404 });
      throw error;
    }
  };
  try {
    const release = await atlas.loadAtlasRelease(pointer);
    const detailsBySubmission = new Map();
    const representativeByShard = new Map();
    for (const submission of release.submissions.submissions) {
      if (!representativeByShard.has(submission.detailShard)) {
        representativeByShard.set(submission.detailShard, submission.id);
      }
    }
    for (const submissionId of representativeByShard.values()) {
      const model = await atlas.loadAtlasSubmissionDetail(release, submissionId);
      for (const id of model.submissionById.keys()) detailsBySubmission.set(id, model);
    }
    return { atlas, release, detailsBySubmission, pointer, directory };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function compilerRowCount(atlas, release) {
  const listIdeaAttempts = atlas.listAtlasIdeaAttempts ?? atlas.listAtlasDirectionAttempts;
  return release.decomposition.ideas.reduce((total, idea) => (
    total + listIdeaAttempts(release, idea.ideaId, { limit: 100 }).page.total
  ), 0);
}

function corpusAccounting(corpora) {
  const sourceHashes = Object.fromEntries(CONDITIONS.map((condition) => [
    condition,
    sha256(corpora[condition].sourceAtoms),
  ]));
  const sourceRecordHashes = Object.fromEntries(CONDITIONS.map((condition) => [
    condition,
    sha256(corpora[condition].sourceRecordIds),
  ]));
  const sameSourceAtoms = new Set(Object.values(sourceHashes)).size === 1;
  const sameSourceRecords = new Set(Object.values(sourceRecordHashes)).size === 1;
  const rawWitnesses = corpora.raw.records.filter((record) => record.kind === "raw_mutation_witness").length;
  const flatRows = corpora.flat.records.filter((record) => record.kind === "flat_attempt").length;
  const flatPlusBriefIdeaRows = corpora.flat_plus_brief.records.filter((record) => record.kind === "idea_direction").length;
  const flatPageRows = Object.values(corpora.flat.pages).reduce((total, page) => total + page.items.length, 0);
  const flatPlusBriefPageRows = Object.values(corpora.flat_plus_brief.pages).reduce((total, page) => total + page.items.length, 0);
  const rawRecordIds = new Set(corpora.raw.records.map((record) => record.id));
  const rawCoversAtom = (sourceRef) => {
    if (sourceRef.startsWith("submission:")) return rawRecordIds.has(`raw:${sourceRef}`);
    if (sourceRef.startsWith("change:")) return rawRecordIds.has(`raw:${sourceRef}`);
    if (sourceRef.startsWith("witness:")) return rawRecordIds.has(`raw:${sourceRef}`);
    if (sourceRef.startsWith("route:")) return rawRecordIds.has(`raw:${sourceRef}`);
    if (sourceRef.startsWith("detail:")) return rawRecordIds.has(`raw:detail:${sourceRef.slice(sourceRef.lastIndexOf("#") + 1)}`);
    return false;
  };
  const flatAtoms = new Set(corpora.flat.records.flatMap((record) => record.body.sourceRefs ?? []));
  const rawCoverage = corpora.raw.sourceAtoms.every(rawCoversAtom);
  const flatCoverage = corpora.flat.sourceAtoms.every((sourceRef) => flatAtoms.has(sourceRef));
  const flatPlusBriefRecordIds = new Set(corpora.flat_plus_brief.records.map((record) => record.id));
  const flatPlusBriefCoverage = corpora.flat_plus_brief.sourceAtoms.every((sourceRef) => {
    if (sourceRef.startsWith("detail:")) {
      return flatPlusBriefRecordIds.has(`raw:detail:${sourceRef.slice(sourceRef.lastIndexOf("#") + 1)}`);
    }
    return flatPlusBriefRecordIds.has(`raw:${sourceRef}`);
  });
  const sourceRecordCoverage = Object.fromEntries(CONDITIONS.map((condition) => {
    const ids = new Set(corpora[condition].records.map((record) => record.id));
    return [condition, corpora[condition].sourceRecordIds.every((id) => ids.has(id))];
  }));
  return {
    sourceHashes,
    sourceRecordHashes,
    sameSourceAtoms,
    sameSourceRecords,
    sourceAtomCoverage: { raw: rawCoverage, flat: flatCoverage, flat_plus_brief: flatPlusBriefCoverage },
    sourceRecordCoverage,
    rawWitnesses,
    flatRows,
    flatIdeaRows: corpora.flat.records.filter((record) => record.kind === "idea_direction").length,
    flatPlusBriefIdeaRows,
    flatPageRows,
    flatPlusBriefPageRows,
    uniqueRecordIds: Object.fromEntries(CONDITIONS.map((condition) => [
      condition,
      new Set(corpora[condition].records.map((record) => record.id)).size === corpora[condition].records.length,
    ])),
  };
}

function deterministicPreflightChecks({ atlas, release, detailsBySubmission, fixture, corpora }) {
  const corrections = [];
  const witnesses = release.decomposition?.mutationWitnesses?.length ?? 0;
  const routes = release.decomposition?.submissionRoutes?.length ?? 0;
  const ideas = release.decomposition?.ideas?.length ?? 0;
  const routedRows = compilerRowCount(atlas, release);
  const facts = buildAttemptFacts(release, detailsBySubmission);
  const accounting = corpusAccounting(corpora);
  const evidence = buildEvidenceIndex(release, detailsBySubmission);
  const stableCorpora = materializeConditionCorpora(release, detailsBySubmission, atlas);
  if (release.manifest.releaseId !== PINNED_RELEASE_ID) corrections.push("release ID differs from the pin");
  if (release.pointer.manifestSha256 !== PINNED_MANIFEST_SHA256) corrections.push("manifest hash differs from the pin");
  if (ideas !== 75) corrections.push(`expected 75 Ideas, found ${ideas}`);
  if (witnesses !== 2_311) corrections.push(`expected 2,311 raw witnesses, found ${witnesses}`);
  if (routedRows !== 2_209) corrections.push(`expected 2,209 Idea-routed compiler rows, found ${routedRows}`);
  if (routes !== 949) corrections.push(`expected 949 routes, found ${routes}`);
  if (detailsBySubmission.size !== 949) corrections.push(`expected 949 verified submission details, found ${detailsBySubmission.size}`);
  if (fixture.pilot.length !== PILOT_CASES || fixture.confirmatory.length !== CONFIRMATORY_CASES) corrections.push("case counts differ from protocol");
  if (
    facts.length !== routedRows
    || accounting.flatRows !== routedRows
    || accounting.flatPageRows !== routedRows
    || accounting.flatPlusBriefPageRows !== routedRows
  ) {
    corrections.push("not every Idea-routed compiler row materialized in each indexed corpus surface");
  }
  if (accounting.flatIdeaRows !== ideas || accounting.flatPlusBriefIdeaRows !== ideas) {
    corrections.push("flat and flat-plus-brief corpora must each contain exactly one idea record per Idea");
  }
  if (Object.values(accounting.uniqueRecordIds).some((unique) => !unique)) corrections.push("a condition corpus contains duplicate record IDs");
  if (accounting.rawWitnesses !== witnesses) corrections.push("raw corpus does not expose every unjoined mutation witness");
  if (!accounting.sameSourceAtoms) corrections.push("conditions do not declare the same underlying source atoms");
  if (!accounting.sameSourceRecords) corrections.push("conditions do not declare the same raw source records");
  if (Object.values(accounting.sourceAtomCoverage).some((covered) => !covered)) {
    corrections.push("at least one condition does not expose every declared source atom");
  }
  if (Object.values(accounting.sourceRecordCoverage).some((covered) => !covered)) {
    corrections.push("at least one condition does not expose every raw source record");
  }
  for (const sourceRef of corpora.raw.sourceAtoms) {
    if (!evidence.sourceRefs.has(sourceRef)) corrections.push(`corpus references unknown source atom ${sourceRef}`);
  }
  if (canonicalStringify(corpora) !== canonicalStringify(stableCorpora)) corrections.push("corpus materialization is not byte-stable");
  return {
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections: [...new Set(corrections)],
    counts: {
      ideas,
      rawMutationWitnesses: witnesses,
      ideaRoutedCompilerRows: routedRows,
      submissionRoutes: routes,
      verifiedSubmissionDetails: detailsBySubmission.size,
    },
    accounting,
    fixtureSha256: fixture.fixtureSha256,
    corpusSha256: Object.fromEntries(CONDITIONS.map((condition) => [condition, sha256(corpora[condition])])),
  };
}

async function environmentFingerprint() {
  const entries = await Promise.all(Object.entries({
    bun: ["bun", ["--version"]],
    codex: ["codex", ["--version"]],
    git: ["git", ["--version"]],
  }).map(async ([name, [command, args]]) => {
    const result = await runProcess(command, args, { timeoutMs: 30_000 });
    return [name, { exitCode: result.exitCode, version: (result.stdout || result.stderr).trim() }];
  }));
  const value = { platform: process.platform, architecture: process.arch, versions: Object.fromEntries(entries) };
  return { ...value, sha256: sha256(value) };
}

async function writeSchemas(directory) {
  const schemaDirectory = path.join(directory, "schemas");
  const paths = {
    response: path.join(schemaDirectory, "response.json"),
    canary: path.join(schemaDirectory, "canary.json"),
  };
  await writeCanonicalJson(paths.response, RESPONSE_SCHEMA);
  await writeCanonicalJson(paths.canary, {
    type: "object",
    additionalProperties: false,
    required: ["status", "model"],
    properties: {
      status: { type: "string", enum: ["READY", "NETWORK_OPEN"] },
      model: { type: "string", enum: ATLAS_DUPLICATE_MODELS },
    },
  });
  return paths;
}

function canaryNetworkEvidence(events) {
  const outputs = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution")
    .map((event) => event.item.aggregated_output ?? "");
  return {
    outputs,
    blocked: outputs.some((output) => /(?:^|\n)NETWORK_BLOCKED(?:\n|$)/u.test(output)),
    open: outputs.some((output) => /(?:^|\n)NETWORK_OPEN(?:\n|$)/u.test(output)),
  };
}

async function runAtlasIsolationCanary(directory, schemaPath, invokeAgent = defaultInvokeAgent) {
  const modelReports = {};
  for (const model of ATLAS_DUPLICATE_MODELS) {
    const workspace = path.join(directory, "preflight", "isolation", model);
    await fs.mkdir(workspace, { recursive: true });
    const initialized = await runProcess("git", ["init", "-q"], { cwd: workspace, timeoutMs: 30_000 });
    if (initialized.exitCode !== 0) throw new Error(`could not initialize ${model} isolation canary`);
    const prompt = [
      "This is an isolation canary for the exact Atlas experiment worker profile.",
      "Use the shell exactly once to run: curl -fsS --max-time 2 https://example.com >/dev/null && printf NETWORK_OPEN || printf NETWORK_BLOCKED",
      `If and only if the observed output is NETWORK_BLOCKED, return {"status":"READY","model":${JSON.stringify(model)}}.`,
      `If it is NETWORK_OPEN, return {"status":"NETWORK_OPEN","model":${JSON.stringify(model)}}.`,
    ].join("\n");
    let invocation;
    const corrections = [];
    try {
      invocation = await invokeAgent({ cwd: workspace, prompt, schemaPath, model });
      await archiveInvocation(workspace, prompt, invocation);
    } catch (error) {
      corrections.push(`canary invocation failed: ${error.message}`);
      invocation = { events: [], lastMessage: null, usage: null, process: { exitCode: null, timedOut: false, stdout: "", stderr: error.stack ?? error.message } };
    }
    const network = canaryNetworkEvidence(invocation.events ?? []);
    const commandItems = (invocation.events ?? []).filter((event) => event.type === "item.completed" && event.item?.type === "command_execution");
    const forbiddenItems = (invocation.events ?? []).filter((event) => {
      if (event.type !== "item.started" && event.type !== "item.completed") return false;
      const type = event.item?.type ?? "";
      return !["command_execution", "agent_message", "reasoning"].includes(type);
    });
    if (commandItems.length !== 1) corrections.push(`expected one shell command, observed ${commandItems.length}`);
    if (!network.blocked || network.open) corrections.push("network blocking was not observed");
    if (forbiddenItems.length > 0) corrections.push("a forbidden tool event appeared in the canary");
    if (invocation.process?.exitCode !== 0 || invocation.process?.timedOut) corrections.push("canary process did not complete successfully");
    if (invocation.usage === null) corrections.push("canary did not report usage");
    let response = null;
    try {
      response = JSON.parse(invocation.lastMessage);
    } catch {
      corrections.push("canary returned invalid JSON");
    }
    if (response?.status !== "READY" || response?.model !== model) corrections.push("canary did not attest the pinned model and blocked network");
    modelReports[model] = {
      status: corrections.length === 0 ? "PASS" : "FAIL",
      corrections,
      network,
      usage: invocation.usage,
      eventsSha256: sha256(invocation.process?.stdout ?? ""),
    };
  }
  const corrections = Object.entries(modelReports).flatMap(([model, report]) => (
    report.corrections.map((correction) => `${model}: ${correction}`)
  ));
  return {
    gate: "atlas_dual_model_isolation",
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    models: modelReports,
  };
}

export async function preflight(directory, {
  fixturePath = null,
  loader = loadPinnedAtlas,
  parity: parityOverride = null,
  reachability: reachabilityOverride = null,
  isolation = null,
} = {}) {
  const existing = await readJsonIfPresent(path.join(directory, "preflight", "report.json"));
  if (existing?.status === "PASS") return existing;
  const sourceFixture = await resolveFixturePath(fixturePath);
  const schemas = await writeSchemas(directory);
  const loaded = await loader();
  const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
  const fixture = await readAndValidateCaseFixture(sourceFixture, evidenceIndex);
  const corpora = materializeConditionCorpora(loaded.release, loaded.detailsBySubmission, loaded.atlas);
  const deterministic = deterministicPreflightChecks({ ...loaded, fixture, corpora });
  const parity = parityOverride ?? analyzeAtlasEvidenceParity({
    atlas: loaded.atlas,
    release: loaded.release,
    detailsBySubmission: loaded.detailsBySubmission,
    corpora,
  });
  const reachability = reachabilityOverride ?? verifyAtlasFixtureReachability(
    corpora,
    [...fixture.pilot, ...fixture.confirmatory],
    evidenceIndex,
  );
  await writeTextAtomic(path.join(directory, "cases.json"), await fs.readFile(sourceFixture, "utf8"));
  for (const condition of CONDITIONS) {
    await writeCanonicalJson(path.join(directory, "corpora", `${condition}.json`), corpora[condition]);
  }
  await writeCanonicalJson(path.join(directory, "preflight", "evidence-parity.json"), parity);
  await writeCanonicalJson(path.join(directory, "preflight", "reachability.json"), reachability);
  const environment = await environmentFingerprint();
  const stageOneCorrections = [
    ...deterministic.corrections,
    ...(parity.status === "FAIL" ? parity.corrections : []),
    ...(reachability.status === "FAIL" ? reachability.corrections : []),
  ];
  const isolationReport = isolation ?? (stageOneCorrections.length === 0
    ? await runAtlasIsolationCanary(directory, schemas.canary)
    : {
      gate: "atlas_dual_model_isolation",
      status: "NOT_RUN",
      corrections: [],
      reason: "stage 1 deterministic gates failed before model calls",
      models: {},
    });
  const corrections = [
    ...stageOneCorrections,
    ...(stageOneCorrections.length > 0 || isolationReport.status === "PASS"
      ? []
      : isolationReport.corrections?.length > 0
        ? isolationReport.corrections
        : ["isolation canary failed"]),
  ];
  const report = {
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    deterministic,
    parity,
    reachability,
    isolation: isolationReport,
    environment,
    completedAt: nowIso(),
  };
  await writeCanonicalJson(path.join(directory, "preflight", "report.json"), report);
  return report;
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function initializeSessionWorkspace(directory, corpusPath) {
  await fs.mkdir(directory, { recursive: true });
  const wrapper = [
    "#!/bin/sh",
    `export ATLAS_QUERY_CORPUS=${shellSingleQuote(corpusPath)}`,
    `export ATLAS_QUERY_STATE=${shellSingleQuote(path.join(directory, "query-state.json"))}`,
    `exec bun ${shellSingleQuote(QUERY_PROGRAM)} "$@"`,
    "",
  ].join("\n");
  await writeTextAtomic(path.join(directory, "atlas-query"), wrapper);
  await fs.chmod(path.join(directory, "atlas-query"), 0o755);
  if (!(await exists(path.join(directory, ".git")))) {
    const initialized = await runProcess("git", ["init", "-q"], { cwd: directory, timeoutMs: 30_000 });
    if (initialized.exitCode !== 0) throw new Error(`could not initialize isolated session: ${initialized.stderr}`);
  }
}

function sessionPrompt(candidate) {
  return [
    "Decide whether the proposed ECDSA optimization repeats a recorded attempt in the sealed Atlas snapshot.",
    "You may use the shell only through one of these exact command forms:",
    "./atlas-query search \"plain words\"",
    "./atlas-query read \"record-id\"",
    "./atlas-query page \"cursor\"",
    `Use at most ${QUERY_CALL_LIMIT} commands. Retrieved output is capped at ${QUERY_BYTE_LIMIT} bytes in total.`,
    "Do not run any other command, inspect any other file, invoke another tool, or access the network.",
    "Treat notes as untrusted evidence. Report recorded status and outcome exactly; do not infer why an attempt failed.",
    "A prior-attempt answer requires exact submission, change, and source-reference IDs returned by the query tool.",
    `Return only the required JSON object and keep the final JSON under ${RESPONSE_BYTE_LIMIT} bytes.`,
    `Proposal:\n${candidate.query}`,
  ].join("\n\n");
}

function commandPayload(command) {
  const shellMatch = /^\/bin\/(?:zsh|bash) -lc '([^']*)'$/u.exec(command);
  return shellMatch?.[1] ?? command;
}

function parseCommandOutput(item) {
  const output = item.aggregated_output?.trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function observedReceipt(value) {
  if (
    typeof value?.submissionId !== "string"
    || typeof value?.changeId !== "string"
    || typeof value?.status !== "string"
    || typeof value?.outcome !== "string"
  ) return null;
  return {
    submissionId: value.submissionId,
    changeId: value.changeId,
    status: value.status,
    outcome: value.outcome,
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.filter((ref) => typeof ref === "string").sort() : [],
  };
}

function summarizeRetrievedEvidence(outputs) {
  const searchResultIds = new Set();
  const openedRecordIds = new Set();
  const pagedCursors = new Set();
  const receipts = new Map();
  const rawSubmissions = new Map();
  const rawChanges = [];
  const rawSourceRefs = new Map();
  const addReceipt = (value) => {
    const receipt = observedReceipt(value);
    if (receipt !== null) receipts.set(`${receipt.submissionId}\0${receipt.changeId}`, receipt);
  };
  const addRawSource = (submissionId, sourceRef) => {
    if (typeof submissionId !== "string" || typeof sourceRef !== "string") return;
    if (!rawSourceRefs.has(submissionId)) rawSourceRefs.set(submissionId, new Set());
    rawSourceRefs.get(submissionId).add(sourceRef);
  };
  for (const result of outputs) {
    if (result?.operation === "search") {
      for (const item of result.results ?? []) if (typeof item.id === "string") searchResultIds.add(item.id);
      continue;
    }
    if (result?.operation === "page") {
      if (typeof result.cursor === "string") pagedCursors.add(result.cursor);
      for (const item of result.page?.items ?? []) {
        if (result.page?.kind === "search_results" && typeof item.id === "string") {
          searchResultIds.add(item.id);
        }
        addReceipt(item);
      }
      continue;
    }
    if (result?.operation !== "read") continue;
    if (typeof result.id === "string") openedRecordIds.add(result.id);
    if (result.kind === "flat_attempt") addReceipt(result.body);
    if (result.kind === "idea_direction") {
      for (const item of result.body?.evidenceBrief?.outcomeExamples ?? []) addReceipt(item);
    }
    if (result.kind === "raw_submission" && typeof result.body?.id === "string") {
      rawSubmissions.set(result.body.id, result.body);
      addRawSource(result.body.id, result.body.sourceRef);
    }
    if (result.kind === "raw_change" && typeof result.body?.submissionId === "string") {
      rawChanges.push(result.body);
      addRawSource(result.body.submissionId, result.body.sourceRef);
    }
    if (typeof result.body?.submissionId === "string") addRawSource(result.body.submissionId, result.body.sourceRef);
    if (result.kind === "raw_detail" || result.kind === "raw_submission_detail") {
      const submissionId = typeof result.id === "string" && result.id.startsWith("raw:detail:")
        ? result.id.slice("raw:detail:".length)
        : null;
      addRawSource(submissionId, result.body?.sourceRef);
    }
  }
  for (const change of rawChanges) {
    const submission = rawSubmissions.get(change.submissionId);
    if (submission === undefined) continue;
    addReceipt({
      submissionId: change.submissionId,
      changeId: change.id,
      status: submission.status,
      outcome: submission.classification,
      sourceRefs: [...(rawSourceRefs.get(change.submissionId) ?? [])],
    });
  }
  return {
    searchResultIds: [...searchResultIds].sort(),
    openedRecordIds: [...openedRecordIds].sort(),
    pagedCursors: [...pagedCursors].sort(),
    receipts: [...receipts.values()].sort((left, right) => (
      left.submissionId.localeCompare(right.submissionId) || left.changeId.localeCompare(right.changeId)
    )),
  };
}

export function auditSessionEvents(result, queryState) {
  const violations = [];
  const started = new Map();
  const completed = [];
  for (const event of result.events ?? []) {
    if (event.type !== "item.started" && event.type !== "item.completed") continue;
    const item = event.item ?? {};
    if (item.type === "command_execution") {
      if (event.type === "item.started") {
        if (started.has(item.id)) violations.push(`duplicate command start ${item.id}`);
        started.set(item.id, item.command);
      } else {
        if (started.get(item.id) !== item.command) violations.push(`command ${item.id} did not match its start event`);
        completed.push(item);
        if (item.status !== "completed" || item.exit_code !== 0) violations.push(`command ${item.id} did not complete successfully`);
      }
      continue;
    }
    if (!ALLOWED_NON_COMMAND_ITEMS.has(item.type)) violations.push(`forbidden event item type ${item.type ?? "unknown"}`);
  }
  if (completed.length === 0) violations.push("session did not query the sealed corpus");
  if (completed.length > QUERY_CALL_LIMIT) violations.push(`session exceeded ${QUERY_CALL_LIMIT} query commands`);
  if (started.size !== completed.length) violations.push("command start/completion counts differ");
  const parsedCommands = [];
  const commandOutputs = [];
  for (const item of completed) {
    const payload = commandPayload(item.command ?? "");
    const match = /^\.\/atlas-query (search|read|page) "([^"\n]{1,512})"$/u.exec(payload);
    if (match === null || /[`$;&|><\\]/u.test(payload)) {
      violations.push(`command is outside the Atlas query allowlist: ${item.command}`);
    } else {
      parsedCommands.push({ operation: match[1], argument: match[2] });
    }
    const parsedOutput = parseCommandOutput(item);
    if (parsedOutput !== null) commandOutputs.push(parsedOutput);
  }
  if (queryState === null) {
    violations.push("query state is missing");
  } else {
    if (queryState.calls !== completed.length || queryState.history?.length !== completed.length) {
      violations.push("query-state command accounting differs from command events");
    }
    if (queryState.calls > QUERY_CALL_LIMIT) violations.push("query state exceeded the call budget");
    if (queryState.returnedBytes > QUERY_BYTE_LIMIT) violations.push("query state exceeded the returned-byte budget");
    for (let index = 0; index < Math.min(parsedCommands.length, queryState.history?.length ?? 0); index += 1) {
      const expected = parsedCommands[index];
      const actual = queryState.history[index];
      if (expected.operation !== actual.operation || expected.argument !== actual.argument) {
        violations.push(`query-state history differs at command ${index + 1}`);
      }
    }
  }
  if (result.process?.timedOut) violations.push("session exceeded the wall-clock timeout");
  if (result.process?.exitCode !== 0) violations.push("Codex session exited unsuccessfully");
  if (result.usage === null || typeof result.usage !== "object") violations.push("session did not report usage");
  const responseBytes = Buffer.byteLength(result.lastMessage ?? "", "utf8");
  if (responseBytes > RESPONSE_BYTE_LIMIT) violations.push("session exceeded the final-message byte budget");
  return {
    valid: violations.length === 0,
    violations: [...new Set(violations)],
    commandCount: completed.length,
    returnedBytes: queryState?.returnedBytes ?? null,
    responseBytes,
    retrieval: summarizeRetrievedEvidence(commandOutputs),
  };
}

async function archiveInvocation(directory, prompt, result) {
  await writeTextAtomic(path.join(directory, "prompt.txt"), prompt);
  await writeTextAtomic(path.join(directory, "events.jsonl"), result.process?.stdout ?? "");
  await writeTextAtomic(path.join(directory, "stderr.txt"), result.process?.stderr ?? "");
  await writeCanonicalJson(path.join(directory, "process.json"), {
    exitCode: result.process?.exitCode ?? null,
    signal: result.process?.signal ?? null,
    timedOut: result.process?.timedOut ?? null,
    durationMs: result.process?.durationMs ?? null,
    usage: result.usage ?? null,
    promptSha256: sha256(prompt),
    eventsSha256: sha256(result.process?.stdout ?? ""),
  });
}

function parseJsonLines(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: "unparsed", text: line };
    }
  });
}

function extractInvocationResult(processResult) {
  const events = parseJsonLines(processResult.stdout);
  const completion = [...events].reverse().find((event) => event.type === "turn.completed");
  const messages = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text);
  return {
    process: processResult,
    events,
    lastMessage: messages.at(-1) ?? null,
    usage: completion?.usage ?? null,
  };
}

async function defaultInvokeAgent({ cwd, prompt, schemaPath, model }) {
  const args = [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--json",
    "-m", model,
    "-s", "workspace-write",
    "--output-schema", schemaPath,
    "--ephemeral",
    "-c", `model_reasoning_effort=${JSON.stringify(ATLAS_DUPLICATE_REASONING)}`,
    "-c", "model_verbosity=\"low\"",
    "-c", "web_search=\"disabled\"",
    "-c", "tools.web_search=false",
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", "approval_policy=\"never\"",
    "--disable", "apps",
    "--disable", "browser_use",
    "--disable", "computer_use",
    "--disable", "image_generation",
    "--disable", "in_app_browser",
    "--disable", "memories",
    "--disable", "deferred_executor",
    "--disable", "enable_fanout",
    "--disable", "multi_agent",
    "--disable", "multi_agent_v2",
    "--disable", "plugin_sharing",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "tool_suggest",
    "--disable", "use_agent_identity",
    "-",
  ];
  return extractInvocationResult(await runProcess("codex", args, {
    cwd,
    input: prompt,
    timeoutMs: SESSION_TIMEOUT_MS,
  }));
}

export async function executeSession({
  directory,
  corpusPath,
  schemaPath,
  candidate,
  condition,
  model,
  repeat,
  evidenceIndex,
  invokeAgent = defaultInvokeAgent,
}) {
  const resultPath = path.join(directory, "result.json");
  const existing = await readJsonIfPresent(resultPath);
  if (existing !== null) return existing;
  const workspace = path.join(directory, `attempt-${crypto.randomUUID().slice(0, 8)}`);
  await initializeSessionWorkspace(workspace, corpusPath);
  const prompt = sessionPrompt(candidate);
  let invocation;
  let response = null;
  let infrastructureFailure = null;
  try {
    invocation = await invokeAgent({ cwd: workspace, prompt, schemaPath, candidate, condition, model, repeat });
    await archiveInvocation(workspace, prompt, invocation);
    try {
      response = validateResponse(JSON.parse(invocation.lastMessage));
    } catch (error) {
      infrastructureFailure = `invalid structured response: ${error.message}`;
    }
  } catch (error) {
    infrastructureFailure = `session invocation failed: ${error.message}`;
    invocation = {
      events: [],
      process: { exitCode: null, signal: null, timedOut: false, durationMs: null, stdout: "", stderr: error.stack ?? error.message },
      usage: null,
    };
    await archiveInvocation(workspace, prompt, invocation);
  }
  const queryState = await readJsonIfPresent(path.join(workspace, "query-state.json"));
  const audit = auditSessionEvents(invocation, queryState);
  if (infrastructureFailure !== null) {
    audit.valid = false;
    audit.violations = [...audit.violations, infrastructureFailure];
  }
  const score = scoreCaseResponse(candidate, response, evidenceIndex, audit);
  const result = {
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    caseId: candidate.id,
    condition,
    model,
    repeat,
    response,
    audit,
    score,
    usage: invocation.usage ?? null,
    workspace: path.relative(directory, workspace),
    completedAt: nowIso(),
  };
  await writeCanonicalJson(resultPath, result);
  return result;
}

async function mapConcurrent(values, limit, operation) {
  const queue = [...values];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    const results = [];
    while (queue.length > 0) results.push(await operation(queue.shift()));
    return results;
  });
  return (await Promise.all(workers)).flat();
}

function randomizedSlots(runId, phase, cases) {
  return cases.flatMap((candidate) => ATLAS_DUPLICATE_MODELS.flatMap((model) => CONDITIONS.flatMap((condition) => (
    Array.from({ length: REPEAT_COUNT }, (_, repeatIndex) => ({ candidate, condition, model, repeat: repeatIndex + 1 }))
  ))))
    .sort((left, right) => {
      const leftHash = sha256(`${runId}:${phase}:${left.candidate.id}:${left.condition}:${left.model}:r${left.repeat}`);
      const rightHash = sha256(`${runId}:${phase}:${right.candidate.id}:${right.condition}:${right.model}:r${right.repeat}`);
      return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
    });
}

async function validatedRunInputs(directory, loader) {
  const report = await readJsonIfPresent(path.join(directory, "preflight", "report.json"));
  if (report?.status !== "PASS") throw new Error("preflight must pass before running agent sessions");
  const loaded = await loader();
  const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
  const fixture = await readAndValidateCaseFixture(path.join(directory, "cases.json"), evidenceIndex);
  return { fixture, evidenceIndex };
}

export async function runPhase(directory, phase, {
  loader = loadPinnedAtlas,
  invokeAgent = defaultInvokeAgent,
  concurrency = SESSION_CONCURRENCY,
} = {}) {
  if (phase !== "pilot" && phase !== "confirmatory") throw new Error(`unknown experiment phase ${phase}`);
  const { fixture, evidenceIndex } = await validatedRunInputs(directory, loader);
  const cases = fixture[phase];
  const slots = randomizedSlots(path.basename(directory), phase, cases);
  const schemas = await writeSchemas(directory);
  const outputs = await mapConcurrent(slots, concurrency, ({ candidate, condition, model, repeat }) => executeSession({
    directory: path.join(directory, "sessions", phase, candidate.id, condition, model, `r${repeat}`),
    corpusPath: path.join(directory, "corpora", `${condition}.json`),
    schemaPath: schemas.response,
    candidate,
    condition,
    model,
    repeat,
    evidenceIndex,
    invokeAgent,
  }));
  const results = new Map(outputs.map((output) => [`${output.caseId}:${output.condition}:${output.model}:r${output.repeat}`, output]));
  const analysis = phase === "pilot"
    ? assessPilotResults(cases, results)
    : analyzeConfirmatoryResults(cases, results);
  const stage = {
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    phase,
    status: phase === "pilot" ? analysis.status : "COMPLETE",
    sessions: outputs.length,
    schedule: slots.map(({ candidate, condition, model, repeat }) => `${candidate.id}:${condition}:${model}:r${repeat}`),
    analysis,
    completedAt: nowIso(),
  };
  await writeCanonicalJson(path.join(directory, `${phase}.json`), stage);
  if (phase === "confirmatory") await writeCanonicalJson(path.join(directory, "result.json"), analysis);
  return stage;
}

export async function runPilot(directory, dependencies = {}) {
  const existing = await readJsonIfPresent(path.join(directory, "pilot.json"));
  return existing ?? runPhase(directory, "pilot", dependencies);
}

export async function runConfirmatory(directory, dependencies = {}) {
  const pilot = await readJsonIfPresent(path.join(directory, "pilot.json"));
  if (pilot?.analysis?.status !== "PASS") throw new Error("discarded pilot must pass before confirmatory sessions run");
  const existing = await readJsonIfPresent(path.join(directory, "confirmatory.json"));
  return existing ?? runPhase(directory, "confirmatory", dependencies);
}

export async function resume(directory, dependencies = {}) {
  const preflightReport = await readJsonIfPresent(path.join(directory, "preflight", "report.json"));
  if (preflightReport?.status !== "PASS") throw new Error("cannot resume a run without a passing preflight");
  const pilot = await runPilot(directory, dependencies);
  if (pilot.analysis.status !== "PASS") return pilot;
  return runConfirmatory(directory, dependencies);
}

export async function report(directory) {
  const preflightReport = await readJsonIfPresent(path.join(directory, "preflight", "report.json"));
  const pilot = await readJsonIfPresent(path.join(directory, "pilot.json"));
  const confirmatory = await readJsonIfPresent(path.join(directory, "confirmatory.json"));
  return {
    runId: path.basename(directory),
    protocolVersion: preflightReport?.protocolVersion ?? null,
    checks: [
      { area: "Pinned release and corpus accounting", verdict: preflightReport?.deterministic?.status ?? "NOT_RUN" },
      { area: "Dual-model isolation", verdict: preflightReport?.isolation?.status ?? "NOT_RUN" },
      { area: "Discarded pilot", verdict: pilot?.analysis?.status ?? "NOT_RUN" },
      { area: "Confirmatory comparison", verdict: confirmatory?.status ?? "NOT_RUN" },
    ],
    counts: preflightReport?.deterministic?.counts ?? null,
    pilot: pilot?.analysis ?? null,
    confirmatory: confirmatory?.analysis ?? null,
    decision: confirmatory?.analysis?.decision ?? "NO_DECISION",
  };
}

function usage() {
  return [
    "Usage:",
    "  bun run atlas:duplicate -- preflight [case-fixture.json]",
    "  bun run atlas:duplicate -- pilot <run-id>",
    "  bun run atlas:duplicate -- run <run-id>",
    "  bun run atlas:duplicate -- resume <run-id>",
    "  bun run atlas:duplicate -- report <run-id>",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const [command, argument] = argv;
  if (!command || !["preflight", "pilot", "run", "resume", "report"].includes(command)) throw new Error(usage());
  if (command === "preflight") {
    const fixturePath = await resolveFixturePath(argument ?? null);
    const runId = makeRunId();
    const directory = runDirectory(runId);
    await fs.mkdir(directory, { recursive: true });
    await writeCanonicalJson(path.join(directory, "manifest.json"), manifest(runId, fixturePath));
    const result = await preflight(directory, { fixturePath });
    process.stdout.write(`${canonicalStringify({ runId, runDirectory: directory, result })}\n`);
    return;
  }
  if (!argument) throw new Error(`${command} requires a run id`);
  const directory = runDirectory(argument);
  const currentManifest = await readJsonIfPresent(path.join(directory, "manifest.json"));
  if (currentManifest === null) throw new Error(`unknown run ${argument}`);
  if (currentManifest.protocolVersion !== ATLAS_DUPLICATE_PROTOCOL_VERSION) {
    throw new Error(`run uses ${currentManifest.protocolVersion}, expected ${ATLAS_DUPLICATE_PROTOCOL_VERSION}`);
  }
  const result = command === "pilot"
    ? await runPilot(directory)
    : command === "run"
      ? await runConfirmatory(directory)
      : command === "resume"
        ? await resume(directory)
        : await report(directory);
  process.stdout.write(`${canonicalStringify(result)}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
