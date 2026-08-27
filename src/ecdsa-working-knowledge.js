#!/usr/bin/env bun
/**
 * Compile the ECDSA user view from a sealed Atlas release.
 *
 * Default: pretty JSON user-view packet on stdout.
 * --brief:      canonical working-knowledge brief only
 * --write:      docs/ecdsa/working-knowledge.json + docs/ecdsa/index.html
 * --experiment: evidence/ecdsa-user-representation/report.json
 * --retrieval:  compile from the retrieval-pinned release instead of default
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadIndexedAtlasRelease } from "./atlas-local.js";
import {
  analyzeUserRepresentationExperiment,
  buildEcdsaUserView,
  buildEcdsaWorkingKnowledgeBrief,
  ideasFromRelease,
  renderWorkingKnowledgePage,
} from "./atlas-runtime/index.ts";
import { canonicalStringify, sha256 } from "./protocol.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const purpose = process.argv.includes("--retrieval") ? "retrieval" : "default";
const writeFlag = process.argv.includes("--write");
const experimentFlag = process.argv.includes("--experiment");
const briefOnly = process.argv.includes("--brief");

const { release, experimentDetails } = await loadIndexedAtlasRelease(purpose);
const brief = buildEcdsaWorkingKnowledgeBrief(release, experimentDetails);
const view = buildEcdsaUserView(brief, sha256(brief));
const page = renderWorkingKnowledgePage(view);

if (experimentFlag) {
  const report = {
    schema: "yukon-kg.ecdsa-user-representation-experiment.v1",
    ...analyzeUserRepresentationExperiment(brief, ideasFromRelease(release)),
  };
  const outDir = join(repoRoot, "evidence", "ecdsa-user-representation");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(
    `wrote ${reportPath} adopted=${report.adoptedRepresentation} ` +
      `working=${report.totals.working_knowledge.passed}/${report.totals.working_knowledge.cases} ` +
      `archive=${report.totals.archive_promotions.passed}/${report.totals.archive_promotions.cases}\n`,
  );
}

if (writeFlag) {
  const ecdsaDir = join(repoRoot, "docs", "ecdsa");
  await mkdir(ecdsaDir, { recursive: true });
  const jsonPath = join(ecdsaDir, "working-knowledge.json");
  const htmlPath = join(ecdsaDir, "index.html");
  await writeFile(jsonPath, `${JSON.stringify(view, null, 2)}\n`);
  await writeFile(htmlPath, page);
  process.stderr.write(`wrote ${jsonPath}\n`);
  process.stderr.write(`wrote ${htmlPath}\n`);
}

if (!writeFlag && !experimentFlag) {
  process.stdout.write(briefOnly ? `${canonicalStringify(brief)}\n` : `${JSON.stringify(view, null, 2)}\n`);
}
