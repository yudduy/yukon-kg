#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  ARM_EVALUATIONS,
  CALIBRATION_BLOCKS,
  CONDITION_DEFINITIONS,
  CONFIRMATORY_MAX_BLOCKS,
  MODEL,
  POSITIVE_CONTROL_COMMIT,
  PRELUDE_EVALUATIONS,
  PRIMARY_CONTRASTS,
  PROTOCOL_VERSION,
  REPOSITORY_URL,
  SEARCH_COMMIT,
  TUNING_ALTERNATIVES,
  TUNING_BASELINE,
  TUNING_CANDIDATES,
  analyzeConfirmatoryBlocks,
  assessPilotInformativeness,
  assessTuningLandscape,
  bestValidArtifact,
  canonicalStringify,
  compileConditionPacket,
  contrastDifferences,
  estimateConfirmatoryBlocks,
  pairedImprovementPercent,
  parseSquareScore,
  sha256,
  verifyDuplicateScores,
} from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_ROOT = path.join(ROOT, ".runs", "h1-h2");
const CACHE_ROOT = path.join(ROOT, ".runs", "cache");
const MIRROR_PATH = path.join(CACHE_ROOT, "ecdsafail.git");
const PRODUCT_REGISTER = path.join("src", "point_add", "trailmix_ludicrous", "square", "product_register.rs");
const HARNESS_MARKER = "pub(super) fn selfcheck()";
const EXPECTED_BASELINE_SCORE = 66_878_230.169;
const EXPECTED_CONTROL_OFF = 74_736_716.125;
const EXPECTED_CONTROL_ON = 71_194_989.69;
const EXPECTED_CONTROL_REDUCTION = 4.738938;
const EXPECTED_TUNING_BASELINE = 56_408_075.598;
const EXPECTED_TUNING_OPTIMUM = 55_853_825;
const EXPECTED_TUNING_OPTIMUM_CANDIDATES = ["ladder-044", "ladder-046"];
const CANARY_MAX_INPUT_TOKENS = 13_000;
const CANARY_MAX_PROMPT_BYTES = 20_000;
const SOURCE_ALLOWLIST = new Set(["Cargo.lock", "Cargo.toml", "NOTICE", "rust-toolchain", "src"]);
const SOURCE_FORBIDDEN = [
  /d919bc6/iu,
  /SUB4_SQUARE_KARATSUBA2/iu,
  /56059\.047/u,
  /58709\.125/u,
  /4\.738938/u,
];
const FORBIDDEN_EVENT_TYPES = /(?:web_search|mcp|browser|computer|image_generation|spawn_agent|collaboration)/iu;
const FORBIDDEN_PROMPT_SURFACE = [
  { label: "enabled skill entries", pattern: /^\s*-\s+.+SKILL\.md.+$/mu },
];
const artifactWrites = new Map();
const ALLOCATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "baseArtifactId",
    "interventionFamily",
    "hypothesis",
    "falsifier",
    "branchBrief",
    "rationale",
    "planUpdate",
  ],
  properties: {
    baseArtifactId: { type: "string" },
    interventionFamily: { type: "string", minLength: 1 },
    hypothesis: { type: "string", minLength: 1 },
    falsifier: { type: "string", minLength: 1 },
    branchBrief: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    planUpdate: { type: "string", minLength: 1 },
  },
};
const TUNING_ALLOCATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidateId", "hypothesis", "falsifier", "rationale", "planUpdate"],
  properties: {
    candidateId: { type: "string", pattern: "^ladder-[0-9]{3}$" },
    hypothesis: { type: "string", minLength: 1 },
    falsifier: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    planUpdate: { type: "string", minLength: 1 },
  },
};
const EXECUTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "replacements"],
  properties: {
    status: { type: "string", enum: ["implemented", "no_patch", "blocked"] },
    summary: { type: "string" },
    replacements: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["old", "new"],
        properties: {
          old: { type: "string", minLength: 1 },
          new: { type: "string" },
        },
      },
    },
  },
};
const CANARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "model"],
  properties: {
    status: { type: "string", enum: ["READY", "NETWORK_OPEN"] },
    model: { type: "string", const: MODEL },
  },
};
const WORKER_CANARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "model"],
  properties: {
    status: { type: "string", enum: ["NO_FORBIDDEN_TOOLS", "FORBIDDEN_TOOL_VISIBLE"] },
    model: { type: "string", const: MODEL },
  },
};

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  return `${nowIso().replace(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

function assertRunPath(target) {
  const resolved = path.resolve(target);
  const allowedRoots = [path.resolve(ROOT, ".runs"), path.resolve(os.tmpdir())];
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error(`refusing to mutate path outside experiment roots: ${resolved}`);
  }
}

async function removeOwned(target) {
  assertRunPath(target);
  await fs.rm(target, { recursive: true, force: true });
}

async function ensureDirectory(target) {
  await fs.mkdir(target, { recursive: true });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(target, contents) {
  await ensureDirectory(path.dirname(target));
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, target);
}

async function writeJson(target, value) {
  await atomicWrite(target, `${canonicalStringify(value)}\n`);
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function readJsonIfPresent(target) {
  return await pathExists(target) ? readJson(target) : null;
}

export class Semaphore {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("semaphore limit must be positive");
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async use(operation) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export async function runProcess(command, args, {
  cwd = ROOT,
  env = {},
  input = null,
  timeoutMs = 15 * 60_000,
} = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function checkedProcess(command, args, options) {
  const result = await runProcess(command, args, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.exitCode}): ${detail}`);
  }
  return result;
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if ([".git", "target"].includes(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function sourceDigest(root) {
  const hash = new Bun.CryptoHasher("sha256");
  for (const relative of await listFiles(root)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function ensureMirror() {
  await ensureDirectory(CACHE_ROOT);
  if (!(await pathExists(MIRROR_PATH))) {
    await checkedProcess("git", ["clone", "--mirror", REPOSITORY_URL, MIRROR_PATH], { cwd: CACHE_ROOT });
  } else {
    await checkedProcess("git", ["--git-dir", MIRROR_PATH, "fetch", "--prune", "origin"], { cwd: ROOT });
  }
  for (const commit of [SEARCH_COMMIT, POSITIVE_CONTROL_COMMIT]) {
    await checkedProcess("git", ["--git-dir", MIRROR_PATH, "cat-file", "-e", `${commit}^{commit}`]);
  }
}

async function removeNonAllowlistedSource(snapshot) {
  for (const entry of await fs.readdir(snapshot, { withFileTypes: true })) {
    if (!SOURCE_ALLOWLIST.has(entry.name)) await removeOwned(path.join(snapshot, entry.name));
  }
  const removable = [
    path.join(snapshot, "src", "point_add", "memory"),
  ];
  for (const target of removable) await removeOwned(target);
  for (const relative of await listFiles(snapshot)) {
    if (/(?:\.pre_live|\.pre_ts|\.rrm|\.pyc)$/u.test(relative)) {
      await removeOwned(path.join(snapshot, relative));
    }
  }
}

async function initializeNeutralRepository(snapshot) {
  await checkedProcess("git", ["init", "-q"], { cwd: snapshot });
  await checkedProcess("git", ["config", "user.name", "Experiment Host"], { cwd: snapshot });
  await checkedProcess("git", ["config", "user.email", "experiment@invalid"], { cwd: snapshot });
  await checkedProcess("git", ["add", "-A"], { cwd: snapshot });
  const fixedEnvironment = {
    GIT_AUTHOR_DATE: "2026-08-23T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-08-23T00:00:00Z",
  };
  await checkedProcess("git", ["commit", "-q", "-m", "experiment baseline"], { cwd: snapshot, env: fixedEnvironment });
}

async function assertSanitized(snapshot) {
  for (const relative of await listFiles(snapshot)) {
    const fullPath = path.join(snapshot, relative);
    const bytes = await fs.readFile(fullPath);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const leaked = SOURCE_FORBIDDEN.find((pattern) => pattern.test(text));
    if (leaked) throw new Error(`sealed positive-control information leaked into ${relative}`);
  }
  if (await pathExists(path.join(snapshot, "src", "point_add", "memory"))) {
    throw new Error("source snapshot still contains point_add memory");
  }
}

async function materializeCommit(commit, destination, { sanitize = false } = {}) {
  assertRunPath(destination);
  await removeOwned(destination);
  await ensureDirectory(destination);
  const archive = path.join(os.tmpdir(), `yukon-kg-${commit.slice(0, 8)}-${crypto.randomUUID()}.tar`);
  assertRunPath(archive);
  try {
    await checkedProcess("git", ["--git-dir", MIRROR_PATH, "archive", "--format=tar", `--output=${archive}`, commit]);
    await checkedProcess("tar", ["-xf", archive, "-C", destination]);
  } finally {
    await removeOwned(archive);
  }
  if (sanitize) {
    await removeNonAllowlistedSource(destination);
    await assertSanitized(destination);
  }
  await initializeNeutralRepository(destination);
  return { path: destination, digest: await sourceDigest(destination) };
}

async function copySource(source, destination) {
  assertRunPath(destination);
  await removeOwned(destination);
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes("target"),
  });
}

async function copyPlainSource(source, destination) {
  assertRunPath(destination);
  await removeOwned(destination);
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry) => {
      const parts = path.relative(source, entry).split(path.sep);
      return !parts.includes(".git") && !parts.includes("target");
    },
  });
  await initializeNeutralRepository(destination);
}

async function cloneBuildTree(source, destination) {
  assertRunPath(destination);
  await removeOwned(destination);
  await ensureDirectory(path.dirname(destination));
  const clone = await runProcess("cp", ["-cR", source, destination], { cwd: ROOT });
  if (clone.exitCode !== 0) {
    await removeOwned(destination);
    await fs.cp(source, destination, { recursive: true });
  }
}

async function pruneLocalCrateArtifacts(targetDirectory) {
  const release = path.join(targetDirectory, "release");
  const locations = [
    path.join(release, ".fingerprint"),
    path.join(release, "build"),
    path.join(release, "deps"),
    release,
  ];
  for (const location of locations) {
    let entries;
    try {
      entries = await fs.readdir(location);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/^(?:quantum_ecc-|libquantum_ecc|build_circuit(?:[-.]|$))/u.test(entry)) {
        await removeOwned(path.join(location, entry));
      }
    }
  }
}

async function buildCacheDescriptor(source) {
  const rustc = await checkedProcess("rustc", ["-Vv"]);
  const descriptor = {
    sourceDigest: await sourceDigest(source),
    cargoLockSha256: sha256(await fs.readFile(path.join(source, "Cargo.lock"))),
    rustc: rustc.stdout.trim(),
    profile: "release",
  };
  const key = sha256(descriptor);
  return { ...descriptor, key, templateDirectory: path.join(CACHE_ROOT, "build", key, "target") };
}

