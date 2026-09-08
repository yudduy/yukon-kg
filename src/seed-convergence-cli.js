#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analysisSha256,
  canonicalAnalysisJson,
} from "./representation-study-analysis.js";
import { checkSeedConvergence } from "./seed-convergence.js";

const HELP = `Usage:
  bun run representation:convergence -- --export FILE --evidence FILE

Reads a frozen Dungeness trusted-event export and
yukon.seed-convergence-evidence.v2 clean-verifier/candidate evidence. Outputs
one content-hashed decision: PASS, ADMIN_RETRY, TASK_REPLACE, APPARATUS_STOP,
or STUDY_STOP. It is model-free, read-only, and starts no study run.
`;

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} requires a value`);
    const name = key.slice(2);
    if (!["export", "evidence"].includes(name)) throw new Error(`unknown option: ${key}`);
    if (options[name] !== undefined) throw new Error(`duplicate option: ${key}`);
    options[name] = value;
    index += 1;
  }
  for (const name of ["export", "evidence"]) {
    if (options[name] === undefined) throw new Error(`--${name} is required`);
  }
  return options;
}

async function readFrozenJson(input, label) {
  const absolute = path.resolve(input);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  const bytes = await fs.readFile(absolute);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: analysisSha256(bytes) };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const [trustedExport, evidence] = await Promise.all([
    readFrozenJson(options.export, "trusted export"),
    readFrozenJson(options.evidence, "seed evidence"),
  ]);
  const decision = checkSeedConvergence({
    trustedExport: trustedExport.value,
    evidence: evidence.value,
    trustedExportSha256: trustedExport.sha256,
    evidenceSha256: evidence.sha256,
  });
  process.stdout.write(`${canonicalAnalysisJson(decision)}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
