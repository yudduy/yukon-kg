#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sha256 } from "./protocol.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(ROOT, "third_party", "dungeness");
const PIN_PATH = join(ROOT, "third_party", "dungeness.pin.json");
const REPO_URL = "https://github.com/Layr-Labs/dungeness.git";
const ADAPTER_CANDIDATES = [
  "dungeness.adapter.json",
  ".dungeness/adapter.json",
  "yukon.adapter.json",
];

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim()
    || process.env.GH_TOKEN?.trim()
    || process.env.YUDDUY_GITHUB_TOKEN?.trim()
    || "";
}

function run(command, args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
    });
  });
}

function gitAuthenticationEnvironment(token) {
  if (!token) return {};
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}

export async function inspectDungenessCheckout(directory = VENDOR_DIR) {
  if (!existsSync(directory)) {
    return { present: false, kind: "missing", directory, signals: [] };
  }
  const signals = [];
  const files = [
    "Cargo.toml",
    "package.json",
    "pyproject.toml",
    "README.md",
    "src/point_add",
    "eval",
    "harness",
    ...ADAPTER_CANDIDATES,
  ];
  for (const relative of files) {
    if (existsSync(join(directory, relative))) signals.push(relative);
  }
  let kind = "unknown";
  if (signals.includes("Cargo.toml") || signals.includes("src/point_add")) kind = "evaluator";
  else if (signals.includes("package.json") || signals.includes("pyproject.toml")) kind = "harness";
  let sha = null;
  let branch = null;
  try {
    sha = (await run("git", ["rev-parse", "HEAD"], { cwd: directory })).stdout.trim();
    branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: directory })).stdout.trim();
  } catch {
    sha = null;
  }
  const adapterPath = ADAPTER_CANDIDATES.find((relative) => signals.includes(relative)) ?? null;
  const adapterSha256 = adapterPath === null
    ? null
    : sha256(await readFile(join(directory, adapterPath), "utf8"));
  return { present: true, kind, directory, signals, sha, branch, adapterPath, adapterSha256 };
}

export async function cloneDungeness({ token = githubToken(), force = false } = {}) {
  await mkdir(join(ROOT, "third_party"), { recursive: true });
  if (existsSync(join(VENDOR_DIR, ".git")) && !force) {
    const inspection = await inspectDungenessCheckout(VENDOR_DIR);
    return { status: "already_present", ...inspection };
  }
  if (!token) {
    return {
      status: "blocked",
      present: false,
      reason: "GITHUB_TOKEN is required to clone Layr-Labs/dungeness as yudduy. The default cloud token is GitHub user cursor and cannot see that repo.",
      repo: REPO_URL,
    };
  }
  await run("git", ["clone", REPO_URL, VENDOR_DIR], {
    env: gitAuthenticationEnvironment(token),
  });
  const inspection = await inspectDungenessCheckout(VENDOR_DIR);
  const pin = {
    schema: "yukon-kg.dungeness-vendor-pin.v1",
    repo: REPO_URL,
    sha: inspection.sha,
    branch: inspection.branch,
    kind: inspection.kind,
    adapterPath: inspection.adapterPath,
    adapterSha256: inspection.adapterSha256,
    clonedAt: new Date().toISOString(),
  };
  await writeFile(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
  return { status: "cloned", pin, ...inspection };
}

export async function readDungenessPin() {
  try {
    return JSON.parse(await readFile(PIN_PATH, "utf8"));
  } catch {
    return null;
  }
}

if (import.meta.main) {
  cloneDungeness({ force: process.argv.includes("--force") }).then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}
