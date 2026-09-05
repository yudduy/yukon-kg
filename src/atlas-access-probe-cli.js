#!/usr/bin/env bun

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATLAS_ACCESS_CORE_ARMS,
  ATLAS_ACCESS_POINTER_ARM,
  analyzeAtlasAccessProbe,
  buildAccessMessages,
  executeAtlasAccessSession,
  pointerRecordId,
} from "./atlas-access-probe.js";
import {
  PINNED_MANIFEST_SHA256,
  PINNED_RELEASE_ID,
  buildEvidenceIndex,
  materializeConditionCorpora,
  readAndValidateCaseFixture,
} from "./atlas-duplicate-protocol.js";
import { loadPinnedAtlas } from "./atlas-duplicate-mve.js";
import { verifyAtlasFixtureReachability } from "./atlas-reachability.js";
import { canonicalStringify, sha256 } from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(ROOT, "fixtures", "atlas-duplicate-cases.json");
const MODELS = Object.freeze(["openai/gpt-5.6-sol", "moonshotai/kimi-k3"]);
const PILOT_CASE_IDS = Object.freeze([
  "pilot-positive-01",
  "pilot-positive-02",
  "pilot-positive-03",
  "confirm-positive-01",
  "confirm-positive-12",
  "confirm-positive-16",
]);

function usage() {
  return [
    "Usage:",
    "  bun run src/atlas-access-probe-cli.js preflight --output <freeze.json>",
    "  bun run src/atlas-access-probe-cli.js run --freeze <freeze.json> --output <results.json>",
    "  bun run src/atlas-access-probe-cli.js analyze --results <results.json> --output <analysis.json>",
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    options[key.slice(2)] = value;
  }
  return { command, options };
}

function readJson(target) {
  return JSON.parse(readFileSync(path.resolve(target), "utf8"));
}

function writeJsonAtomic(target, value) {
  const output = path.resolve(target);
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, output);
}

