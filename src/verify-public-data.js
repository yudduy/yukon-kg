#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.join(ROOT, "docs", "ecdsa");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function descriptors(manifest) {
  return Object.values(manifest.roles).flatMap((value) => Array.isArray(value) ? value : [value]);
}

function safeReleasePath(releaseRoot, relativePath) {
  const target = path.resolve(releaseRoot, relativePath);
  if (target !== releaseRoot && !target.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new Error(`release path escaped its directory: ${relativePath}`);
  }
  return target;
}

export async function verifyPublicData(dataRoot = DATA_ROOT) {
  const index = JSON.parse(await fs.readFile(path.join(dataRoot, "index.json"), "utf8"));
  if (index.schema !== "yukon-kg.public-atlas-index.v1") throw new Error("unsupported public data index");
  if (!Array.isArray(index.releases) || index.releases.length === 0) throw new Error("public data index has no releases");
  const releaseIds = new Set(index.releases.map((release) => release.releaseId));
  if (!releaseIds.has(index.defaultReleaseId)) throw new Error("default release is missing from the index");
  if (!releaseIds.has(index.retrievalExperimentReleaseId)) throw new Error("retrieval release is missing from the index");

  const releases = [];
  for (const entry of index.releases) {
    const releaseRoot = path.join(dataRoot, "releases", entry.releaseId);
    const manifestPath = path.join(releaseRoot, "manifest.json");
    const manifestBytes = await fs.readFile(manifestPath);
    const manifestSha256 = sha256(manifestBytes);
    if (manifestSha256 !== entry.manifestSha256) {
      throw new Error(`${entry.releaseId} manifest hash does not match the public index`);
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.releaseId !== entry.releaseId) throw new Error(`${entry.releaseId} manifest names another release`);

    let bytes = manifestBytes.byteLength;
    let files = 1;
    for (const descriptor of descriptors(manifest)) {
      const artifact = await fs.readFile(safeReleasePath(releaseRoot, descriptor.path));
      if (artifact.byteLength !== descriptor.bytes) throw new Error(`${entry.releaseId}/${descriptor.path} byte count changed`);
      if (sha256(artifact) !== descriptor.sha256) throw new Error(`${entry.releaseId}/${descriptor.path} hash changed`);
      bytes += artifact.byteLength;
      files += 1;
    }
    releases.push({ releaseId: entry.releaseId, manifestSha256, files, bytes });
  }
  return { status: "PASS", benchmark: index.benchmark, releases };
}

if (import.meta.main) {
  verifyPublicData().then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}

