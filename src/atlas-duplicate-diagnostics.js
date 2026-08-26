#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalStringify, sha256 } from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RUNS_ROOT = path.join(ROOT, ".runs", "atlas-duplicate");
const DIAGNOSTIC_SCHEMA = "yukon.atlas-duplicate-diagnostic";
const DIAGNOSTIC_SCHEMA_VERSION = 1;
const FAILURE_STAGES = ["discovery", "drill_down", "evidence", "decision", "output", "none"];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function commandPayload(command) {
  const shellMatch = /^\/bin\/(?:zsh|bash) -lc '([^']*)'$/u.exec(command);
  return shellMatch?.[1] ?? command;
}

function arraysEqual(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeCanonicalJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${canonicalStringify(value)}\n`);
  await fs.rename(temporary, target);
}

async function readEventsJsonl(target) {
  const lines = (await fs.readFile(target, "utf8")).trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function parseAtlasQueryOutput(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function parseCommand(item) {
  const payload = commandPayload(item.command ?? "");
  const match = /^\.\/atlas-query (search|read|page) "([^"\n]{1,512})"$/u.exec(payload);
  if (match === null) return null;
  return { operation: match[1], argument: match[2] };
}

function mapCaseById(fixture) {
  return new Map([...fixture.pilot, ...fixture.confirmatory].map((candidate) => [candidate.id, candidate]));
}

function rawSourceRefMap(corpus) {
  const mapping = new Map();
  for (const record of corpus.records ?? []) {
    const sourceRef = record?.body?.sourceRef;
    if (typeof sourceRef === "string") mapping.set(sourceRef, record.id);
  }
  return mapping;
}

function briefIdeaRecordIds(corpus, ideaIds) {
  const ids = [];
  for (const ideaId of ideaIds) {
    const recordId = `brief:${ideaId}`;
    if (corpus.records.some((record) => record.id === recordId)) ids.push(recordId);
  }
  return ids;
}

function rawIdeaAnchorIds(corpus, ideaIds) {
  const ids = [];
  for (const ideaId of ideaIds) {
    for (const recordId of [`raw:idea:${ideaId}`, `raw:dossier:${ideaId}`]) {
      if (corpus.records.some((record) => record.id === recordId)) ids.push(recordId);
    }
  }
  return ids;
}

function flatAttemptTargetIds(corpus, candidate) {
  const keys = new Set(candidate.gold.acceptableMatches.map((match) => `${match.submissionId}\0${match.changeId}`));
  return corpus.records
    .filter((record) => record.kind === "flat_attempt")
    .filter((record) => candidate.gold.ideaIds.includes(record.body.ideaId))
    .filter((record) => keys.has(`${record.body.submissionId}\0${record.body.changeId}`))
    .map((record) => record.id)
    .sort(compareText);
}

function flatIdeaAnchorIds(corpus, candidate) {
  return corpus.records
    .filter((record) => record.kind === "flat_attempt")
    .filter((record) => candidate.gold.ideaIds.includes(record.body.ideaId))
    .map((record) => record.id)
    .sort(compareText);
}

function targetIdsForSession(corpora, candidate, condition) {
  const corpus = corpora[condition];
  const rawMap = rawSourceRefMap(corpora.raw);
  const exactRawIds = candidate.gold.acceptableMatches
    .flatMap((match) => match.sourceRefs.map((sourceRef) => rawMap.get(sourceRef)))
    .filter((value) => value !== undefined)
    .sort(compareText);
  const ideaAnchors = [
    ...briefIdeaRecordIds(corpus, candidate.gold.ideaIds),
    ...rawIdeaAnchorIds(corpus, candidate.gold.ideaIds),
  ];
  const exactFlatIds = condition === "flat" ? flatAttemptTargetIds(corpus, candidate) : [];
  const flatAnchors = condition === "flat" ? flatIdeaAnchorIds(corpus, candidate) : [];
  const exact = [...new Set([...exactRawIds, ...exactFlatIds])].sort(compareText);
  const anchors = [...new Set([...ideaAnchors, ...flatAnchors])].sort(compareText);
  return {
    exact,
    anchors,
    discovery: [...new Set([...exact, ...anchors])].sort(compareText),
  };
}

function extractSearchSessions(events) {
  const commands = [];
  for (const event of events) {
    if (event.type !== "item.completed" || event.item?.type !== "command_execution") continue;
    const parsed = parseCommand(event.item);
    if (parsed === null) continue;
    commands.push({
      operation: parsed.operation,
      argument: parsed.argument,
      output: parseAtlasQueryOutput(event.item.aggregated_output ?? ""),
      exitCode: event.item.exit_code,
    });
  }
  return commands;
}

function openedRefs(commands) {
  return commands
    .filter((command) => command.operation === "read" || command.operation === "page")
    .map((command) => command.argument);
}

function successfulSearchHit(commands, targetIds) {
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const command = commands[commandIndex];
    if (command.operation !== "search" || !Array.isArray(command.output?.results)) continue;
    for (let resultIndex = 0; resultIndex < command.output.results.length; resultIndex += 1) {
      const result = command.output.results[resultIndex];
      if (targetIds.has(result.id)) {
        return {
          commandCall: commandIndex + 1,
          searchRank: resultIndex + 1,
          recordId: result.id,
          query: command.argument,
        };
      }
    }
  }
  return null;
}

function pageHelpfulness(commands, exactTargetIds) {
  for (const command of commands) {
    if (command.operation !== "page" || !Array.isArray(command.output?.page?.items)) continue;
    const helpful = command.output.page.items.some((item) => {
      if (typeof item?.submissionId !== "string" || typeof item?.changeId !== "string") return false;
      return exactTargetIds.has(`attempt:${item.submissionId}:${item.changeId}:${item.ideaId}`);
    });
    if (helpful) return command.argument;
  }
  return null;
}

function helpfulOpenRef(commands, targets) {
  const opened = openedRefs(commands);
  const helpful = opened.find((ref) => targets.discovery.includes(ref));
  if (helpful !== undefined) return helpful;
  const helpfulPage = pageHelpfulness(commands, new Set(targets.exact));
  return helpfulPage;
}

function nonAuditFailures(result) {
  const auditFailures = new Set(result.audit?.violations ?? []);
  return (result.score?.failures ?? []).filter((failure) => !auditFailures.has(failure));
}

function matchFieldFailures(candidate, response) {
  const failures = new Set();
  const acceptable = new Map(candidate.gold.acceptableMatches.map((match) => [`${match.submissionId}\0${match.changeId}`, match]));
  for (const match of response?.matches ?? []) {
    const key = `${match.submissionId}\0${match.changeId}`;
    const expected = acceptable.get(key);
    if (expected === undefined) {
      failures.add("matches.submissionId");
      failures.add("matches.changeId");
      continue;
    }
    if (expected.status !== match.status) failures.add("matches.status");
    if (expected.outcome !== match.outcome) failures.add("matches.outcome");
    const subset = match.sourceRefs.every((sourceRef) => expected.sourceRefs.includes(sourceRef));
    if (!subset) failures.add("matches.sourceRefs");
  }
  if (candidate.gold.classification === "prior_attempt" && (response?.matches?.length ?? 0) === 0) failures.add("matches");
  if (candidate.gold.classification === "no_prior_attempt" && (response?.matches?.length ?? 0) > 0) failures.add("matches");
  return [...failures].sort(compareText);
}

function requiredFields(candidate, result) {
  const response = result.response ?? null;
  const fields = new Set();
  for (const failure of nonAuditFailures(result)) {
    if (failure === "classification differs from gold") fields.add("classification");
    else if (failure === "decision differs from gold") fields.add("decision");
    else if (failure === "positive case returned no gold Idea" || failure === "response contains an Idea outside the acceptable gold set") fields.add("ideaIds");
    else if (failure === "positive case returned no match" || failure === "negative case returned a match") fields.add("matches");
    else if (failure === "response contains a fabricated ID or source reference") {
      if ((response?.ideaIds ?? []).some((ideaId) => !candidate.gold.ideaIds.includes(ideaId))) fields.add("ideaIds");
      if ((response?.matches?.length ?? 0) > 0) {
        const matchFields = matchFieldFailures(candidate, response);
        if (matchFields.length === 0) fields.add("matches.sourceRefs");
        for (const field of matchFields) fields.add(field);
      }
    } else if (failure.startsWith("match ")) {
      for (const field of matchFieldFailures(candidate, response)) fields.add(field);
    }
  }
  if ((result.audit?.violations ?? []).some((failure) => failure.includes("answer-token budget"))) fields.add("answerTokens");
  if ((result.audit?.violations ?? []).some((failure) => failure.includes("8 query commands") || failure.includes("call budget"))) fields.add("queryCalls");
  return [...fields].sort(compareText);
}

function decideFirstFailure(candidate, result, targets, commands) {
  if (result.score?.pass) return "none";
  const semanticFailures = nonAuditFailures(result);
  if (semanticFailures.length === 0) return "output";
  const hit = successfulSearchHit(commands, new Set(targets.discovery));
  if (hit === null) return "discovery";
  if (helpfulOpenRef(commands, targets) == null) return "drill_down";
  const decisionOnly = semanticFailures.every((failure) => (
    failure === "classification differs from gold" || failure === "decision differs from gold"
  ));
  return decisionOnly ? "decision" : "evidence";
}

function scoringReason(candidate, result, firstFailure) {
  if (firstFailure === "output") return truncate((result.audit?.violations ?? result.score?.failures ?? []).join("; "), 160);
  if (firstFailure === "decision") {
    const failures = nonAuditFailures(result).filter((failure) => failure === "classification differs from gold" || failure === "decision differs from gold");
    return truncate(failures.join("; "), 160);
  }
  if (firstFailure === "evidence") {
    return truncate(nonAuditFailures(result).join("; "), 160);
  }
  if (firstFailure === "drill_down") return "relevant record surfaced in search but was not opened";
  if (firstFailure === "discovery") return "no relevant target surfaced in search results";
  return "passed";
}

function finalAnswerBytes(result) {
  const response = result.response ?? {};
  return Buffer.byteLength(`${canonicalStringify(response)}\n`);
}

function conditionTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const current = totals.get(row.condition) ?? { sessions: 0, passed: 0 };
    current.sessions += 1;
    current.passed += Number(row.pass);
    totals.set(row.condition, current);
  }
  return Object.fromEntries([...totals.entries()].sort(([left], [right]) => compareText(left, right)));
}

function stageTotals(rows) {
  const totals = new Map(FAILURE_STAGES.map((stage) => [stage, 0]));
  for (const row of rows) totals.set(row.firstFailure, (totals.get(row.firstFailure) ?? 0) + 1);
  return Object.fromEntries([...totals.entries()]);
}

export function renderAtlasDuplicateDiagnosticTable(diagnostic) {
  const rows = diagnostic.rows;
  const lines = [
    "case              cond  pass  first_failure  hit      opened  calls  bytes  answerB  reason",
    "----------------  ----  ----  -------------  -------  ------  -----  -----  -------  ------------------------------",
  ];
  for (const row of rows) {
    const hit = row.searchHit === null ? "-" : `c${row.searchHit.commandCall}#${row.searchHit.searchRank}`;
    lines.push([
      row.caseId.padEnd(16),
      row.condition.padEnd(4),
      String(row.pass).padEnd(4),
      row.firstFailure.padEnd(13),
      hit.padEnd(7),
      String(row.openedRefs.length).padEnd(6),
      String(row.calls).padEnd(5),
      String(row.retrievedBytes).padEnd(5),
      String(row.finalAnswerBytes).padEnd(7),
      truncate(row.scoringReason, 30),
    ].join("  "));
  }
  return lines.join("\n");
}

