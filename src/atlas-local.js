import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ATLAS_MODULE = path.join(ROOT, "src", "atlas-runtime", "index.ts");
const DATA_ROOT = path.join(ROOT, "docs", "ecdsa");

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeReleasePath(directory, relativePath) {
  const decoded = decodeURIComponent(relativePath);
  const target = path.resolve(directory, decoded);
  if (target !== directory && !target.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`sealed Atlas fetch escaped the release directory: ${relativePath}`);
  }
  return target;
}

export async function readPublicAtlasIndex(dataRoot = DATA_ROOT) {
  return JSON.parse(await fs.readFile(path.join(dataRoot, "index.json"), "utf8"));
}

export function releaseDirectoryFor(releaseId, dataRoot = DATA_ROOT) {
  return path.join(dataRoot, "releases", releaseId);
}

export async function withLocalAtlasFetch(directory, releaseId, callback) {
  const originalFetch = globalThis.fetch;
  const basePath = `/${releaseId}/`;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== "https://atlas-sealed.invalid" || !url.pathname.startsWith(basePath)) {
      throw new Error(`network disabled by sealed Atlas fetch adapter: ${url.href}`);
    }
    const target = safeReleasePath(directory, url.pathname.slice(basePath.length));
    try {
      return new Response(await fs.readFile(target), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (error.code === "ENOENT") return new Response("not found", { status: 404 });
      throw error;
    }
  };
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function loadLocalAtlasRelease({
  directory,
  releaseId,
  manifestSha256,
  atlasModulePath = DEFAULT_ATLAS_MODULE,
  includeExperimentDetails = true,
} = {}) {
  const resolvedDirectory = path.resolve(directory);
  const manifestBytes = await fs.readFile(path.join(resolvedDirectory, "manifest.json"));
  const actualSha256 = sha256Bytes(manifestBytes);
  if (manifestSha256 !== undefined && actualSha256 !== manifestSha256) {
    throw new Error(`local Atlas manifest hash ${actualSha256} does not match ${manifestSha256}`);
  }
  const atlas = await import(pathToFileURL(path.resolve(atlasModulePath)).href);
  return withLocalAtlasFetch(resolvedDirectory, releaseId, async () => {
    const pointer = {
      id: releaseId,
      manifestSha256: actualSha256,
      baseUrl: `https://atlas-sealed.invalid/${releaseId}/`,
    };
    const release = await atlas.loadAtlasRelease(pointer);
    const experimentDetails = new Map();
    if (includeExperimentDetails) {
      for (const experiment of release.experiments?.experiments ?? []) {
        const model = await atlas.loadAtlasExperimentDetail(release, experiment.id);
        const detail = model.experimentById.get(experiment.id);
        if (detail !== undefined) experimentDetails.set(experiment.id, detail);
      }
    }
    return { atlas, release, experimentDetails, pointer, directory: resolvedDirectory };
  });
}

export async function loadIndexedAtlasRelease(purpose = "default", options = {}) {
  const index = await readPublicAtlasIndex(options.dataRoot);
  const releaseId = purpose === "retrieval"
    ? index.retrievalExperimentReleaseId
    : index.defaultReleaseId;
  const entry = index.releases.find((release) => release.releaseId === releaseId);
  if (entry === undefined) throw new Error(`public index is missing release ${releaseId}`);
  return loadLocalAtlasRelease({
    directory: releaseDirectoryFor(releaseId, options.dataRoot),
    releaseId,
    manifestSha256: entry.manifestSha256,
    atlasModulePath: options.atlasModulePath,
    includeExperimentDetails: options.includeExperimentDetails,
  });
}