async function publishBuildTemplate(sourceTarget, templateDirectory) {
  if (await pathExists(templateDirectory)) return;
  const temporary = `${templateDirectory}.tmp-${crypto.randomUUID()}`;
  await cloneBuildTree(sourceTarget, temporary);
  await pruneLocalCrateArtifacts(temporary);
  await ensureDirectory(path.dirname(templateDirectory));
  try {
    await fs.rename(temporary, templateDirectory);
  } catch (error) {
    await removeOwned(temporary);
    if (!(error.code === "ENOTEMPTY" || error.code === "EEXIST") || !(await pathExists(templateDirectory))) throw error;
  }
}

async function sealedHarnessSuffix(source) {
  const file = await fs.readFile(path.join(source, PRODUCT_REGISTER), "utf8");
  const offset = file.indexOf(HARNESS_MARKER);
  if (offset < 0) throw new Error(`sealed harness marker missing from ${PRODUCT_REGISTER}`);
  return file.slice(offset);
}

async function changedFiles(workspace) {
  const result = await checkedProcess("git", ["diff", "--name-only", "HEAD"], { cwd: workspace });
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function checkCandidateIntegrity(workspace, expectedHarnessSuffix) {
  const changed = await changedFiles(workspace);
  if (changed.length === 0) return { valid: false, reason: "no_patch", changedFiles: changed };
  if (changed.some((entry) => entry !== PRODUCT_REGISTER)) {
    return { valid: false, reason: "outside_allowed_file", changedFiles: changed };
  }
  const candidate = await fs.readFile(path.join(workspace, PRODUCT_REGISTER), "utf8");
  const offset = candidate.indexOf(HARNESS_MARKER);
  if (offset < 0 || candidate.slice(offset) !== expectedHarnessSuffix) {
    return { valid: false, reason: "protected_harness_modified", changedFiles: changed };
  }
  return { valid: true, reason: null, changedFiles: changed };
}

export class HostScorer {
  constructor({ semaphore = new Semaphore(4), timeoutMs = 15 * 60_000, templateDirectory = null } = {}) {
    this.semaphore = semaphore;
    this.timeoutMs = timeoutMs;
    this.templateDirectory = templateDirectory;
  }

  setBuildTemplate(templateDirectory) {
    this.templateDirectory = templateDirectory;
  }

  async prepareTarget(targetDirectory) {
    if (await pathExists(targetDirectory)) return;
    if (this.templateDirectory && await pathExists(this.templateDirectory)) {
      await cloneBuildTree(this.templateDirectory, targetDirectory);
      return;
    }
    await ensureDirectory(targetDirectory);
  }

  async one(workspace, targetDirectory, extraEnvironment = {}) {
    return this.semaphore.use(async () => {
      await this.prepareTarget(targetDirectory);
      const processResult = await runProcess(
        "cargo",
        ["run", "--release", "--bin", "build_circuit"],
        {
          cwd: workspace,
          timeoutMs: this.timeoutMs,
          env: {
            CARGO_TARGET_DIR: targetDirectory,
            SUB4_PRODUCT_SQUARE_SELFTEST: "1",
            ...extraEnvironment,
          },
        },
      );
      await removeOwned(path.join(workspace, "ops.bin"));
      if (processResult.exitCode !== 0) {
        return { valid: false, process: processResult, error: "selftest_failed" };
      }
      try {
        return {
          valid: true,
          process: processResult,
          parsed: parseSquareScore(`${processResult.stdout}\n${processResult.stderr}`),
        };
      } catch (error) {
        return { valid: false, process: processResult, error: error.message };
      }
    });
  }

  async twice(workspace, targetDirectory, extraEnvironment = {}) {
    const inputDigest = await sourceDigest(workspace);
    const first = await this.one(workspace, targetDirectory, extraEnvironment);
    if (!first.valid) return { validity: "invalid", reason: first.error, sourceDigest: inputDigest, reproductions: [first] };
    const second = await this.one(workspace, targetDirectory, extraEnvironment);
    if (!second.valid) return { validity: "invalid", reason: second.error, sourceDigest: inputDigest, reproductions: [first, second] };
    if (await sourceDigest(workspace) !== inputDigest) {
      return { validity: "invalid", reason: "scorer_mutated_source", sourceDigest: inputDigest, reproductions: [first, second] };
    }
    try {
      return {
        validity: "valid",
        score: verifyDuplicateScores(first.parsed, second.parsed),
        sourceDigest: inputDigest,
        reproductions: [first, second],
      };
    } catch (error) {
      return { validity: "invalid", reason: error.message, reproductions: [first, second] };
    }
  }
}

async function findSkillDirectories() {
  const roots = [
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".codex", "plugins", "cache"),
  ];
  const found = [];
  const visited = new Set();
  async function visit(directory) {
    let canonicalDirectory;
    try {
      canonicalDirectory = await fs.realpath(directory);
    } catch {
      return;
    }
    if (visited.has(canonicalDirectory)) return;
    visited.add(canonicalDirectory);
    let entries;
    try {
      entries = await fs.readdir(canonicalDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      found.push(path.join(canonicalDirectory, "SKILL.md"));
    }
    for (const entry of entries) {
      if ((entry.isDirectory() || entry.isSymbolicLink()) && ![".git", "node_modules"].includes(entry.name)) {
        await visit(path.join(canonicalDirectory, entry.name));
      }
    }
  }
  for (const root of roots) await visit(root);
  return [...new Set(found)].sort();
}

function skillDenylistConfig(skillDirectories) {
  return `skills.config=[${skillDirectories.map((directory) => `{path=${JSON.stringify(directory)},enabled=false}`).join(",")}]`;
}

function codexConfigArguments({ reasoning, skills, allowShell = false }) {
  const argumentsList = [
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--json",
    "-m", MODEL,
    "-c", `model_reasoning_effort=${JSON.stringify(reasoning)}`,
    "-c", "web_search=\"disabled\"",
    "-c", "tools.web_search=false",
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", "shell_environment_policy.inherit=\"core\"",
    "-c", "approval_policy=\"never\"",
    "-c", "model_verbosity=\"low\"",
    "-c", "mcp_servers={}",
    "-c", skillDenylistConfig(skills),
    "--disable", "apps",
    "--disable", "browser_use",
    "--disable", "computer_use",
    "--disable", "image_generation",
    "--disable", "in_app_browser",
    "--disable", "memories",
    "--disable", "multi_agent",
    "--disable", "plugin_sharing",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "tool_suggest",
  ];
  if (!allowShell) argumentsList.push("--disable", "shell_tool", "--disable", "unified_exec");
  return argumentsList;
}

function codexDebugArguments(skills) {
  return [
    "-c", skillDenylistConfig(skills),
    "--disable", "apps",
    "--disable", "browser_use",
    "--disable", "computer_use",
    "--disable", "image_generation",
    "--disable", "in_app_browser",
    "--disable", "memories",
    "--disable", "multi_agent",
    "--disable", "plugin_sharing",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "tool_suggest",
  ];
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

function extractCodexResult(processResult) {
  const events = parseJsonLines(processResult.stdout);
  const threadId = events.find((event) => event.type === "thread.started")?.thread_id ?? null;
  const messages = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text);
  const completion = [...events].reverse().find((event) => event.type === "turn.completed");
  const errorItems = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "error")
    .map((event) => event.item.message);
  return {
    process: processResult,
    events,
    threadId,
    lastMessage: messages.at(-1) ?? null,
    usage: completion?.usage ?? null,
    errorItems,
  };
}

export class CodexRunner {
  constructor({ semaphore = new Semaphore(8), timeoutMs = 10 * 60_000, skills = null } = {}) {
    this.semaphore = semaphore;
    this.timeoutMs = timeoutMs;
    this.skillsPromise = skills ? Promise.resolve(skills) : findSkillDirectories();
  }

  async invoke({
    cwd,
    prompt,
    reasoning = "medium",
    schemaPath,
    sessionId = null,
    ephemeral = false,
    sandbox = "read-only",
    allowShell = false,
  }) {
    const skills = await this.skillsPromise;
    const common = codexConfigArguments({ reasoning, skills, allowShell });
    const args = sessionId
      ? ["exec", "resume", ...common, "--output-schema", schemaPath, sessionId, "-"]
      : ["exec", ...common, "-s", sandbox, "--output-schema", schemaPath, ...(ephemeral ? ["--ephemeral"] : []), "-"];
    return this.semaphore.use(async () => extractCodexResult(await runProcess("codex", args, {
      cwd,
      input: prompt,
      timeoutMs: this.timeoutMs,
    })));
  }

  async invokeWithRetries(options, retries = 2) {
    const attempts = [];
    for (let index = 0; index <= retries; index += 1) {
      const result = await this.invoke(options);
      attempts.push(result);
      if (result.lastMessage !== null) return { ...result, attempts };
    }
    const error = new Error("Codex infrastructure failed before producing a model message");
    error.attempts = attempts;
    throw error;
  }
}

async function writeSchemas(runDirectory) {
  const schemaDirectory = path.join(runDirectory, "schemas");
  await ensureDirectory(schemaDirectory);
  const paths = {
    allocator: path.join(schemaDirectory, "allocator.json"),
    tuningAllocator: path.join(schemaDirectory, "tuning-allocator.json"),
    executor: path.join(schemaDirectory, "executor.json"),
    canary: path.join(schemaDirectory, "canary.json"),
    workerCanary: path.join(schemaDirectory, "worker-canary.json"),
  };
  await writeJson(paths.allocator, ALLOCATOR_SCHEMA);
  await writeJson(paths.tuningAllocator, TUNING_ALLOCATOR_SCHEMA);
  await writeJson(paths.executor, EXECUTOR_SCHEMA);
  await writeJson(paths.canary, CANARY_SCHEMA);
  await writeJson(paths.workerCanary, WORKER_CANARY_SCHEMA);
  return paths;
}

function forbiddenCodexEvidence(result) {
  const violations = [];
  const combined = `${result.process.stdout}\n${result.process.stderr}\n${result.errorItems.join("\n")}`;
  if (/Skill descriptions were shortened|Codex can still see every skill/iu.test(combined)) {
    violations.push("skills were injected");
  }
  for (const event of result.events) {
    const itemType = event.item?.type ?? event.type;
    if (FORBIDDEN_EVENT_TYPES.test(itemType)) violations.push(`forbidden event type: ${itemType}`);
  }
  if ((result.usage?.input_tokens ?? 0) > CANARY_MAX_INPUT_TOKENS) {
    violations.push(`canary input exceeded ${CANARY_MAX_INPUT_TOKENS} tokens`);
  }
  return [...new Set(violations)];
}

function codexAttemptMetadata(result) {
  return (result?.attempts ?? []).map((attempt, index) => ({
    index,
    exitCode: attempt.process.exitCode,
    signal: attempt.process.signal,
    timedOut: attempt.process.timedOut,
    durationMs: attempt.process.durationMs,
    responseSha256: sha256(attempt.process.stdout),
    usage: attempt.usage,
  }));
}

export function networkCanaryEvidence(events) {
  const outputs = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution")
    .map((event) => event.item.aggregated_output ?? "");
  return {
    outputs,
    blocked: outputs.some((output) => /(?:^|\n)NETWORK_BLOCKED(?:\n|$)/u.test(output)),
    open: outputs.some((output) => /(?:^|\n)NETWORK_OPEN(?:\n|$)/u.test(output)),
  };
}

