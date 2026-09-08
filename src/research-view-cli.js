#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TOKEN_LIMITS,
  adaptDungenessTrustedExport,
  appendDungenessEvents,
  buildEcdsaVerificationPlan,
  canonicalStringify,
  compileDungenessCampaign,
  compileDungenessEvents,
  compileResearchViews,
  loadCompiledResearchView,
  loadDatedEcdsaCalibrationCohort,
  sha256,
  writeResearchViews,
} from "./research-view.js";

const KG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(KG_ROOT, "..");
const EVAL_ROOT = path.join(WORKSPACE_ROOT, "eval");
const DEFAULT_CHAIN_OUTPUT = path.join(EVAL_ROOT, "research-views");

const HELP = `Usage:
  bun run research:view -- calibration [--cutoff ISO] [--output DIR] [--namespace users/bx]
  bun run research:view -- calibration-plan --selection JSON --output JSON
  bun run research:view -- dungeness --export JSON [--output DIR] [--namespace users/bx]
  bun run research:view -- dungeness-campaign --manifest JSON [--output DIR] [--namespace users/bx]
  bun run research:view -- append-dungeness --history MANIFEST --export JSON [--output DIR] [--namespace users/bx]

calibration compiles and validates the 54 dated ECDSA Atlas events. Without
--output it is a read-only preflight. calibration-plan binds authored history
windows to the sealed cohort for Dungeness clean verification. dungeness compiles a first history from a
trusted export. dungeness-campaign compiles an ordered, hashed set of no-view
producer exports, including zero-event sessions. append-dungeness verifies a prior content-addressed view and
appends the next export. Both write under eval/research-views by default.

Create trusted input with Dungeness (the export must remain inside eval/):
  cd ../eval
  ./dungeness candidate export RUN_ID 0001 0002 --output research-event-exports/RUN_ID.json

Input schema is dungeness.trusted-research-events.v1 with top-level keys
schema, run, selection, task, checkpoint, seed, environment, harness, and
events. The compiler requires the sealed exact diff, content hashes, change
inventory, development measurement, cost, timing, budget, provenance, and
execution fields emitted by that command; it performs no model calls.

Optional limits: --total-limit N (default 32000), --index-limit N (default 4000).
Use --checkpoint REF to add an optional host-only checkpoint relation.
`;

