#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { analyzeAtlasAccess } from "./atlas-access-analysis.js";
import { canonicalStringify } from "./protocol.js";

function usage() {
  return "Usage: bun run src/atlas-access-analysis-cli.js <reachability.json> <fixture.json> <output.json>";
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) throw new Error(usage());
  const [reachabilityPath, fixturePath, outputPath] = argv.map((value) => path.resolve(value));
  const [reachability, fixture] = await Promise.all([
    fs.readFile(reachabilityPath, "utf8").then(JSON.parse),
    fs.readFile(fixturePath, "utf8").then(JSON.parse),
  ]);
  const analysis = analyzeAtlasAccess(reachability, fixture);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${canonicalStringify(analysis)}\n`);
  process.stdout.write(`${canonicalStringify({ output: outputPath, analysisSha256: analysis.analysisSha256 })}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