export function promptSurfaceViolations(text) {
  const violations = FORBIDDEN_PROMPT_SURFACE
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => `prompt surface still includes ${label}`);
  if (text.length > CANARY_MAX_PROMPT_BYTES) {
    violations.push(`prompt surface exceeded ${CANARY_MAX_PROMPT_BYTES} bytes`);
  }
  return [...new Set(violations)];
}

export function enabledMcpServers(text) {
  return [...new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^Name(?:\s|$)/u.test(line) && /\benabled\b/iu.test(line))
      .map((line) => line.split(/\s+/u)[0]),
  )];
}

async function inspectCodexSurface({ runDirectory, cwd, skills }) {
  const promptInputResult = await runProcess(
    "codex",
    ["debug", "prompt-input", ...codexDebugArguments(skills), "isolation canary"],
    { cwd, timeoutMs: 30_000 },
  );
  const mcpListResult = await runProcess("codex", ["mcp", "list"], { cwd, timeoutMs: 30_000 });
  await atomicWrite(path.join(runDirectory, "preflight", "prompt-input.json"), promptInputResult.stdout || promptInputResult.stderr);
  await atomicWrite(path.join(runDirectory, "preflight", "mcp-list.txt"), `${mcpListResult.stdout}${mcpListResult.stderr}`);
  const activeMcpServers = enabledMcpServers(mcpListResult.stdout);
  const diagnosticViolations = promptSurfaceViolations(promptInputResult.stdout);
  return {
    diagnosticOnly: true,
    note: "debug prompt-input and mcp list do not accept the worker's ignore-user-config and ignore-rules flags; admission uses live worker events and usage",
    promptInput: {
      exitCode: promptInputResult.exitCode,
      bytes: promptInputResult.stdout.length,
      sha256: sha256(promptInputResult.stdout),
      violations: diagnosticViolations,
    },
    mcpList: {
      exitCode: mcpListResult.exitCode,
      sha256: sha256(mcpListResult.stdout),
      hostConfiguredServers: activeMcpServers,
    },
  };
}

async function initializeCanaryRepository(directory) {
  await removeOwned(directory);
  await ensureDirectory(directory);
  await atomicWrite(path.join(directory, "README.txt"), "Isolated experiment canary.\n");
  await initializeNeutralRepository(directory);
}

export async function runIsolationCanary({ runDirectory, codexRunner, schemas }) {
  const directory = path.join(runDirectory, "preflight", "canary");
  await initializeCanaryRepository(directory);
  const surface = await inspectCodexSurface({
    runDirectory,
    cwd: directory,
    skills: await codexRunner.skillsPromise,
  });
  const prompt = [
    "This is an isolation canary.",
    "Use the shell exactly once to run: curl -fsS --max-time 2 https://example.com >/dev/null && printf NETWORK_OPEN || printf NETWORK_BLOCKED",
    `If and only if the observed output is NETWORK_BLOCKED, return {\"status\":\"READY\",\"model\":${JSON.stringify(MODEL)}}.`,
    `If it is NETWORK_OPEN, return {\"status\":\"NETWORK_OPEN\",\"model\":${JSON.stringify(MODEL)}}.`,
    `If no shell evidence is available, return {\"status\":\"NO_SHELL_EVIDENCE\",\"model\":${JSON.stringify(MODEL)}}.`,
  ].join("\n");
  let result;
  try {
    result = await codexRunner.invokeWithRetries({
      cwd: directory,
      prompt,
      reasoning: "low",
      schemaPath: schemas.canary,
      ephemeral: true,
      sandbox: "workspace-write",
      allowShell: true,
    });
  } catch (error) {
    const attempts = (error.attempts ?? []).map((attempt) => ({
      exitCode: attempt.process.exitCode,
      timedOut: attempt.process.timedOut,
      stdout: attempt.process.stdout,
      stderr: attempt.process.stderr,
    }));
    const report = {
      gate: "codex_isolation",
      status: "FAIL",
      corrections: ["Codex failed before producing a model message; inspect attempts and correct the isolated invocation."],
      model: MODEL,
      discoveredSkillCount: (await codexRunner.skillsPromise).length,
      attempts,
    };
    await writeJson(path.join(runDirectory, "preflight", "codex-isolation.json"), report);
    return report;
  }
  const violations = forbiddenCodexEvidence(result);
  let message;
  try {
    message = JSON.parse(result.lastMessage);
  } catch {
    violations.push("canary returned non-JSON output");
  }
  const networkEvidence = networkCanaryEvidence(result.events);
  if (!networkEvidence.blocked || networkEvidence.open) violations.push("network block was not observed in completed command output");
  if (message?.model !== MODEL) violations.push("canary did not attest the pinned model");
  let workerResult = null;
  try {
    workerResult = await codexRunner.invokeWithRetries({
      cwd: directory,
      prompt: [
        "This is a tool-removal canary.",
        "The inert todo_list planner is allowed and should not be invoked.",
        "Attempt to invoke any forbidden externally stateful tool: shell, MCP, web, plugin, browser, computer, image, or subagent.",
        `Only if none is exposed, return {\"status\":\"NO_FORBIDDEN_TOOLS\",\"model\":${JSON.stringify(MODEL)}} without inventing evidence.`,
        `If one is visible but cannot be invoked, return {\"status\":\"FORBIDDEN_TOOL_VISIBLE\",\"model\":${JSON.stringify(MODEL)}}.`,
      ].join("\n"),
      reasoning: "low",
      schemaPath: schemas.workerCanary,
      ephemeral: true,
      sandbox: "read-only",
    });
    violations.push(...forbiddenCodexEvidence(workerResult));
    if (codexToolEvents(workerResult).length > 0) violations.push("worker profile exposed a tool");
    const workerMessage = JSON.parse(workerResult.lastMessage);
    if (workerMessage.status !== "NO_FORBIDDEN_TOOLS" || workerMessage.model !== MODEL) {
      violations.push("worker profile did not attest tool removal");
    }
  } catch {
    violations.push("worker tool-removal canary failed before a valid attestation");
  }
  const report = {
    gate: "codex_isolation",
    status: violations.length === 0 ? "PASS" : "FAIL",
    corrections: violations,
    model: MODEL,
    networkEvidence,
    usage: result.usage,
    workerUsage: workerResult?.usage ?? null,
    attempts: codexAttemptMetadata(result),
    workerAttempts: codexAttemptMetadata(workerResult),
    threadId: result.threadId,
    discoveredSkillCount: (await codexRunner.skillsPromise).length,
    surface,
    eventsSha256: sha256(result.process.stdout),
    stdout: result.process.stdout,
    stderr: result.process.stderr,
    workerStdout: workerResult?.process.stdout ?? null,
    workerStderr: workerResult?.process.stderr ?? null,
  };
  await writeJson(path.join(runDirectory, "preflight", "codex-isolation.json"), report);
  return report;
}

async function expectScore(label, actual, expected, tolerance = 0.001) {
  const difference = Math.abs(actual - expected);
  if (difference > tolerance) throw new Error(`${label} expected ${expected}, observed ${actual}`);
}

export async function runScorerPreflight({ runDirectory, scorer }) {
  const preflightDirectory = path.join(runDirectory, "preflight");
  const baselineDirectory = path.join(preflightDirectory, "source-51c6c31");
  const controlDirectory = path.join(preflightDirectory, "source-d919bc6");
  let baseline = null;
  let control = null;
  let baselineResult = null;
  let off = null;
  let on = null;
  let reduction = null;
  let taskBaseline = null;
  let taskMeasurements = [];
  let taskRawMeasurements = [];
  let taskLandscape = null;
  let buildCache = null;
  try {
    await ensureMirror();
    baseline = await materializeCommit(SEARCH_COMMIT, baselineDirectory, { sanitize: true });
    control = await materializeCommit(POSITIVE_CONTROL_COMMIT, controlDirectory);
    buildCache = await buildCacheDescriptor(baseline.path);
    if (await pathExists(buildCache.templateDirectory)) scorer.setBuildTemplate?.(buildCache.templateDirectory);
    const baselineTarget = path.join(preflightDirectory, "targets", "baseline");
    baselineResult = await scorer.twice(baseline.path, baselineTarget);
    if (baselineResult.validity !== "valid") throw new Error(`baseline scorer failed: ${baselineResult.reason}`);
    await expectScore("51c6c31 baseline", baselineResult.score.score, EXPECTED_BASELINE_SCORE);
    if (!(await pathExists(buildCache.templateDirectory))) {
      await publishBuildTemplate(baselineTarget, buildCache.templateDirectory);
    }
    scorer.setBuildTemplate?.(buildCache.templateDirectory);
    const tuningTarget = path.join(preflightDirectory, "targets", "tuning-landscape");
    taskBaseline = await scorer.twice(baseline.path, tuningTarget, {
      SUB4_SQUARE_CHUNK_MIN: String(TUNING_BASELINE.chunkMin),
      SUB4_SQUARE_LADDER: String(TUNING_BASELINE.ladder),
    });
    if (taskBaseline.validity !== "valid") throw new Error(`tuning baseline scorer failed: ${taskBaseline.reason}`);
    await expectScore("tuning baseline", taskBaseline.score.score, EXPECTED_TUNING_BASELINE);
    for (const candidate of TUNING_CANDIDATES) {
      const scoring = await scorer.twice(baseline.path, tuningTarget, {
        SUB4_SQUARE_CHUNK_MIN: String(candidate.chunkMin),
        SUB4_SQUARE_LADDER: String(candidate.ladder),
      });
      taskMeasurements.push({
        candidateId: candidate.candidateId,
        configuration: { chunkMin: candidate.chunkMin, ladder: candidate.ladder },
        validity: scoring.validity,
        reason: scoring.reason ?? null,
        score: scoring.score ?? null,
      });
      taskRawMeasurements.push({
        candidateId: candidate.candidateId,
        configuration: { chunkMin: candidate.chunkMin, ladder: candidate.ladder },
        scoring,
      });
    }
    taskLandscape = assessTuningLandscape(taskBaseline.score.score, taskMeasurements);
    await expectScore("tuning optimum", taskLandscape.bestScore, EXPECTED_TUNING_OPTIMUM);
    if (canonicalStringify(taskLandscape.bestCandidateIds) !== canonicalStringify(EXPECTED_TUNING_OPTIMUM_CANDIDATES)) {
      throw new Error(`tuning optimum expected ${EXPECTED_TUNING_OPTIMUM_CANDIDATES.join(", ")}, observed ${taskLandscape.bestCandidateIds.join(", ")}`);
    }
    await writeJson(path.join(preflightDirectory, "task-landscape.json"), {
      baseline: { candidate: TUNING_BASELINE, scoring: taskBaseline },
      candidates: taskMeasurements,
      gate: taskLandscape,
    });
    if (taskLandscape.status !== "PASS") throw new Error(`tuning landscape admission failed: ${taskLandscape.corrections.join("; ")}`);
    off = await scorer.twice(control.path, path.join(preflightDirectory, "targets", "control-off"), {
      SUB4_SQUARE_KARATSUBA2: "0",
    });
    on = await scorer.twice(control.path, path.join(preflightDirectory, "targets", "control-on"), {
      SUB4_SQUARE_KARATSUBA2: "1",
    });
    if (off.validity !== "valid" || on.validity !== "valid") throw new Error("positive-control scorer did not reproduce");
    await expectScore("positive control off", off.score.score, EXPECTED_CONTROL_OFF);
    await expectScore("positive control on", on.score.score, EXPECTED_CONTROL_ON);
    reduction = pairedImprovementPercent(off.score.score, on.score.score);
    await expectScore("positive control reduction", reduction, EXPECTED_CONTROL_REDUCTION, 0.000001);
  } catch (error) {
    await writeJson(path.join(preflightDirectory, "scorer-raw.json"), { baseline: baselineResult, taskBaseline, taskRawMeasurements, off, on });
    const report = {
      gate: "host_scorer",
      status: "FAIL",
      corrections: [error.message],
      source: baseline ? { commit: SEARCH_COMMIT, digest: baseline.digest } : null,
      positiveControl: control ? { commit: POSITIVE_CONTROL_COMMIT, digest: control.digest } : null,
      task: taskLandscape ?? { status: "NOT_RUN", measurements: taskMeasurements },
      buildCache,
    };
    await writeJson(path.join(preflightDirectory, "host-scorer.json"), report);
    return { report, baseline };
  }
  await writeJson(path.join(preflightDirectory, "scorer-raw.json"), { baseline: baselineResult, taskBaseline, taskRawMeasurements, off, on });
  const report = {
    gate: "host_scorer",
    status: "PASS",
    corrections: [],
    source: { commit: SEARCH_COMMIT, digest: baseline.digest, score: baselineResult.score },
    task: {
      baseline: { candidate: TUNING_BASELINE, score: taskBaseline.score },
      landscape: taskLandscape,
      measurements: taskMeasurements,
    },
    buildCache,
    positiveControl: {
      commit: POSITIVE_CONTROL_COMMIT,
      off: off.score,
      on: on.score,
      reductionPercent: reduction,
    },
  };
  await writeJson(path.join(preflightDirectory, "host-scorer.json"), report);
  return { report, baseline, taskBaseline };
}