function sourceRecord(relativePath) {
  const bytes = readFileSync(path.join(ROOT, relativePath));
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function apparatus() {
  const loaded = await loadPinnedAtlas();
  const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
  const fixture = await readAndValidateCaseFixture(FIXTURE_PATH, evidenceIndex);
  const caseById = new Map([...fixture.pilot, ...fixture.confirmatory].map((candidate) => [candidate.id, candidate]));
  const cases = PILOT_CASE_IDS.map((id) => {
    const candidate = caseById.get(id);
    if (candidate === undefined) throw new Error(`frozen access case ${id} is absent`);
    if (candidate.gold.classification !== "prior_attempt") throw new Error(`access case ${id} is not positive`);
    return candidate;
  });
  const corpora = materializeConditionCorpora(loaded.release, loaded.detailsBySubmission, loaded.atlas);
  const reachability = verifyAtlasFixtureReachability(corpora, cases, evidenceIndex);
  if (reachability.status !== "PASS") throw new Error(`access cases failed reachability: ${reachability.corrections.join("; ")}`);
  const pointers = Object.fromEntries(cases.map((candidate) => [
    candidate.id,
    pointerRecordId(candidate, evidenceIndex, corpora.flat),
  ]));
  return { loaded, evidenceIndex, fixture, cases, corpora, reachability, pointers };
}

export async function buildAtlasAccessFreeze() {
  const app = await apparatus();
  const corePromptHashes = Object.fromEntries(app.cases.map((candidate) => [
    candidate.id,
    sha256(canonicalStringify(buildAccessMessages(candidate))),
  ]));
  const corpusHashes = Object.fromEntries(ATLAS_ACCESS_CORE_ARMS.map((arm) => [arm, sha256(app.corpora[arm])]));
  const sourceAtomHashes = Object.fromEntries(ATLAS_ACCESS_CORE_ARMS.map((arm) => [arm, sha256(app.corpora[arm].sourceAtoms)]));
  if (new Set(Object.values(sourceAtomHashes)).size !== 1) throw new Error("access arms do not share source atoms");
  return {
    schema: "yukon.atlas-access-probe-freeze.v1",
    createdAt: null,
    claimScope: "Positive duplicate recovery under a fixed query budget; mechanism pilot, not full-chain autoresearch efficacy.",
    source: {
      releaseId: PINNED_RELEASE_ID,
      manifestSha256: PINNED_MANIFEST_SHA256,
      fixtureSha256: app.fixture.fixtureSha256,
      sourceAtomHashes,
      corpusHashes,
      sourceFiles: [
        sourceRecord("src/atlas-access-probe.js"),
        sourceRecord("src/atlas-access-probe-cli.js"),
        sourceRecord("src/atlas-query.js"),
        sourceRecord("src/atlas-duplicate-protocol.js"),
        sourceRecord("src/openrouter.js"),
        sourceRecord("fixtures/atlas-duplicate-cases.json"),
      ],
    },
    cases: app.cases.map((candidate) => ({
      caseId: candidate.id,
      querySha256: sha256(candidate.query),
      goldSha256: sha256(candidate.gold),
      strata: candidate.strata,
      corePromptSha256: corePromptHashes[candidate.id],
      pointerRecordId: app.pointers[candidate.id],
    })),
    execution: {
      models: [...MODELS],
      coreArms: [...ATLAS_ACCESS_CORE_ARMS],
      positiveControlArm: ATLAS_ACCESS_POINTER_ARM,
      sessions: app.cases.length * MODELS.length * (ATLAS_ACCESS_CORE_ARMS.length + 1),
      concurrency: 2,
      maximumDirectSpendUsd: 20,
      maximumPerAttemptReservationUsd: 0.75,
      administrativeRetryLimit: 2,
      order: "sha256-sort-v1",
      generation: { temperature: 0, maxTokensPerTurn: 2048, reasoning: { effort: "low", exclude: false } },
      queryBudget: { calls: 12, returnedBytes: 24_576, maximumTurns: 16 },
    },
    gates: {
      pointerAccuracyPerModel: 0.9,
      minimumDistinguishingCasesPerModel: 2,
      flatMinimumWinsPerModel: 2,
      flatMaximumLossesPerModel: 0,
      fabrication: 0,
      escalation: "A passing pilot may justify a separately frozen larger access study; it cannot trigger full chains or confirmation automatically.",
    },
    preflight: {
      reachabilityStatus: app.reachability.status,
      reachabilitySha256: sha256(app.reachability),
      cases: app.reachability.readyCases,
    },
  };
}

async function verifyFreeze(freeze) {
  const rebuilt = await buildAtlasAccessFreeze();
  if (canonicalStringify(freeze) !== canonicalStringify(rebuilt)) {
    throw new Error("access-probe freeze differs from the deterministic apparatus");
  }
  return apparatus();
}

function executionOrder(freeze, app) {
  const calls = [];
  for (const model of freeze.execution.models) {
    for (const candidate of app.cases) {
      for (const arm of [...freeze.execution.coreArms, freeze.execution.positiveControlArm]) {
        calls.push({ model, candidate, arm });
      }
    }
  }
  return calls.sort((left, right) => (
    sha256(`atlas-access-v1:${left.model}:${left.candidate.id}:${left.arm}`)
      .localeCompare(sha256(`atlas-access-v1:${right.model}:${right.candidate.id}:${right.arm}`))
  ));
}

function rowKey(row) {
  return `${row.model}|${row.caseId}|${row.arm}`;
}

function spentUsd(result) {
  return result.rows.reduce((total, row) => total + row.costUsd, 0)
    + result.administrativeAttempts.reduce((total, row) => total + row.costUsd, 0);
}

async function runProbe(freezePath, outputPath) {
  const freezeBytes = readFileSync(path.resolve(freezePath), "utf8");
  const freeze = JSON.parse(freezeBytes);
  const app = await verifyFreeze(freeze);
  const freezeSha256 = sha256(freezeBytes);
  const result = existsSync(outputPath) ? readJson(outputPath) : {
    schema: "yukon.atlas-access-probe-results.v1",
    freezeSha256,
    status: "running",
    rows: [],
    administrativeAttempts: [],
    administrativeFailures: [],
  };
  if (result.freezeSha256 !== freezeSha256) throw new Error("results belong to another access freeze");
  result.administrativeAttempts ??= [];
  result.administrativeFailures ??= [];
  const completed = new Set(result.rows.map(rowKey));
  const remaining = executionOrder(freeze, app).filter((item) => !completed.has(`${item.model}|${item.candidate.id}|${item.arm}`));
  for (let offset = 0; offset < remaining.length; offset += freeze.execution.concurrency) {
    const batch = remaining.slice(offset, offset + freeze.execution.concurrency);
    const reservation = batch.length
      * freeze.execution.maximumPerAttemptReservationUsd
      * (freeze.execution.administrativeRetryLimit + 1);
    if (spentUsd(result) + reservation > freeze.execution.maximumDirectSpendUsd) {
      result.status = "spend_cap_reached";
      writeJsonAtomic(outputPath, result);
      throw new Error("access probe stopped at its direct-model spend cap");
    }
    const outcomes = await Promise.all(batch.map(async ({ model, candidate, arm }) => {
      const corpusArm = arm === ATLAS_ACCESS_POINTER_ARM ? "flat" : arm;
      let session;
      const administrativeAttempts = [];
      for (let attempt = 1; attempt <= freeze.execution.administrativeRetryLimit + 1; attempt += 1) {
        session = await executeAtlasAccessSession({
          candidate,
          corpus: app.corpora[corpusArm],
          evidenceIndex: app.evidenceIndex,
          model,
          pointerRecordId: arm === ATLAS_ACCESS_POINTER_ARM ? app.pointers[candidate.id] : null,
          maxTurns: freeze.execution.queryBudget.maximumTurns,
          maxTokens: freeze.execution.generation.maxTokensPerTurn,
          reasoning: freeze.execution.generation.reasoning,
        });
        if (session.administrativeFailure === null) break;
        administrativeAttempts.push({
          key: `${model}|${candidate.id}|${arm}`,
          attempt,
          failure: session.administrativeFailure,
          costUsd: session.costUsd,
          responseIds: session.responseIds,
        });
      }
      if (session.administrativeFailure !== null) {
        return {
          administrativeAttempts,
          failure: {
            key: `${model}|${candidate.id}|${arm}`,
            failure: session.administrativeFailure,
          },
          row: null,
        };
      }
      return { administrativeAttempts, failure: null, row: {
        key: `${model}|${candidate.id}|${arm}`,
        model,
        caseId: candidate.id,
        arm,
        strata: candidate.strata,
        corpusSha256: freeze.source.corpusHashes[corpusArm],
        promptSha256: sha256(canonicalStringify(buildAccessMessages(candidate, {
          pointerRecordId: arm === ATLAS_ACCESS_POINTER_ARM ? app.pointers[candidate.id] : null,
        }))),
        ...session,
      } };
    }));
    result.administrativeAttempts.push(...outcomes.flatMap((outcome) => outcome.administrativeAttempts));
    result.rows.push(...outcomes.flatMap((outcome) => (outcome.row === null ? [] : [outcome.row])));
    const failures = outcomes.flatMap((outcome) => (outcome.failure === null ? [] : [outcome.failure]));
    result.administrativeFailures.push(...failures);
    writeJsonAtomic(outputPath, result);
    if (failures.length > 0) {
      result.status = "administrative_failure";
      writeJsonAtomic(outputPath, result);
      throw new Error(`administrative retries exhausted for ${failures.map((failure) => failure.key).join(", ")}`);
    }
  }
  result.status = "complete";
  result.analysis = analyzeAtlasAccessProbe(result.rows, { models: freeze.execution.models, caseCount: freeze.cases.length });
  writeJsonAtomic(outputPath, result);
  return result;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "preflight") {
    if (!options.output) throw new Error(usage());
    const freeze = await buildAtlasAccessFreeze();
    writeJsonAtomic(options.output, freeze);
    process.stdout.write(`${canonicalStringify({ output: path.resolve(options.output), freezeSha256: sha256(`${JSON.stringify(freeze, null, 2)}\n`) })}\n`);
    return;
  }
  if (command === "run") {
    if (!options.freeze || !options.output) throw new Error(usage());
    const result = await runProbe(options.freeze, options.output);
    process.stdout.write(`${canonicalStringify({ status: result.status, rows: result.rows.length, analysis: result.analysis })}\n`);
    return;
  }
  if (command === "analyze") {
    if (!options.results || !options.output) throw new Error(usage());
    const result = readJson(options.results);
    const analysis = analyzeAtlasAccessProbe(result.rows, { models: MODELS, caseCount: PILOT_CASE_IDS.length });
    writeJsonAtomic(options.output, analysis);
    process.stdout.write(`${canonicalStringify({ output: path.resolve(options.output) })}\n`);
    return;
  }
  throw new Error(usage());
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