function resolveRunDirectory(value) {
  if (path.isAbsolute(value)) return value;
  return path.join(DEFAULT_RUNS_ROOT, value);
}

export async function analyzeAtlasDuplicatePilotRun(runDirectoryInput) {
  const runDirectory = resolveRunDirectory(runDirectoryInput);
  const [manifest, fixture, pilot, corporaRaw, corporaFlat, corporaBrief] = await Promise.all([
    readJson(path.join(runDirectory, "manifest.json")),
    readJson(path.join(runDirectory, "cases.json")),
    readJson(path.join(runDirectory, "pilot.json")),
    readJson(path.join(runDirectory, "corpora", "raw.json")),
    readJson(path.join(runDirectory, "corpora", "flat.json")),
    readJson(path.join(runDirectory, "corpora", "brief.json")),
  ]);
  const caseById = mapCaseById(fixture);
  const corpora = { raw: corporaRaw, flat: corporaFlat, brief: corporaBrief };
  const rows = [];
  for (const slot of pilot.schedule) {
    const [caseId, condition] = slot.split(":");
    const candidate = caseById.get(caseId);
    const sessionDirectory = path.join(runDirectory, "sessions", "pilot", caseId, condition);
    const result = await readJson(path.join(sessionDirectory, "result.json"));
    const attemptDirectory = path.join(sessionDirectory, result.workspace);
    const [events, queryState] = await Promise.all([
      readEventsJsonl(path.join(attemptDirectory, "events.jsonl")),
      readJson(path.join(attemptDirectory, "query-state.json")),
    ]);
    const commands = extractSearchSessions(events);
    const targets = targetIdsForSession(corpora, candidate, condition);
    const row = {
      caseId,
      condition,
      pass: Boolean(result.score?.pass),
      firstFailure: decideFirstFailure(candidate, result, targets, commands),
      searchHit: successfulSearchHit(commands, new Set(targets.discovery)),
      openedRefs: openedRefs(commands),
      requiredFields: requiredFields(candidate, result),
      calls: queryState.calls,
      retrievedBytes: queryState.returnedBytes,
      finalAnswerBytes: finalAnswerBytes(result),
      scoringReason: scoringReason(candidate, result, decideFirstFailure(candidate, result, targets, commands)),
      scoreFailures: result.score?.failures ?? [],
      auditViolations: result.audit?.violations ?? [],
      targetIds: targets,
    };
    rows.push(row);
  }
  rows.sort((left, right) => (
    compareText(left.caseId, right.caseId)
    || compareText(left.condition, right.condition)
  ));
  const diagnostic = {
    schema: DIAGNOSTIC_SCHEMA,
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    protocolVersion: manifest.protocolVersion,
    runId: manifest.runId,
    release: manifest.release,
    phase: "pilot",
    source: {
      manifestSha256: sha256(manifest),
      fixtureSha256: sha256(fixture),
      pilotSha256: sha256(pilot),
    },
    summary: {
      totalsByCondition: conditionTotals(rows),
      totalsByFirstFailure: stageTotals(rows),
    },
    rows: rows.map((row) => ({
      caseId: row.caseId,
      condition: row.condition,
      pass: row.pass,
      firstFailure: row.firstFailure,
      searchHit: row.searchHit,
      openedRefs: row.openedRefs,
      requiredFields: row.requiredFields,
      calls: row.calls,
      retrievedBytes: row.retrievedBytes,
      finalAnswerBytes: row.finalAnswerBytes,
      scoringReason: row.scoringReason,
      scoreFailures: row.scoreFailures,
      auditViolations: row.auditViolations,
    })),
  };
  return diagnostic;
}