function allocatorPrompt(packet, lastResult = null) {
  return [
    "You are the allocator only. Do not edit source, run experiments, use the network, or inspect unrelated files.",
    "Select exactly one atomic, falsifiable source intervention for a separate executor.",
    "The baseArtifactId must be one of the frontier artifact IDs in the packet.",
    "Write the intervention family, hypothesis, falsifier, and branch brief in impersonal third-person language and do not use the word continue.",
    "Return only the required structured decision.",
    `Decision packet:\n${canonicalStringify(packet)}`,
    ...(lastResult ? [`Most recent host result:\n${canonicalStringify(lastResult)}`] : []),
  ].join("\n\n");
}

function tuningAllocatorPrompt(packet, lastResult = null) {
  return [
    "You are the allocator only. Do not edit source, run commands, use the network, or inspect unrelated files.",
    "Select exactly one candidateId from the available candidates in the decision packet.",
    "The host will apply the candidate's two environment settings and score the fixed product-square self-test twice.",
    "Lower executed Toffoli multiplied by peak qubits is better. Do not select the incumbent or a candidate absent from the packet.",
    "State a falsifiable hypothesis, the reason for this choice, and how the plan should change after the measurement. Use plain third-person language.",
    `Decision packet:\n${canonicalStringify(packet)}`,
    ...(lastResult ? [`Most recent host result:\n${canonicalStringify(lastResult)}`] : []),
  ].join("\n\n");
}

function executorPrompt(decision, sourcePrefix) {
  return [
    "Implement one assigned experiment using exact text replacements. Do not choose a different strategy or call tools.",
    `Replacements may edit only ${PRODUCT_REGISTER} before the protected harness marker.`,
    "For each replacement, copy old exactly from the supplied source and provide its complete new text. Each old value must occur exactly once after earlier replacements. The host applies the replacements and generates the Git diff.",
    "If blocked, return an empty replacements array. Do not return patch syntax, Markdown fences, placeholder text, or prose inside old/new.",
    `Branch brief:\n${decision.branchBrief}`,
    `Hypothesis:\n${decision.hypothesis}`,
    `Falsifier:\n${decision.falsifier}`,
    `Editable source prefix; the sealed harness starts immediately after the final marker:\n${sourcePrefix}`,
  ].join("\n\n");
}

export function applyExactReplacements(source, replacements) {
  let candidate = source;
  for (const [index, replacement] of replacements.entries()) {
    if (replacement.old === replacement.new) throw new Error(`replacement ${index} does not change the source`);
    let occurrences = 0;
    for (let offset = candidate.indexOf(replacement.old); offset >= 0; offset = candidate.indexOf(replacement.old, offset + 1)) {
      occurrences += 1;
    }
    if (occurrences !== 1) throw new Error(`replacement ${index} matched ${occurrences} source regions`);
    candidate = candidate.replace(replacement.old, replacement.new);
  }
  return candidate;
}

function codexToolEvents(result) {
  const allowedTypes = new Set(["agent_message", "error", "reasoning", "todo_list"]);
  return result.events.filter((event) => {
    if (!(event.type === "item.started" || event.type === "item.completed")) return false;
    return !allowedTypes.has(event.item?.type);
  });
}

function parseStructuredMessage(result, label) {
  try {
    return JSON.parse(result.lastMessage);
  } catch (error) {
    throw new Error(`${label} returned invalid structured output: ${error.message}`);
  }
}

async function archivePromptAndResponse(slotDirectory, prompt, result) {
  const promptHash = sha256(prompt);
  const responseHash = sha256(result.process.stdout);
  const objectDirectory = path.join(slotDirectory, "objects");
  await ensureDirectory(objectDirectory);
  await atomicWrite(path.join(objectDirectory, `${promptHash}.prompt.txt`), prompt);
  const attempts = [];
  for (const [index, attempt] of (result.attempts ?? [result]).entries()) {
    const attemptHash = sha256(attempt.process.stdout);
    await atomicWrite(path.join(objectDirectory, `${attemptHash}.events.jsonl`), attempt.process.stdout);
    if (attempt.process.stderr) {
      await atomicWrite(path.join(objectDirectory, `${attemptHash}.stderr.txt`), attempt.process.stderr);
    }
    const processMetadata = {
      index,
      command: attempt.process.command,
      args: attempt.process.args,
      exitCode: attempt.process.exitCode,
      signal: attempt.process.signal,
      timedOut: attempt.process.timedOut,
      durationMs: attempt.process.durationMs,
      responseHash: attemptHash,
      usage: attempt.usage,
    };
    await writeJson(path.join(objectDirectory, `${attemptHash}.process.json`), processMetadata);
    attempts.push(processMetadata);
  }
  return { promptHash, responseHash, attempts };
}

async function archiveArtifact(workspace, blockDirectory) {
  const artifactId = await sourceDigest(workspace);
  const destination = path.join(blockDirectory, "artifacts", artifactId, "source");
  if (!(await pathExists(destination))) {
    if (!artifactWrites.has(destination)) {
      artifactWrites.set(destination, (async () => {
        const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
        await copyPlainSource(workspace, temporary);
        await ensureDirectory(path.dirname(destination));
        try {
          await fs.rename(temporary, destination);
        } catch (error) {
          await removeOwned(temporary);
          if (!(error.code === "ENOTEMPTY" || error.code === "EEXIST") || !(await pathExists(destination))) throw error;
        }
      })().finally(() => artifactWrites.delete(destination)));
    }
    await artifactWrites.get(destination);
  }
  return { artifactId, path: destination };
}

async function decide({ codexRunner, schemas, allocatorDirectory, packet, sessionId, reasoning, slotDirectory, lastResult }) {
  await ensureDirectory(allocatorDirectory);
  const prompt = allocatorPrompt(packet, lastResult);
  const savedPath = path.join(slotDirectory, "allocator-message.json");
  const saved = await readJsonIfPresent(savedPath);
  if (saved?.promptHash === sha256(prompt)) return saved;
  const result = await codexRunner.invokeWithRetries({
    cwd: allocatorDirectory,
    prompt,
    reasoning,
    schemaPath: schemas.allocator,
    sessionId,
    sandbox: "read-only",
  });
  const refs = await archivePromptAndResponse(slotDirectory, prompt, result);
  const allocatorSessionId = sessionId ?? result.threadId;
  let decision = null;
  let invalid = null;
  if (result.process.exitCode !== 0) {
    invalid = { reason: "allocator_model_failure", protocolViolation: false };
  } else if (codexToolEvents(result).length > 0) {
    invalid = { reason: "allocator_used_forbidden_tool", protocolViolation: true };
  } else {
    try {
      decision = parseStructuredMessage(result, "allocator");
    } catch {
      invalid = { reason: "allocator_invalid_structured_output", protocolViolation: false };
    }
  }
  if (decision && !packet.frontier.some((artifact) => artifact.artifactId === decision.baseArtifactId)) {
    invalid = { reason: "allocator_selected_unknown_artifact", protocolViolation: false };
    decision = null;
  }
  const outcome = { decision, invalid, sessionId: allocatorSessionId, ...refs, usage: result.usage };
  await writeJson(savedPath, outcome);
  if (invalid) return outcome;
  await writeJson(path.join(slotDirectory, "decision.json"), {
    ...decision,
    ...refs,
    usage: result.usage,
    allocatorSessionId,
  });
  return outcome;
}

async function decideTuning({ codexRunner, schemas, allocatorDirectory, packet, sessionId, reasoning, slotDirectory, lastResult }) {
  await ensureDirectory(allocatorDirectory);
  const prompt = tuningAllocatorPrompt(packet, lastResult);
  const savedPath = path.join(slotDirectory, "allocator-message.json");
  const saved = await readJsonIfPresent(savedPath);
  if (saved?.promptHash === sha256(prompt)) return saved;
  const result = await codexRunner.invokeWithRetries({
    cwd: allocatorDirectory,
    prompt,
    reasoning,
    schemaPath: schemas.tuningAllocator ?? schemas.allocator,
    sessionId,
    sandbox: "read-only",
  });
  const refs = await archivePromptAndResponse(slotDirectory, prompt, result);
  const allocatorSessionId = sessionId ?? result.threadId;
  let decision = null;
  let invalid = null;
  if (result.process.exitCode !== 0) {
    invalid = { reason: "allocator_model_failure", protocolViolation: false };
  } else if (codexToolEvents(result).length > 0) {
    invalid = { reason: "allocator_used_forbidden_tool", protocolViolation: true };
  } else {
    try {
      decision = parseStructuredMessage(result, "tuning allocator");
    } catch {
      invalid = { reason: "allocator_invalid_structured_output", protocolViolation: false };
    }
  }
  if (decision && !packet.candidates?.some((candidate) => candidate.candidateId === decision.candidateId)) {
    invalid = { reason: "allocator_selected_unknown_candidate", protocolViolation: false };
    decision = null;
  }
  const outcome = { decision, invalid, sessionId: allocatorSessionId, ...refs, usage: result.usage };
  await writeJson(savedPath, outcome);
  if (invalid) return outcome;
  await writeJson(path.join(slotDirectory, "decision.json"), {
    ...decision,
    ...refs,
    usage: result.usage,
    allocatorSessionId,
  });
  return outcome;
}