function parseArgs(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { command: "help", options: {} };
  const command = argv[0] ?? "calibration";
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") return { command: "help", options: {} };
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} requires a value`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function tokenLimits(options) {
  const read = (key, fallback) => {
    if (options[key] === undefined) return fallback;
    const value = Number.parseInt(options[key], 10);
    if (!Number.isInteger(value) || value < 1 || String(value) !== options[key]) {
      throw new Error(`--${key} must be a positive base-10 integer`);
    }
    return value;
  };
  return {
    total: read("total-limit", DEFAULT_TOKEN_LIMITS.total),
    index: read("index-limit", DEFAULT_TOKEN_LIMITS.index),
  };
}

function reportFor(compilation, extra = {}) {
  return {
    status: "PASS",
    ...extra,
    atomSetSha256: compilation.atomSetSha256,
    views: Object.fromEntries(Object.entries(compilation.views).map(([representation, view]) => [
      representation,
      {
        payloadTreeSha256: view.tree.sha256,
        atomsSha256: sha256(view.atomsBytes),
        bytes: view.tree.bytes,
        tokens: view.audit.observedTokens,
      },
    ])),
  };
}

async function calibration(options) {
  const cohort = await loadDatedEcdsaCalibrationCohort({
    ...(options.cutoff === undefined ? { expectedCount: 54 } : { cutoff: options.cutoff }),
  });
  const compilation = compileResearchViews({
    events: cohort.events,
    sourceSets: cohort.sourceSets,
    target: cohort.target,
    cutoff: cohort.cutoff,
    cutoffSealSha256: cohort.cutoffSealSha256,
    limits: tokenLimits(options),
  });
  const written = options.output === undefined ? [] : await writeResearchViews(compilation, options.output, {
    namespace: options.namespace ?? "users/bx",
    checkpoint: options.checkpoint ?? null,
  });
  return reportFor(compilation, {
    mode: options.output === undefined ? "preflight" : "compile",
    source: {
      releaseId: cohort.releaseId,
      manifestSha256: cohort.manifestSha256,
      cutoff: cohort.cutoff,
      cutoffSealSha256: cohort.cutoffSealSha256,
      eventCount: cohort.events.length,
      selection: cohort.selection,
    },
    written,
  });
}

async function calibrationPlan(options) {
  if (options.selection === undefined) throw new Error("calibration-plan requires --selection JSON");
  if (options.output === undefined) throw new Error("calibration-plan requires --output JSON");
  const selectionPath = path.resolve(options.selection);
  const selectionBytes = await fs.readFile(selectionPath);
  const selection = JSON.parse(selectionBytes.toString("utf8"));
  const cohort = await loadDatedEcdsaCalibrationCohort({ expectedCount: 54 });
  const plan = buildEcdsaVerificationPlan(cohort, selection);
  const bytes = Buffer.from(`${canonicalStringify(plan)}\n`, "utf8");
  const output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, bytes, { flag: "wx", mode: 0o444 });
  return {
    status: "PASS",
    mode: "calibration-plan",
    selectionSha256: sha256(selectionBytes),
    planSha256: sha256(bytes),
    eventCount: plan.events.length,
    windowCount: plan.windows.length,
    output,
  };
}

function relativeEvalSource(exportPath) {
  const relative = path.relative(EVAL_ROOT, exportPath).replaceAll("\\", "/");
  if (relative === "" || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("trusted Dungeness export must be inside eval/ so its provenance path is sealed");
  }
  return relative;
}

async function appendDungeness(options) {
  if (options.history === undefined) throw new Error("append-dungeness requires --history MANIFEST");
  if (options.export === undefined) throw new Error("append-dungeness requires --export JSON");
  const history = await loadCompiledResearchView(options.history);
  const exportPath = path.resolve(options.export);
  const exportBytes = await fs.readFile(exportPath);
  const sourceSha256 = sha256(exportBytes);
  const exported = JSON.parse(exportBytes.toString("utf8"));
  const adapted = adaptDungenessTrustedExport(exported, {
    sourcePath: relativeEvalSource(exportPath),
    sourceSha256,
  });
  const compilation = appendDungenessEvents(history.payload, adapted, { limits: tokenLimits(options) });
  const output = path.resolve(options.output ?? DEFAULT_CHAIN_OUTPUT);
  const written = await writeResearchViews(compilation, output, {
    namespace: options.namespace ?? "users/bx",
    checkpoint: options.checkpoint ?? adapted.checkpoint,
    parentResearchView: `research-view:${history.manifest.namespace}/${history.manifest.id}`,
  });
  return reportFor(compilation, {
    mode: "append-dungeness",
    parentManifestSha256: history.manifestSha256,
    exportSha256: sourceSha256,
    appendedEventCount: adapted.events.length,
    output,
    written,
  });
}

async function compileDungeness(options) {
  if (options.export === undefined) throw new Error("dungeness requires --export JSON");
  const exportPath = path.resolve(options.export);
  const exportBytes = await fs.readFile(exportPath);
  const sourceSha256 = sha256(exportBytes);
  const adapted = adaptDungenessTrustedExport(JSON.parse(exportBytes.toString("utf8")), {
    sourcePath: relativeEvalSource(exportPath),
    sourceSha256,
  });
  const compilation = compileDungenessEvents(adapted, { limits: tokenLimits(options) });
  const output = path.resolve(options.output ?? DEFAULT_CHAIN_OUTPUT);
  const written = await writeResearchViews(compilation, output, {
    namespace: options.namespace ?? "users/bx",
    checkpoint: options.checkpoint ?? adapted.checkpoint,
  });
  return reportFor(compilation, {
    mode: "dungeness",
    exportSha256: sourceSha256,
    eventCount: adapted.events.length,
    output,
    written,
  });
}

async function compileDungenessCampaignManifest(options) {
  if (options.manifest === undefined) throw new Error("dungeness-campaign requires --manifest JSON");
  const manifestPath = path.resolve(options.manifest);
  const manifestBytes = await fs.readFile(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest === null
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || canonicalStringify(Object.keys(manifest).sort()) !== canonicalStringify(["campaign_id", "exports", "schema"])
    || manifest.schema !== "dungeness.trusted-research-campaign.v1"
    || typeof manifest.campaign_id !== "string"
    || manifest.campaign_id.length === 0
    || !Array.isArray(manifest.exports)
    || manifest.exports.length === 0
  ) throw new Error("invalid Dungeness campaign manifest");
  const adaptedExports = [];
  for (const [index, entry] of manifest.exports.entries()) {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || canonicalStringify(Object.keys(entry).sort()) !== canonicalStringify(["path", "run_id", "session", "sha256"])
      || entry.session !== index + 1
      || typeof entry.run_id !== "string"
      || entry.run_id.length === 0
      || typeof entry.path !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) throw new Error(`invalid Dungeness campaign export[${index}]`);
    const exportPath = path.resolve(EVAL_ROOT, entry.path);
    const exportBytes = await fs.readFile(exportPath);
    const exportSha256 = sha256(exportBytes);
    if (exportSha256 !== entry.sha256) {
      throw new Error(`Dungeness campaign export[${index}] hash changed`);
    }
    const exported = JSON.parse(exportBytes.toString("utf8"));
    if (exported?.run?.id !== entry.run_id) {
      throw new Error(`Dungeness campaign export[${index}] run identity changed`);
    }
    adaptedExports.push(adaptDungenessTrustedExport(exported, {
      sourcePath: relativeEvalSource(exportPath),
      sourceSha256: exportSha256,
      exportId: `${manifest.campaign_id}:s${String(entry.session).padStart(2, "0")}:${exportSha256}`,
    }));
  }
  const compilation = compileDungenessCampaign(adaptedExports, {
    campaignManifestSha256: manifestSha256,
    limits: tokenLimits(options),
  });
  const output = path.resolve(options.output ?? DEFAULT_CHAIN_OUTPUT);
  const written = await writeResearchViews(compilation, output, {
    namespace: options.namespace ?? "users/bx",
    checkpoint: options.checkpoint ?? adaptedExports[0].checkpoint,
  });
  return reportFor(compilation, {
    mode: "dungeness-campaign",
    campaignManifestSha256: manifestSha256,
    exportSha256: adaptedExports.map((adapted) => adapted.sourceSha256),
    sessionCount: adaptedExports.length,
    eventCount: adaptedExports.reduce((total, adapted) => total + adapted.events.length, 0),
    output,
    written,
  });
}

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "calibration") {
    process.stdout.write(`${canonicalStringify(await calibration(options))}\n`);
    return;
  }
  if (command === "calibration-plan") {
    process.stdout.write(`${canonicalStringify(await calibrationPlan(options))}\n`);
    return;
  }
  if (command === "dungeness") {
    process.stdout.write(`${canonicalStringify(await compileDungeness(options))}\n`);
    return;
  }
  if (command === "dungeness-campaign") {
    process.stdout.write(`${canonicalStringify(await compileDungenessCampaignManifest(options))}\n`);
    return;
  }
  if (command === "append-dungeness") {
    process.stdout.write(`${canonicalStringify(await appendDungeness(options))}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}\n\n${HELP}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
