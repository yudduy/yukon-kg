#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(ROOT, "third_party", "dungeness");
const PIN_PATH = join(ROOT, "third_party", "dungeness.pin.json");
const REPO_URL = "https://github.com/Layr-Labs/dungeness.git";

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim()
    || process.env.GH_TOKEN?.trim()
    || process.env.YUDDUY_GITHUB_TOKEN?.trim()
    || "";
}

function authenticatedUrl(url, token) {
  if (!token) return url;
  const parsed = new URL(url);
  parsed.username = "x-access-token";
  parsed.password = token;
  return parsed.href;
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
  });
}

export async function inspectDungenessCheckout(directory = VENDOR_DIR) {
  if (!existsSync(directory)) {
    return { present: false, kind: "missing", directory, signals: [] };
  }
  const signals = [];
  const files = ["Cargo.toml", "package.json", "pyproject.toml", "README.md", "src/point_add", "eval", "harness"];
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
  return { present: true, kind, directory, signals, sha, branch };
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
  await run("git", ["clone", "--depth", "1", authenticatedUrl(REPO_URL, token), VENDOR_DIR]);
  const inspection = await inspectDungenessCheckout(VENDOR_DIR);
  const pin = {
    schema: "yukon-kg.dungeness-vendor-pin.v1",
    repo: REPO_URL,
    sha: inspection.sha,
    branch: inspection.branch,
    kind: inspection.kind,
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