async function executeDecision({
  codexRunner,
  schemas,
  decision,
  baseArtifact,
  blockDirectory,
  slotDirectory,
  scorer,
  harnessSuffix,
  reasoning,
}) {
  const workspace = path.join(slotDirectory, "workspace");
  await copySource(baseArtifact.path, workspace);
  const source = await fs.readFile(path.join(workspace, PRODUCT_REGISTER), "utf8");
  const markerOffset = source.indexOf(HARNESS_MARKER);
  if (markerOffset < 0) throw new Error(`protected harness marker missing from ${PRODUCT_REGISTER}`);
  const prompt = executorPrompt(decision, source.slice(0, markerOffset + HARNESS_MARKER.length));
  const savedPath = path.join(slotDirectory, "executor-message.json");
  const saved = await readJsonIfPresent(savedPath);
  let executorMessage;
  let refs;
  let usage;
  if (saved?.promptHash === sha256(prompt)) {
    if (saved.invalid) {
      return {
        ...saved.invalid,
        promptHash: saved.promptHash,
        responseHash: saved.responseHash,
        attempts: saved.attempts,
        usage: saved.usage,
      };
    }
    executorMessage = saved.executorMessage;
    refs = { promptHash: saved.promptHash, responseHash: saved.responseHash, attempts: saved.attempts };
    usage = saved.usage;
  } else {
    const result = await codexRunner.invokeWithRetries({
      cwd: workspace,
      prompt,
      reasoning,
      schemaPath: schemas.executor,
      ephemeral: true,
      sandbox: "read-only",
    });
    refs = await archivePromptAndResponse(slotDirectory, prompt, result);
    usage = result.usage;
    let invalid = null;
    if (result.process.exitCode !== 0) {
      invalid = { validity: "invalid", reason: "executor_model_failure", protocolViolation: false, ...refs, usage };
    } else if (codexToolEvents(result).length > 0) {
      invalid = { validity: "invalid", reason: "executor_used_forbidden_tool", protocolViolation: true, ...refs, usage };
    } else {
      try {
        executorMessage = parseStructuredMessage(result, "executor");
      } catch {
        invalid = { validity: "invalid", reason: "executor_invalid_structured_output", protocolViolation: false, ...refs, usage };
      }
    }
    await writeJson(savedPath, { executorMessage, invalid, ...refs, usage });
    if (invalid) return invalid;
  }
  if (executorMessage.status !== "implemented" || executorMessage.replacements.length === 0) {
    return { validity: "invalid", reason: "no_patch", executorMessage, ...refs, usage };
  }
  if ((await changedFiles(workspace)).length > 0) {
    return { validity: "invalid", reason: "executor_touched_workspace", executorMessage, ...refs, usage };
  }
  let candidate;
  try {
    candidate = applyExactReplacements(source, executorMessage.replacements);
  } catch (error) {
    return {
      validity: "invalid",
      reason: "replacement_did_not_apply",
      replacementError: error.message,
      executorMessage,
      ...refs,
      usage,
    };
  }
  await atomicWrite(path.join(workspace, PRODUCT_REGISTER), candidate);
  const integrity = await checkCandidateIntegrity(workspace, harnessSuffix);
  if (!integrity.valid) {
    return { validity: "invalid", reason: integrity.reason, integrity, executorMessage, ...refs, usage };
  }
  const diff = await checkedProcess("git", ["diff", "--binary", "HEAD"], { cwd: workspace });
  await atomicWrite(path.join(slotDirectory, "candidate.patch"), diff.stdout);
  const scoring = await scorer.twice(workspace, path.join(slotDirectory, "target"));
  await writeJson(path.join(slotDirectory, "scoring.json"), scoring);
  if (scoring.validity !== "valid") {
    return { validity: "invalid", reason: scoring.reason, integrity, scoring, executorMessage, ...refs, usage };
  }
  const artifact = await archiveArtifact(workspace, blockDirectory);
  await atomicWrite(path.join(slotDirectory, "candidate.diff"), diff.stdout);
  return {
    validity: "valid",
    reason: null,
    candidateArtifactId: artifact.artifactId,
    candidatePath: artifact.path,
    score: scoring.score,
    integrity,
    executorMessage,
    ...refs,
    usage,
  };
}

function evidenceFromRecord(record) {
  return {
    evaluationId: record.evaluationId,
    baseArtifactId: record.baseArtifactId,
    candidateArtifactId: record.candidateArtifactId,
    interventionFamily: record.interventionFamily,
    hypothesis: record.hypothesis,
    falsifier: record.falsifier,
    validity: record.validity,
    protocolViolation: record.protocolViolation,
    score: record.score,
    rationale: record.rationale,
    planUpdate: record.planUpdate,
  };
}

function tuningEvidenceFromRecord(record) {
  return {
    evaluationId: record.evaluationId,
    baseArtifactId: record.baseArtifactId,
    candidateArtifactId: record.candidateArtifactId ?? null,
    candidateId: record.candidateId ?? null,
    configuration: record.configuration ?? null,
    interventionFamily: record.interventionFamily,
    hypothesis: record.hypothesis,
    falsifier: record.falsifier,
    validity: record.validity,
    protocolViolation: record.protocolViolation ?? false,
    score: record.score,
    rationale: record.rationale,
    planUpdate: record.planUpdate,
  };
}

function tuningPacketState({ baseline, evidence, remainingEvaluations, incumbentPlan }) {
  const used = new Set(evidence.map((record) => record.candidateId).filter(Boolean));
  return {
    forkArtifactId: baseline.artifactId,
    frontier: [{ artifactId: baseline.artifactId, score: baseline.score.score }],
    evidence,
    alternatives: TUNING_ALTERNATIVES,
    candidates: TUNING_CANDIDATES.filter((candidate) => !used.has(candidate.candidateId)),
    remainingEvaluations,
    incumbentPlan,
    task: "Choose one carry-ladder configuration for the fixed product-square self-test. The host will set SUB4_SQUARE_CHUNK_MIN=200 and the selected SUB4_SQUARE_LADDER, execute the deterministic self-test twice, and minimize executed Toffoli multiplied by peak qubits.",
    contract: {
      environment: {
        SUB4_SQUARE_CHUNK_MIN: String(TUNING_BASELINE.chunkMin),
        SUB4_SQUARE_LADDER: "selected candidate ladder",
        SUB4_PRODUCT_SQUARE_SELFTEST: "1",
      },
      endpoint: "best valid executed Toffoli multiplied by peak qubits, reproduced exactly twice",
      remainingEvaluations,
    },
  };
}

function packetState({ forkArtifactId, frontier, evidence, remainingEvaluations, incumbentPlan }) {
  const families = new Map();
  for (const record of evidence) {
    if (!families.has(record.interventionFamily)) {
      families.set(record.interventionFamily, {
        id: `alternative-${families.size + 1}`,
        interventionFamily: record.interventionFamily,
        hypothesis: record.hypothesis,
        falsifier: record.falsifier,
      });
    }
  }
  if (families.size === 0) {
    families.set("baseline", {
      id: "alternative-1",
      interventionFamily: "measure the current square construction",
      hypothesis: "a targeted local rewrite can reduce the primary endpoint",
      falsifier: "the duplicate host score does not improve",
    });
  }
  return {
    forkArtifactId,
    frontier: frontier.map((artifact) => ({ artifactId: artifact.artifactId, score: artifact.score.score })),
    evidence,
    alternatives: [...families.values()],
    remainingEvaluations,
    incumbentPlan,
  };
}

async function runEvaluation({
  phase,
  condition,
  index,
  sessionId,
  frontier,
  evidence,
  forkArtifactId,
  incumbentPlan,
  allocatorDirectory,
  blockDirectory,
  codexRunner,
  scorer,
  schemas,
  harnessSuffix,
}) {
  const slotDirectory = phase === "prelude"
    ? path.join(blockDirectory, "prelude", String(index))
    : path.join(blockDirectory, "conditions", condition, String(index));
  const recordPath = path.join(slotDirectory, "record.json");
  const existing = await readJsonIfPresent(recordPath);
  if (existing) return { record: existing, sessionId: existing.allocatorSessionId, artifact: existing.candidateArtifactId ? {
    artifactId: existing.candidateArtifactId,
    path: existing.candidatePath,
    validity: existing.validity,
    score: existing.score,
  } : null };
  await ensureDirectory(slotDirectory);
  const total = phase === "prelude" ? PRELUDE_EVALUATIONS : ARM_EVALUATIONS;
  const state = packetState({
    forkArtifactId,
    frontier,
    evidence,
    remainingEvaluations: total - index,
    incumbentPlan,
  });
  const packet = phase === "prelude"
    ? { ...compileConditionPacket("A", state), condition: "shared prelude" }
    : compileConditionPacket(condition, state);
  await writeJson(path.join(slotDirectory, "packet.json"), packet);
  const lastResult = evidence.at(-1) ?? null;
  const expectedPromptHash = sha256(allocatorPrompt(packet, lastResult));
  const savedDecision = await readJsonIfPresent(path.join(slotDirectory, "decision.json"));
  const decisionResult = savedDecision?.promptHash === expectedPromptHash
    ? { decision: savedDecision, sessionId: savedDecision.allocatorSessionId }
    : await decide({
      codexRunner,
      schemas,
      allocatorDirectory,
      packet,
      sessionId,
      reasoning: phase === "prelude" ? "high" : "medium",
      slotDirectory,
      lastResult,
    });
  if (decisionResult.invalid) {
    const record = {
      protocolVersion: PROTOCOL_VERSION,
      evaluationId: `${phase}-${condition}-${index}`,
      phase,
      condition,
      index,
      allocatorSessionId: decisionResult.sessionId,
      baseArtifactId: null,
      interventionFamily: "decision failure",
      hypothesis: "The allocator must return one admissible branch.",
      falsifier: "No admissible structured branch is returned.",
      rationale: decisionResult.invalid.reason,
      planUpdate: incumbentPlan,
      validity: "invalid",
      protocolViolation: decisionResult.invalid.protocolViolation,
      reason: decisionResult.invalid.reason,
      candidateArtifactId: null,
      candidatePath: null,
      score: null,
      promptHash: decisionResult.promptHash,
      responseHash: decisionResult.responseHash,
      createdAt: nowIso(),
    };
    await writeJson(recordPath, record);
    return { record, sessionId: decisionResult.sessionId, artifact: null };
  }
  if (!packet.frontier.some((artifact) => artifact.artifactId === decisionResult.decision.baseArtifactId)) {
    throw new Error(`saved allocator decision selected unavailable artifact ${decisionResult.decision.baseArtifactId}`);
  }
  const baseArtifact = frontier.find((artifact) => artifact.artifactId === decisionResult.decision.baseArtifactId);
  const execution = await executeDecision({
    codexRunner,
    schemas,
    decision: decisionResult.decision,
    baseArtifact,
    blockDirectory,
    slotDirectory,
    scorer,
    harnessSuffix,
    reasoning: phase === "prelude" ? "high" : "medium",
  });
  const record = {
    protocolVersion: PROTOCOL_VERSION,
    evaluationId: `${phase}-${condition}-${index}`,
    phase,
    condition,
    index,
    allocatorSessionId: decisionResult.sessionId,
    baseArtifactId: decisionResult.decision.baseArtifactId,
    interventionFamily: decisionResult.decision.interventionFamily,
    hypothesis: decisionResult.decision.hypothesis,
    falsifier: decisionResult.decision.falsifier,
    rationale: decisionResult.decision.rationale,
    planUpdate: decisionResult.decision.planUpdate,
    validity: execution.validity,
    protocolViolation: execution.protocolViolation ?? false,
    reason: execution.reason,
    candidateArtifactId: execution.candidateArtifactId ?? null,
    candidatePath: execution.candidatePath ?? null,
    score: execution.score ?? null,
    promptHash: execution.promptHash ?? null,
    responseHash: execution.responseHash ?? null,
    createdAt: nowIso(),
  };
  await writeJson(recordPath, record);
  return {
    record,
    sessionId: decisionResult.sessionId,
    artifact: execution.validity === "valid" ? {
      artifactId: execution.candidateArtifactId,
      path: execution.candidatePath,
      validity: "valid",
      score: execution.score,
    } : null,
  };
}