export async function writeAtlasDuplicatePilotDiagnostic(runDirectoryInput, outputPath = null) {
  const runDirectory = resolveRunDirectory(runDirectoryInput);
  const diagnostic = await analyzeAtlasDuplicatePilotRun(runDirectory);
  const target = outputPath ?? path.join(runDirectory, "diagnostic.json");
  const tablePath = target.endsWith(".json") ? `${target.slice(0, -5)}.txt` : `${target}.txt`;
  await writeCanonicalJson(target, diagnostic);
  await fs.writeFile(tablePath, `${renderAtlasDuplicateDiagnosticTable(diagnostic)}\n`);
  return { diagnostic, outputPath: target, tablePath };
}

function usage() {
  return "Usage: bun src/atlas-duplicate-diagnostics.js <run-id-or-run-directory> [output-path]";
}

if (import.meta.main) {
  const [runDirectory, outputPath] = process.argv.slice(2);
  if (!runDirectory) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    writeAtlasDuplicatePilotDiagnostic(runDirectory, outputPath ?? null).then(({ diagnostic, outputPath: target, tablePath }) => {
      process.stdout.write(`${renderAtlasDuplicateDiagnosticTable(diagnostic)}\n`);
      process.stdout.write(`${canonicalStringify({ outputPath: target, tablePath, rows: diagnostic.rows.length })}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
  }
}
