#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadIndexedAtlasRelease } from "./atlas-local.js";
import {
  buildEcdsaWorkingKnowledgeBrief,
  ideasFromRelease,
} from "./atlas-runtime/index.ts";
import { verifyPublicData } from "./verify-public-data.js";
import { chat, OpenRouterError, pinnedOpenRouterModel } from "./openrouter.js";
import { cloneDungeness, inspectDungenessCheckout, readDungenessPin } from "./dungeness-clone.js";
import {
  ARMS,
  CONTEXT_BYTE_LIMIT,
  DUNGENESS_KB_PROTOCOL_VERSION,
  DUNGENESS_KB_SCHEMA,
  PILOT_CASES,
  PINNED_OPENROUTER_MODEL,
  RESPONSE_FORMAT,
  analyzeReachability,
  compileKnowledgeVariants,
  parseModelAnswer,
  scoreAnswer,
  scorePilot,
  sha256,
  systemPrompt,
  userPrompt,
} from "./dungeness-kb-protocol.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_ROOT = join(ROOT, ".runs", "dungeness-kb");
const EVIDENCE_DIR = join(ROOT, "evidence", "dungeness-kb");

function nowIso() {
  return new Date().toISOString();
}

function makeRunId() {
  return `${nowIso().replace(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadCourtInputs() {
  const loaded = await loadIndexedAtlasRelease("default");
  const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
  const ideas = ideasFromRelease(loaded.release);
  const submissions = loaded.release.submissions.submissions;
  const variants = compileKnowledgeVariants(brief, ideas, submissions);
  return { loaded, brief, ideas, submissions, variants };
}

export async function runPreflight() {
  const atlas = await verifyPublicData();
  const { loaded, brief, variants } = await loadCourtInputs();
  const reachability = analyzeReachability(variants);
  const dungeness = await inspectDungenessCheckout();
  const pin = await readDungenessPin();
  let openrouter = { ok: false };
  try {
    const smoke = await chat({
      messages: [{ role: "user", content: "Reply with exactly: yukon-kg is connected" }],
      model: pinnedOpenRouterModel(),
    });
    openrouter = { ok: true, model: smoke.model, id: smoke.id };
  } catch (error) {
    openrouter = {
      ok: false,
      error: error instanceof OpenRouterError ? error.message : String(error),
    };
  }
  const variantReport = Object.fromEntries(ARMS.map((arm) => [arm, {
    sha256: variants[arm].sha256,
    bytes: variants[arm].bytes,
    truncated: variants[arm].truncated,
    hasDoNow: variants[arm].text.includes("\"doNow\""),
  }]));
  const stateReachable = reachability.every((row) => row.perArm.state_brief);
  const noDoNow = ARMS.every((arm) => !variantReport[arm].hasDoNow);
  const ok = atlas.status === "PASS"
    && stateReachable
    && noDoNow
    && ARMS.every((arm) => variants[arm].bytes <= CONTEXT_BYTE_LIMIT)
    && openrouter.ok;
  return {
    schema: DUNGENESS_KB_SCHEMA,
    protocolVersion: DUNGENESS_KB_PROTOCOL_VERSION,
    status: ok ? "PASS" : "FAIL",
    model: pinnedOpenRouterModel(),
    pinnedModel: PINNED_OPENROUTER_MODEL,
    releaseId: loaded.release.pointer.id,
    briefSha256: sha256(brief),
    atlas,
    variants: variantReport,
    reachability,
    dungeness: { ...dungeness, pin },
    openrouter,
    checks: {
      atlasPass: atlas.status === "PASS",
      stateBriefReachable: stateReachable,
      noDoNow,
      openrouter: openrouter.ok,
      dungenessPresent: dungeness.present,
    },
  };
}

async function chatWithRetry(options, { attempts = 4 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await chat(options);
    } catch (error) {
      lastError = error;
      const status = error instanceof OpenRouterError ? error.status : null;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

function reportNotes(results, summary) {
  const notes = [];
  if (summary.missed.includes("next-untried")) {
    const answer = results.find((row) => row.caseId === "next-untried" && row.arm === "state_brief")?.answer;
    notes.push(
      `next-untried gold is Barrett reciprocal reduction; state_brief answered ${JSON.stringify(answer ?? "unknown")}. That cut is also listed untried_in_atlas. A holistic packet names several untried discriminators without ranking them.`,
    );
  }
  return notes;
}

export async function runPilot({ runId = makeRunId() } = {}) {
  const preflight = await runPreflight();
  if (preflight.status !== "PASS") {
    throw new Error(`preflight failed: ${JSON.stringify(preflight.checks)}`);
  }
  const { variants } = await loadCourtInputs();
  const runDir = join(RUNS_ROOT, runId);
  await mkdir(runDir, { recursive: true });
  const results = [];
  for (const userCase of PILOT_CASES) {
    for (const arm of ARMS) {
      const completion = await chatWithRetry({
        model: pinnedOpenRouterModel(),
        responseFormat: RESPONSE_FORMAT,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: userPrompt(variants[arm].text, userCase) },
        ],
      });
      const parsed = parseModelAnswer(completion.content);
      const pass = scoreAnswer(parsed.answer, userCase);
      const row = {
        caseId: userCase.id,
        arm,
        answer: parsed.answer,
        rationale: parsed.rationale,
        pass,
        model: completion.model,
        usage: completion.usage,
        completionId: completion.id,
      };
      results.push(row);
      await writeJson(join(runDir, `${userCase.id}.${arm}.json`), row);
    }
  }
  const summary = scorePilot(results);
  const report = {
    schema: DUNGENESS_KB_SCHEMA,
    protocolVersion: DUNGENESS_KB_PROTOCOL_VERSION,
    runId,
    createdAt: nowIso(),
    model: pinnedOpenRouterModel(),
    releaseId: preflight.releaseId,
    dungeness: preflight.dungeness,
    ...summary,
    notes: reportNotes(results, summary),
    results,
  };
  await writeJson(join(runDir, "report.json"), report);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeJson(join(EVIDENCE_DIR, "report.json"), report);
  await writeJson(join(EVIDENCE_DIR, "preflight.json"), preflight);
  return report;
}

export async function bindDungeness() {
  const cloned = await cloneDungeness();
  const inspection = cloned.present === false && cloned.status !== "cloned"
    ? cloned
    : await inspectDungenessCheckout();
  const bind = {
    schema: "yukon-kg.dungeness-bind.v1",
    protocolVersion: DUNGENESS_KB_PROTOCOL_VERSION,
    ...cloned,
    inspection,
    policy: {
      mutateHarness: false,
      outerCourtEditableByProposer: false,
      knowledgeIsContextOnly: true,
    },
  };
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeJson(join(EVIDENCE_DIR, "dungeness-bind.json"), bind);
  return bind;
}

export async function rescorePilot() {
  const { readFile } = await import("node:fs/promises");
  const existing = JSON.parse(await readFile(join(EVIDENCE_DIR, "report.json"), "utf8"));
  const summary = scorePilot(existing.results);
  const report = {
    ...existing,
    ...summary,
    notes: reportNotes(existing.results, summary),
    rescoredAt: nowIso(),
  };
  await writeJson(join(EVIDENCE_DIR, "report.json"), report);
  return report;
}

const command = process.argv[2] ?? "preflight";

if (import.meta.main) {
  const run = command === "pilot"
    ? runPilot()
    : command === "bind" || command === "clone"
      ? bindDungeness()
      : command === "rescore"
        ? rescorePilot()
        : command === "report"
        ? (async () => {
          const { readFile } = await import("node:fs/promises");
          return JSON.parse(await readFile(join(EVIDENCE_DIR, "report.json"), "utf8"));
        })()
        : runPreflight();
  run.then(
    async (value) => {
      if (command === "preflight") {
        await mkdir(EVIDENCE_DIR, { recursive: true });
        await writeJson(join(EVIDENCE_DIR, "preflight.json"), value);
      }
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      if (value?.status === "FAIL") process.exitCode = 1;
    },
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}