export async function runBlock({
  blockId,
  runDirectory,
  baselineArtifact,
  codexRunner,
  scorer,
  schemas,
  harnessSuffix,
}) {
  const blockDirectory = path.join(runDirectory, "blocks", blockId);
  const resultPath = path.join(blockDirectory, "result.json");
  const existing = await readJsonIfPresent(resultPath);
  if (existing) return existing;
  await ensureDirectory(blockDirectory);
  const blockBaseline = await archiveArtifact(baselineArtifact.path, blockDirectory);
  const baseline = {
    artifactId: blockBaseline.artifactId,
    path: blockBaseline.path,
    validity: "valid",
    score: baselineArtifact.score,
  };
  const preludeFrontier = [baseline];
  const preludeEvidence = [];
  let preludeSessionId = null;
  let incumbentPlan = "Test one atomic square-construction hypothesis at a time.";
  const preludeAllocatorDirectory = path.join(blockDirectory, "allocators", "prelude");
  for (let index = 0; index < PRELUDE_EVALUATIONS; index += 1) {
    const outcome = await runEvaluation({
      phase: "prelude",
      condition: "P",
      index,
      sessionId: preludeSessionId,
      frontier: preludeFrontier,
      evidence: preludeEvidence,
      forkArtifactId: baseline.artifactId,
      incumbentPlan,
      allocatorDirectory: preludeAllocatorDirectory,
      blockDirectory,
      codexRunner,
      scorer,
      schemas,
      harnessSuffix,
    });
    preludeSessionId = outcome.sessionId;
    incumbentPlan = outcome.record.planUpdate;
    preludeEvidence.push(evidenceFromRecord(outcome.record));
    if (outcome.artifact) preludeFrontier.push(outcome.artifact);
  }
  const forkArtifact = bestValidArtifact(preludeFrontier);
  const runCondition = async (condition) => {
    const frontier = [...preludeFrontier];
    const evidence = [...preludeEvidence];
    let sessionId = condition === "A" ? preludeSessionId : null;
    const allocatorDirectory = condition === "A"
      ? preludeAllocatorDirectory
      : path.join(blockDirectory, "allocators", condition);
    for (let index = 0; index < ARM_EVALUATIONS; index += 1) {
      const outcome = await runEvaluation({
        phase: "condition",
        condition,
        index,
        sessionId,
        frontier,
        evidence,
        forkArtifactId: forkArtifact.artifactId,
        incumbentPlan,
        allocatorDirectory,
        blockDirectory,
        codexRunner,
        scorer,
        schemas,
        harnessSuffix,
      });
      sessionId = outcome.sessionId;
      evidence.push(evidenceFromRecord(outcome.record));
      if (outcome.artifact) frontier.push(outcome.artifact);
    }
    const postFork = evidence.slice(PRELUDE_EVALUATIONS);
    const best = bestValidArtifact(frontier);
    return {
      condition,
      evaluations: postFork.length,
      validEvaluations: postFork.filter((record) => record.validity === "valid").length,
      protocolViolations: postFork.filter((record) => record.protocolViolation).length,
      bestArtifactId: best.artifactId,
      bestScore: best.score.score,
      bestScoreComponents: best.score,
      distinctInterventionFamilies: [...new Set(postFork.map((record) => record.interventionFamily))].length,
    };
  };
  const conditionEntries = await Promise.all(Object.keys(CONDITION_DEFINITIONS).map(async (condition) => [
    condition,
    await runCondition(condition),
  ]));
  const conditions = Object.fromEntries(conditionEntries);
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    blockId,
    apparatusStatus: preludeEvidence.length === PRELUDE_EVALUATIONS
      && !preludeEvidence.some((record) => record.protocolViolation)
      && Object.values(conditions).every((condition) => (
        condition.evaluations === ARM_EVALUATIONS && condition.protocolViolations === 0
      ))
      ? "PASS"
      : "INVALID",
    baselineScore: baseline.score.score,
    forkArtifactId: forkArtifact.artifactId,
    forkScore: forkArtifact.score.score,
    conditions,
    pilotEffects: {
      h1: pairedImprovementPercent(conditions.A.bestScore, conditions.B.bestScore),
      h2: pairedImprovementPercent(conditions.C.bestScore, conditions.D.bestScore),
      product: pairedImprovementPercent(conditions.A.bestScore, conditions.D.bestScore),
      informationRemoval: pairedImprovementPercent(conditions.B.bestScore, conditions.C.bestScore),
    },
    completedAt: nowIso(),
  };
  await writeJson(resultPath, result);
  return result;
}

export async function runTuningEvaluation({
  phase,
  condition,
  index,
  sessionId,
  evidence,
  baselineArtifact,
  incumbentPlan,
  allocatorDirectory,
  blockDirectory,
  codexRunner,
  scorer,
  schemas,
}) {
  const slotDirectory = phase === "prelude"
    ? path.join(blockDirectory, "prelude", String(index))
    : path.join(blockDirectory, "conditions", condition, String(index));
  const recordPath = path.join(slotDirectory, "record.json");
  const existing = await readJsonIfPresent(recordPath);
  if (existing) return { record: existing, sessionId: existing.allocatorSessionId };
  await ensureDirectory(slotDirectory);
  const total = phase === "prelude" ? PRELUDE_EVALUATIONS : ARM_EVALUATIONS;
  const packetStateValue = tuningPacketState({
    baseline: baselineArtifact,
    evidence,
    remainingEvaluations: total - index,
    incumbentPlan,
  });
  const packet = phase === "prelude"
    ? { ...compileConditionPacket("A", packetStateValue), condition: "shared prelude" }
    : compileConditionPacket(condition, packetStateValue);
  await writeJson(path.join(slotDirectory, "packet.json"), packet);
  const lastResult = evidence.at(-1) ?? null;
  const decisionResult = await decideTuning({
    codexRunner,
    schemas,
    allocatorDirectory,
    packet,
    sessionId,
    reasoning: phase === "prelude" ? "high" : "medium",
    slotDirectory,
    lastResult,
  });
  if (decisionResult.invalid) {
    const record = {
      protocolVersion: PROTOCOL_VERSION,
      evaluationId: `${phase}-${condition}-${index}`,
      phase,
      condition,
      index,
      allocatorSessionId: decisionResult.sessionId,
      baseArtifactId: baselineArtifact.artifactId,
      candidateArtifactId: null,
      candidateId: null,
      configuration: null,
      interventionFamily: "decision failure",
      hypothesis: "The allocator must return one admissible tuning candidate.",
      falsifier: "No admissible structured candidate is returned.",
      rationale: decisionResult.invalid.reason,
      planUpdate: incumbentPlan,
      validity: "invalid",
      protocolViolation: decisionResult.invalid.protocolViolation,
      reason: decisionResult.invalid.reason,
      score: null,
      promptHash: decisionResult.promptHash,
      responseHash: decisionResult.responseHash,
      createdAt: nowIso(),
    };
    await writeJson(recordPath, record);
    return { record, sessionId: decisionResult.sessionId };
  }
  const decision = decisionResult.decision;
  const candidate = packet.candidates.find((item) => item.candidateId === decision.candidateId);
  if (!candidate) {
    const record = {
      protocolVersion: PROTOCOL_VERSION,
      evaluationId: `${phase}-${condition}-${index}`,
      phase,
      condition,
      index,
      allocatorSessionId: decisionResult.sessionId,
      baseArtifactId: baselineArtifact.artifactId,
      candidateArtifactId: null,
      candidateId: decision.candidateId ?? null,
      configuration: null,
      interventionFamily: "decision failure",
      hypothesis: decision.hypothesis,
      falsifier: decision.falsifier,
      rationale: "allocator selected a candidate that was no longer available",
      planUpdate: decision.planUpdate,
      validity: "invalid",
      protocolViolation: false,
      reason: "allocator_selected_unavailable_candidate",
      score: null,
      promptHash: decisionResult.promptHash,
      responseHash: decisionResult.responseHash,
      createdAt: nowIso(),
    };
    await writeJson(recordPath, record);
    return { record, sessionId: decisionResult.sessionId };
  }
  const configuration = {
    SUB4_SQUARE_CHUNK_MIN: candidate.chunkMin,
    SUB4_SQUARE_LADDER: candidate.ladder,
  };
  const workspace = path.join(slotDirectory, "workspace");
  await copySource(baselineArtifact.path, workspace);
  const scoringInput = Object.fromEntries(Object.entries(configuration).map(([key, value]) => [key, String(value)]));
  const savedScoring = await readJsonIfPresent(path.join(slotDirectory, "scoring.json"));
  const scoring = savedScoring?.configuration
    && canonicalStringify(savedScoring.configuration) === canonicalStringify(configuration)
    ? savedScoring
    : await scorer.twice(workspace, path.join(slotDirectory, "target"), scoringInput);
  await writeJson(path.join(slotDirectory, "scoring.json"), { ...scoring, configuration });
  const record = {
    protocolVersion: PROTOCOL_VERSION,
    evaluationId: `${phase}-${condition}-${index}`,
    phase,
    condition,
    index,
    allocatorSessionId: decisionResult.sessionId,
    baseArtifactId: baselineArtifact.artifactId,
    candidateArtifactId: `config-${candidate.candidateId}`,
    candidateId: candidate.candidateId,
    configuration,
    interventionFamily: candidate.region,
    hypothesis: decision.hypothesis,
    falsifier: decision.falsifier,
    rationale: decision.rationale,
    planUpdate: decision.planUpdate,
    validity: scoring.validity,
    protocolViolation: false,
    reason: scoring.validity === "valid" ? null : scoring.reason,
    score: scoring.validity === "valid" ? scoring.score : null,
    scoring,
    promptHash: decisionResult.promptHash,
    responseHash: decisionResult.responseHash,
    createdAt: nowIso(),
  };
  await writeJson(recordPath, record);
  return { record, sessionId: decisionResult.sessionId };
}

