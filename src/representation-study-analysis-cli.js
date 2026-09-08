#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analysisSha256,
  analyzeRepresentationStudy,
  canonicalAnalysisJson,
  selectConfirmatoryTasks,
} from "./representation-study-analysis.js";

const HELP = `Usage:
  bun run representation:analyze -- analyze --tasks FILE --results FILE --assignments FILE --phase pilot|confirmatory [options]
  bun run representation:analyze -- select-confirmatory --pool FILE [--seed TEXT]

The analyzer is model-free and read-only. It validates the blinded Dungeness
export before joining the separately supplied host assignment, then computes
frozen outcomes and decisions. It never starts pilot replication or confirmation.

analyze inputs:
  --tasks       yukon.representation-task-references.v2 or v3 JSON
  --results     Dungeness blinded-randomized-block-results JSON
  --assignments native Dungeness host manifest, or the Yukon wrapper below
  --phase       pilot or confirmatory

Options:
  --apparatus-gates-passed true|false  Default false
  --protocol-violations N              Default 0
  --bootstrap-draws N                  Default 10000
  --permutation-draws N                Default 100000; confirmatory only
  --alpha NUMBER                       Default 0.05
  --seed TEXT                          Frozen deterministic analysis seed
  --output FILE                        Create an immutable JSON result file

select-confirmatory requires an exact treatment-blind 18-task pool. It selects
four tasks per category only from the seven declared eligibility gates using a
frozen SHA-256 rank. Ineligible pools produce no partial selection.

For classified failures, use yukon.representation-host-assignment.v1 with the
native manifest under "assignment" and a "failureClassifications" array. Each
classification must bind its opaque cell ID and category/code to the exact
blinded-results SHA-256 before the analyzer joins treatment assignments.
`;

function parseArgs(argv) {
  if (argv.length === 0 || ["--help", "-h", "help"].includes(argv[0])) return { command: "help", options: {} };
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (["--help", "-h"].includes(key)) return { command: "help", options: {} };
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} requires a value`);
    const name = key.slice(2);
    if (options[name] !== undefined) throw new Error(`duplicate option: ${key}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function requireOptions(options, names) {
  for (const name of names) {
    if (options[name] === undefined) throw new Error(`--${name} is required`);
  }
}

function assertKnownOptions(options, names) {
  const known = new Set(names);
  const unknown = Object.keys(options).filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown option(s): ${unknown.map((name) => `--${name}`).join(", ")}`);
}

function integerOption(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  const value = Number(options[name]);
  if (!Number.isInteger(value) || value < 0 || String(value) !== options[name]) {
    throw new Error(`--${name} must be a non-negative base-10 integer`);
  }
  return value;
}

function positiveIntegerOption(options, name, fallback) {
  const value = integerOption(options, name, fallback);
  if (value < 1) throw new Error(`--${name} must be positive`);
  return value;
}

function booleanOption(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  if (!["true", "false"].includes(options[name])) throw new Error(`--${name} must be true or false`);
  return options[name] === "true";
}

function numberOption(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  const value = Number(options[name]);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be finite`);
  return value;
}

async function readJson(file, label) {
  const absolute = path.resolve(file);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular, non-symlink file`);
  const bytes = await fs.readFile(absolute);
  return {
    absolute,
    bytes,
    sha256: analysisSha256(bytes),
    value: JSON.parse(bytes.toString("utf8")),
  };
}

async function analyze(options) {
  const names = [
    "alpha",
    "apparatus-gates-passed",
    "assignments",
    "bootstrap-draws",
    "permutation-draws",
    "output",
    "phase",
    "protocol-violations",
    "results",
    "seed",
    "tasks",
  ];
  assertKnownOptions(options, names);
  requireOptions(options, ["tasks", "results", "assignments", "phase"]);
  const [tasks, results, assignments] = await Promise.all([
    readJson(options.tasks, "task references"),
    readJson(options.results, "blinded results"),
    readJson(options.assignments, "host assignment"),
  ]);
  return analyzeRepresentationStudy({
    taskReferences: tasks.value,
    blindedResults: results.value,
    hostAssignment: assignments.value,
    taskReferencesSha256: tasks.sha256,
    blindedResultsSha256: results.sha256,
    hostAssignmentSha256: assignments.sha256,
    phase: options.phase,
    apparatusGatesPassed: booleanOption(options, "apparatus-gates-passed", false),
    protocolViolations: integerOption(options, "protocol-violations", 0),
    bootstrapDraws: positiveIntegerOption(options, "bootstrap-draws", 10_000),
    permutationDraws: positiveIntegerOption(options, "permutation-draws", 100_000),
    alpha: numberOption(options, "alpha", 0.05),
    seed: options.seed ?? "dungeness-representation-analysis-v1",
  });
}

async function select(options) {
  assertKnownOptions(options, ["pool", "seed"]);
  requireOptions(options, ["pool"]);
  const pool = await readJson(options.pool, "confirmatory task pool");
  const selection = selectConfirmatoryTasks(pool.value, {
    seed: options.seed ?? "dungeness-representation-confirmatory-task-selection-v1",
  });
  return { ...selection, inputPoolSha256: pool.sha256 };
}

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "help") {
    process.stdout.write(HELP);
    return;
  }
  const result = command === "analyze"
    ? await analyze(options)
    : command === "select-confirmatory"
      ? await select(options)
      : null;
  if (result === null) throw new Error(`unknown command: ${command}\n\n${HELP}`);
  const bytes = `${canonicalAnalysisJson(result)}\n`;
  if (options.output !== undefined) {
    const absolute = path.resolve(options.output);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, bytes, { flag: "wx" });
    process.stdout.write(`${canonicalAnalysisJson({
      output: absolute,
      sha256: analysisSha256(Buffer.from(bytes)),
    })}\n`);
    return;
  }
  process.stdout.write(bytes);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