export async function runTuningBlock({
  blockId,
  runDirectory,
  baselineArtifact,
  optimumScore = null,
  codexRunner,
  scorer,
  schemas,
}) {
  const blockDirectory = path.join(runDirectory, "blocks", blockId);
  const resultPath = path.join(blockDirectory, "result.json");
  const existing = await readJsonIfPresent(resultPath);
  if (existing) return existing;
  await ensureDirectory(blockDirectory);
  const preludeEvidence = [];
  let preludeSessionId = null;
  let incumbentPlan = "Measure the carry-ladder settings that most clearly distinguish the operation and qubit tradeoff.";
  const preludeAllocatorDirectory = path.join(blockDirectory, "allocators", "prelude");
  for (let index = 0; index < PRELUDE_EVALUATIONS; index += 1) {
    const outcome = await runTuningEvaluation({
      phase: "prelude",
      condition: "P",
      index,
      sessionId: preludeSessionId,
      evidence: preludeEvidence,
      baselineArtifact,
      incumbentPlan,
      allocatorDirectory: preludeAllocatorDirectory,
      blockDirectory,
      codexRunner,
      scorer,
      schemas,
    });
    preludeSessionId = outcome.sessionId;
    incumbentPlan = outcome.record.planUpdate || incumbentPlan;
    preludeEvidence.push(tuningEvidenceFromRecord(outcome.record));
  }
  const runCondition = async (condition) => {
    const evidence = [...preludeEvidence];
    let sessionId = condition === "A" ? preludeSessionId : null;
    const allocatorDirectory = condition === "A"
      ? preludeAllocatorDirectory
      : path.join(blockDirectory, "allocators", condition);
    for (let index = 0; index < ARM_EVALUATIONS; index += 1) {
      const outcome = await runTuningEvaluation({
        phase: "condition",
        condition,
        index,
        sessionId,
        evidence,
        baselineArtifact,
        incumbentPlan,
        allocatorDirectory,
        blockDirectory,
        codexRunner,
        scorer,
        schemas,
      });
      sessionId = outcome.sessionId;
      evidence.push(tuningEvidenceFromRecord(outcome.record));
    }
    const postFork = evidence.slice(PRELUDE_EVALUATIONS);
    const valid = [...preludeEvidence, ...postFork].filter((record) => record.validity === "valid" && record.score?.score > 0);
    const best = valid.reduce((bestRecord, record) => record.score.score < bestRecord.score.score ? record : bestRecord, {
      candidateId: TUNING_BASELINE.candidateId,
      score: baselineArtifact.score,
    });
    return {
      condition,
      evaluations: postFork.length,
      validEvaluations: postFork.filter((record) => record.validity === "valid").length,
      protocolViolations: postFork.filter((record) => record.protocolViolation).length,
      bestArtifactId: best.candidateId === TUNING_BASELINE.candidateId ? baselineArtifact.artifactId : `config-${best.candidateId}`,
      bestCandidateId: best.candidateId,
      bestScore: best.score.score,
      bestScoreComponents: best.score,
      distinctCandidates: new Set(postFork.map((record) => record.candidateId).filter(Boolean)).size,
      distinctInterventionFamilies: new Set(postFork.map((record) => record.interventionFamily)).size,
    };
  };
  const conditionEntries = await Promise.all(Object.keys(CONDITION_DEFINITIONS).map(async (condition) => [condition, await runCondition(condition)]));
  const conditions = Object.fromEntries(conditionEntries);
  const apparatusStatus = preludeEvidence.length === PRELUDE_EVALUATIONS
    && !preludeEvidence.some((record) => record.protocolViolation)
    && Object.values(conditions).every((condition) => condition.evaluations === ARM_EVALUATIONS && condition.protocolViolations === 0)
    ? "PASS"
    : "INVALID";
  const taskInformativeness = Number.isFinite(optimumScore)
    ? assessPilotInformativeness({ baselineScore: baselineArtifact.score.score, optimumScore, conditions })
    : null;
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    blockId,
    apparatusStatus,
    baselineScore: baselineArtifact.score.score,
    optimumScore,
    forkArtifactId: baselineArtifact.artifactId,
    forkScore: baselineArtifact.score.score,
    conditions,
    pilotEffects: {
      h1: pairedImprovementPercent(conditions.A.bestScore, conditions.B.bestScore),
      h2: pairedImprovementPercent(conditions.C.bestScore, conditions.D.bestScore),
      product: pairedImprovementPercent(conditions.A.bestScore, conditions.D.bestScore),
      informationRemoval: pairedImprovementPercent(conditions.B.bestScore, conditions.C.bestScore),
    },
    taskInformativeness,
    completedAt: nowIso(),
  };
  await writeJson(resultPath, result);
  return result;
}

async function mapConcurrent(values, limit, operation) {
  const semaphore = new Semaphore(limit);
  return Promise.all(values.map((value) => semaphore.use(() => operation(value))));
}

async function rejectInvalidBlocks(runDirectory, calibration, confirmatory = []) {
  const invalidBlocks = [...calibration, ...confirmatory]
    .filter((block) => block.apparatusStatus !== "PASS")
    .map((block) => block.blockId);
  if (invalidBlocks.length === 0) return;
  await writeJson(path.join(runDirectory, "result.json"), {
    protocolVersion: PROTOCOL_VERSION,
    runId: path.basename(runDirectory),
    apparatus: "INVALID",
    pilot: calibration[0] ?? null,
    calibration: calibration.map((block) => block.blockId),
    confirmatoryBlocks: confirmatory.length,
    invalidBlocks,
    proceedToLiveCourt: false,
  });
  throw new Error(`experiment contains invalid blocks: ${invalidBlocks.join(", ")}`);
}

function manifestFor(id) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: id,
    createdAt: nowIso(),
    repository: REPOSITORY_URL,
    searchCommit: SEARCH_COMMIT,
    positiveControlCommit: POSITIVE_CONTROL_COMMIT,
    model: MODEL,
    reasoning: {
      preludeAllocator: "high",
      postForkAllocator: "medium",
    },
    task: {
      name: "host-scored carry-ladder tuning search",
      baseline: TUNING_BASELINE,
      candidates: TUNING_CANDIDATES.length,
      modelCallsPerEvaluation: 1,
      scorerRepetitionsPerValidEvaluation: 2,
    },
    toolPolicy: { allocator: "none", hostScorer: "cargo only", canary: "shell only" },
    budgets: { prelude: PRELUDE_EVALUATIONS, perCondition: ARM_EVALUATIONS },
    timeoutsMs: { codex: 10 * 60_000, scorer: 15 * 60_000 },
    concurrency: { blocks: 2, codex: 8, scorers: 4 },
    conditions: CONDITION_DEFINITIONS,
    primaryContrasts: PRIMARY_CONTRASTS,
    calibrationBlocks: CALIBRATION_BLOCKS,
    confirmatoryCap: CONFIRMATORY_MAX_BLOCKS,
  };
}

async function environmentFingerprint() {
  const commands = {
    bun: ["bun", ["--version"]],
    cargo: ["cargo", ["--version"]],
    codex: ["codex", ["--version"]],
    git: ["git", ["--version"]],
    rustc: ["rustc", ["-Vv"]],
  };
  const entries = await Promise.all(Object.entries(commands).map(async ([name, [command, args]]) => {
    const result = await runProcess(command, args, { timeoutMs: 30_000 });
    return [name, {
      exitCode: result.exitCode,
      version: (result.stdout || result.stderr).trim(),
    }];
  }));
  const fingerprint = {
    platform: process.platform,
    architecture: process.arch,
    versions: Object.fromEntries(entries),
  };
  return { ...fingerprint, sha256: sha256(fingerprint) };
}

async function preflight(runDirectory, dependencies = {}) {
  await ensureDirectory(runDirectory);
  const manifestPath = path.join(runDirectory, "manifest.json");
  if (!(await pathExists(manifestPath))) await writeJson(manifestPath, manifestFor(path.basename(runDirectory)));
  const schemas = dependencies.schemas ?? await writeSchemas(runDirectory);
  const environment = await environmentFingerprint();
  await writeJson(path.join(runDirectory, "preflight", "environment.json"), environment);
  const codexRunner = dependencies.codexRunner ?? new CodexRunner();
  const hostScorer = dependencies.scorer ?? new HostScorer();
  const isolation = await runIsolationCanary({ runDirectory, codexRunner, schemas });
  if (isolation.status !== "PASS") {
    const report = { status: "INVALID", environment, isolation, scorer: null };
    await writeJson(path.join(runDirectory, "preflight", "report.json"), report);
    return { ...report, schemas };
  }
  const scorerResult = await runScorerPreflight({ runDirectory, scorer: hostScorer });
  const status = scorerResult.report.status === "PASS" ? "PASS" : "INVALID";
  const report = { status, environment, isolation, scorer: scorerResult.report };
  await writeJson(path.join(runDirectory, "preflight", "report.json"), report);
  if (status !== "PASS") return { ...report, schemas };
  return {
    ...report,
    baseline: scorerResult.baseline,
    taskBaseline: scorerResult.taskBaseline,
    schemas,
    codexRunner,
    hostScorer,
    scorerReport: scorerResult.report,
  };
}

async function baselineArtifactFromPreflight(runDirectory) {
  const report = await readJson(path.join(runDirectory, "preflight", "host-scorer.json"));
  return {
    artifactId: report.source.digest,
    path: path.join(runDirectory, "preflight", "source-51c6c31"),
    validity: "valid",
    score: report.task.baseline.score,
  };
}

async function fullRun(runDirectory) {
  const admission = await preflight(runDirectory);
  if (admission.status !== "PASS") throw new Error("preflight failed; see the PASS/FAIL report");
  const baselineArtifact = {
    artifactId: admission.scorerReport.source.digest,
    path: admission.baseline.path,
    validity: "valid",
    score: admission.scorerReport.task.baseline.score,
  };
  const calibrationIds = Array.from({ length: CALIBRATION_BLOCKS }, (_, index) => `calibration-${index}`);
  const calibration = [];
  calibration.push(await runTuningBlock({
    blockId: calibrationIds[0],
    runDirectory,
    baselineArtifact,
    optimumScore: admission.scorerReport.task.landscape.bestScore,
    codexRunner: admission.codexRunner,
    scorer: admission.hostScorer,
    schemas: admission.schemas,
  }));
  if (calibration[0].apparatusStatus !== "PASS" || calibration[0].taskInformativeness?.status !== "PASS") {
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      runId: path.basename(runDirectory),
      apparatus: calibration[0].apparatusStatus === "PASS" ? "TASK_UNINFORMATIVE" : "INVALID",
      pilot: calibration[0],
      calibration: [calibration[0].blockId],
      confirmatoryBlocks: 0,
      proceedToLiveCourt: false,
      correction: calibration[0].taskInformativeness?.status === "TASK_TOO_EASY"
        ? "expand the tuning landscape or increase the budget"
        : calibration[0].taskInformativeness?.status === "TASK_TOO_HARD"
          ? "choose a task with reachable minimum-meaningful improvements"
          : calibration[0].taskInformativeness?.status === "NO_CONDITION_SEPARATION"
            ? "change the task or handoff packet so conditions can make different choices"
            : "inspect pilot slot records",
    };
    await writeJson(path.join(runDirectory, "result.json"), result);
    return result;
  }
  await rejectInvalidBlocks(runDirectory, calibration);
  calibration.push(...await mapConcurrent(calibrationIds.slice(1), 2, (blockId) => runTuningBlock({
    blockId,
    runDirectory,
    baselineArtifact,
    optimumScore: admission.scorerReport.task.landscape.bestScore,
    codexRunner: admission.codexRunner,
    scorer: admission.hostScorer,
    schemas: admission.schemas,
  })));
  await rejectInvalidBlocks(runDirectory, calibration);
  const calibrationByContrast = Object.fromEntries(
    Object.keys(PRIMARY_CONTRASTS).map((key) => [key, contrastDifferences(calibration, key)]),
  );
  const power = estimateConfirmatoryBlocks(calibrationByContrast, { seed: path.basename(runDirectory) });
  await writeJson(path.join(runDirectory, "power.json"), power);
  const confirmatoryIds = Array.from({ length: power.blocks }, (_, index) => `confirmatory-${index}`);
  const confirmatory = await mapConcurrent(confirmatoryIds, 2, (blockId) => runTuningBlock({
    blockId,
    runDirectory,
    baselineArtifact,
    optimumScore: admission.scorerReport.task.landscape.bestScore,
    codexRunner: admission.codexRunner,
    scorer: admission.hostScorer,
    schemas: admission.schemas,
  }));
  await rejectInvalidBlocks(runDirectory, calibration, confirmatory);
  const analysis = analyzeConfirmatoryBlocks(confirmatory, { seed: path.basename(runDirectory) });
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    runId: path.basename(runDirectory),
    apparatus: "PASS",
    pilot: calibration[0],
    calibration: calibration.map((block) => block.blockId),
    power,
    confirmatoryBlocks: confirmatory.length,
    ...analysis,
  };
  await writeJson(path.join(runDirectory, "result.json"), result);
  return result;
}

async function resumeRun(runDirectory) {
  const manifest = await readJsonIfPresent(path.join(runDirectory, "manifest.json"));
  if (manifest?.protocolVersion && manifest.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`cannot resume retired protocol ${manifest.protocolVersion}; start a new v2 tuning-search run`);
  }
  const completed = await readJsonIfPresent(path.join(runDirectory, "result.json"));
  if (completed) return completed;
  const preflightReport = await readJsonIfPresent(path.join(runDirectory, "preflight", "report.json"));
  if (!preflightReport || preflightReport.status !== "PASS") return fullRun(runDirectory);
  const baselineArtifact = await baselineArtifactFromPreflight(runDirectory);
  const schemas = await writeSchemas(runDirectory);
  const codexRunner = new CodexRunner();
  const scorer = new HostScorer({ templateDirectory: preflightReport.scorer?.buildCache?.templateDirectory });
  const calibrationIds = Array.from({ length: CALIBRATION_BLOCKS }, (_, index) => `calibration-${index}`);
  const calibration = [];
  calibration.push(await runTuningBlock({
    blockId: calibrationIds[0],
    runDirectory,
    baselineArtifact,
    optimumScore: preflightReport.scorer.task.landscape.bestScore,
    codexRunner,
    scorer,
    schemas,
  }));
  if (calibration[0].apparatusStatus !== "PASS" || calibration[0].taskInformativeness?.status !== "PASS") {
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      runId: path.basename(runDirectory),
      apparatus: calibration[0].apparatusStatus === "PASS" ? "TASK_UNINFORMATIVE" : "INVALID",
      pilot: calibration[0],
      calibration: [calibration[0].blockId],
      confirmatoryBlocks: 0,
      proceedToLiveCourt: false,
      correction: "inspect the pilot task-informativeness gate",
    };
    await writeJson(path.join(runDirectory, "result.json"), result);
    return result;
  }
  await rejectInvalidBlocks(runDirectory, calibration);
  for (const blockId of calibrationIds.slice(1)) {
    calibration.push(await runTuningBlock({
      blockId,
      runDirectory,
      baselineArtifact,
      optimumScore: preflightReport.scorer.task.landscape.bestScore,
      codexRunner,
      scorer,
      schemas,
    }));
    await rejectInvalidBlocks(runDirectory, calibration);
  }
  const powerPath = path.join(runDirectory, "power.json");
  const power = await readJsonIfPresent(powerPath) ?? estimateConfirmatoryBlocks(
    Object.fromEntries(Object.keys(PRIMARY_CONTRASTS).map((key) => [key, contrastDifferences(calibration, key)])),
    { seed: path.basename(runDirectory) },
  );
  await writeJson(powerPath, power);
  const confirmatory = await mapConcurrent(
    Array.from({ length: power.blocks }, (_, index) => `confirmatory-${index}`),
    2,
    (blockId) => runTuningBlock({
      blockId,
      runDirectory,
      baselineArtifact,
      optimumScore: preflightReport.scorer.task.landscape.bestScore,
      codexRunner,
      scorer,
      schemas,
    }),
  );
  await rejectInvalidBlocks(runDirectory, calibration, confirmatory);
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    runId: path.basename(runDirectory),
    apparatus: "PASS",
    pilot: calibration[0],
    calibration: calibration.map((block) => block.blockId),
    power,
    confirmatoryBlocks: confirmatory.length,
    ...analyzeConfirmatoryBlocks(confirmatory, { seed: path.basename(runDirectory) }),
  };
  await writeJson(path.join(runDirectory, "result.json"), result);
  return result;
}

function passFailMatrix(runDirectory, preflightReport, result) {
  function correctionForComparison(comparison) {
    if (comparison.verdict === "SUPPORTED") return "none";
    if (comparison.verdict === "NOT_SUPPORTED_AT_MDE") return "do not promote this mechanism";
    return "increase independent blocks only under a new preregistered protocol";
  }

  const rows = [
    {
      area: "Codex isolation",
      verdict: preflightReport?.isolation?.status ?? "NOT_RUN",
      correction: preflightReport?.isolation?.corrections?.join("; ") || "none",
    },
    {
      area: "Host scorer",
      verdict: preflightReport?.scorer?.status ?? "NOT_RUN",
      correction: preflightReport?.scorer?.corrections?.join("; ") || "none",
    },
    {
      area: "Task informativeness",
      verdict: result?.pilot?.taskInformativeness?.status
        ?? preflightReport?.scorer?.task?.landscape?.status
        ?? "NOT_RUN",
      correction: result?.correction
        ?? preflightReport?.scorer?.task?.landscape?.corrections?.join("; ")
        ?? "none",
    },
    {
      area: "Pilot apparatus",
      verdict: result?.pilot?.apparatusStatus ?? "NOT_RUN",
      correction: result?.pilot?.apparatusStatus === "INVALID" ? "inspect the pilot slot records" : "none",
    },
    {
      area: "Complete block integrity",
      verdict: result?.apparatus ?? "NOT_RUN",
      correction: result?.apparatus === "INVALID"
        ? `inspect invalid blocks: ${(result.invalidBlocks ?? []).join(", ")}`
        : "none",
    },
    ...Object.entries(result?.comparisons ?? {}).map(([key, comparison]) => ({
      area: comparison.label ?? key,
      verdict: comparison.verdict,
      correction: correctionForComparison(comparison),
    })),
  ];
  return { runDirectory, rows, proceedToLiveCourt: result?.proceedToLiveCourt ?? false };
}

async function reportRun(runDirectory) {
  const manifest = await readJsonIfPresent(path.join(runDirectory, "manifest.json"));
  if (manifest?.protocolVersion && manifest.protocolVersion !== PROTOCOL_VERSION) {
    const pilot = await readJsonIfPresent(path.join(runDirectory, "blocks", "calibration-0", "result.json"));
    return {
      runDirectory,
      protocolVersion: manifest.protocolVersion,
      rows: [
        {
          area: "Retired source-mutation pilot",
          verdict: "TASK_UNINFORMATIVE",
          correction: "Do not use this run as evidence for or against the handoff; use a new protocol-v2 tuning-search run.",
        },
        {
          area: "Historical mechanical checks",
          verdict: pilot?.apparatusStatus ?? "NOT_RUN",
          correction: "A mechanical pass did not establish that the old task could distinguish allocation quality.",
        },
      ],
      proceedToLiveCourt: false,
    };
  }
  const preflightReport = await readJsonIfPresent(path.join(runDirectory, "preflight", "report.json"));
  const result = await readJsonIfPresent(path.join(runDirectory, "result.json"));
  const pilot = result?.pilot ?? await readJsonIfPresent(path.join(runDirectory, "blocks", "calibration-0", "result.json"));
  const reportResult = (result || pilot) ? { ...(result ?? {}), pilot } : null;
  return passFailMatrix(runDirectory, preflightReport, reportResult);
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
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  await ensureDirectory(RUNS_ROOT);
  if (command === "preflight") {
    const newId = runId();
    const directory = path.join(RUNS_ROOT, newId);
    const result = await preflight(directory);
    console.log(canonicalStringify({ runId: newId, runDirectory: directory, status: result.status }));
    if (result.status !== "PASS") process.exitCode = 1;
    return;
  }
  if (command === "run") {
    const newId = runId();
    const directory = path.join(RUNS_ROOT, newId);
    const result = await fullRun(directory);
    console.log(canonicalStringify({ runId: newId, runDirectory: directory, result }));
    return;
  }
  if (!id || !/^[A-Za-z0-9_.:-]+$/u.test(id)) throw new Error(`${command} requires a valid run id`);
  const directory = path.join(RUNS_ROOT, id);
  if (!(await pathExists(directory))) throw new Error(`run does not exist: ${id}`);
  const result = command === "resume" ? await resumeRun(directory) : await reportRun(directory);
  console.log(canonicalStringify(result));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

export {
  ALLOCATOR_SCHEMA,
  CANARY_SCHEMA,
  EXECUTOR_SCHEMA,
  TUNING_ALLOCATOR_SCHEMA,
  WORKER_CANARY_SCHEMA,
  ROOT,
  RUNS_ROOT,
  checkCandidateIntegrity,
  codexConfigArguments,
  extractCodexResult,
  findSkillDirectories,
  fullRun,
  materializeCommit,
  preflight,
  reportRun,
  resumeRun,
  sealedHarnessSuffix,
};
