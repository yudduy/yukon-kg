import {
  buildAtlasRelease,
  parseAtlasDecomposition,
  parseAtlasExperimentDetail,
  parseAtlasExperiments,
  parseAtlasGenealogy,
  parseAtlasIdeas,
  parseAtlasManifest,
  parseAtlasReleasePointer,
  parseAtlasSolvers,
  parseAtlasSubmissionDetail,
  parseAtlasSubmissions,
} from "./schema";
import type {
  AtlasRelease,
  AtlasExperimentDetailModel,
  AtlasReleasePointer,
  AtlasRoleDescriptor,
  AtlasSubmissionDetailModel,
} from "./types";

const CACHE_NAME = "yukon-atlas-v1";
interface AtlasCacheRequest {
  url: string;
}

interface AtlasCache {
  delete(request: string | AtlasCacheRequest): Promise<boolean>;
  keys(): Promise<AtlasCacheRequest[]>;
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

interface AtlasCacheStorage {
  open(cacheName: string): Promise<AtlasCache>;
}

interface SharedLoad<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: Set<symbol>;
  abortTimer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  uncancelable: boolean;
}

const releasePromises = new Map<string, SharedLoad<AtlasRelease>>();
const detailPromises = new Map<string, SharedLoad<AtlasSubmissionDetailModel>>();
const experimentDetailPromises = new Map<string, SharedLoad<AtlasExperimentDetailModel>>();

export class AtlasIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasIntegrityError";
  }
}

function releaseKey(pointer: AtlasReleasePointer): string {
  return `${pointer.id}:${pointer.manifestSha256}:${pointer.baseUrl}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function clearAbortTimer(entry: SharedLoad<unknown>): void {
  if (entry.abortTimer === null) return;
  clearTimeout(entry.abortTimer);
  entry.abortTimer = null;
}

function loadShared<T>(
  cache: Map<string, SharedLoad<T>>,
  key: string,
  signal: AbortSignal | undefined,
  loader: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted === true) return Promise.reject(abortReason(signal));
  let entry = cache.get(key);
  if (entry === undefined) {
    const controller = new AbortController();
    entry = {
      controller,
      promise: Promise.resolve(null as T),
      consumers: new Set(),
      abortTimer: null,
      settled: false,
      uncancelable: false,
    };
    const created = entry;
    created.promise = loader(controller.signal).then(
      (value) => {
        created.settled = true;
        clearAbortTimer(created);
        return value;
      },
      (error: unknown) => {
        created.settled = true;
        clearAbortTimer(created);
        if (cache.get(key) === created) cache.delete(key);
        throw error;
      },
    );
    cache.set(key, created);
  }
  const shared = entry;
  if (signal === undefined) {
    shared.uncancelable = true;
    return shared.promise;
  }

  clearAbortTimer(shared);
  const token = Symbol(key);
  shared.consumers.add(token);
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      shared.consumers.delete(token);
      if (!aborted || shared.settled || shared.uncancelable || shared.consumers.size !== 0) return;
      shared.abortTimer = setTimeout(() => {
        shared.abortTimer = null;
        if (shared.settled || shared.uncancelable || shared.consumers.size !== 0) return;
        if (cache.get(key) === shared) cache.delete(key);
        shared.controller.abort();
      }, 0);
    };
    const onAbort = () => {
      if (finished) return;
      finish(true);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    shared.promise.then(
      (value) => {
        finish(false);
        resolve(value);
      },
      (error: unknown) => {
        finish(false);
        reject(error);
      },
    );
  });
}

function roleUrl(pointer: AtlasReleasePointer, path: string): string {
  const base = `${pointer.baseUrl.replace(/\/+$/, "")}/`;
  const url = new URL(path, base);
  if (!url.href.startsWith(base) || url.username !== "" || url.password !== "") {
    throw new AtlasIntegrityError(`Atlas role escaped its release base URL: ${path}`);
  }
  return url.href;
}

async function sha256(data: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyBytes(
  data: Uint8Array,
  expectedSha256: string,
  expectedBytes: number | null,
  context: string,
): Promise<void> {
  if (expectedBytes !== null && data.byteLength !== expectedBytes) {
    throw new AtlasIntegrityError(`${context} byte count differs from its manifest`);
  }
  const actualSha256 = await sha256(data);
  if (actualSha256 !== expectedSha256) {
    throw new AtlasIntegrityError(`${context} SHA-256 differs from its manifest`);
  }
}

function cacheStorage(): AtlasCacheStorage | null {
  const storage = (globalThis as typeof globalThis & { caches?: AtlasCacheStorage }).caches;
  return storage ?? null;
}

async function readCached(
  url: string,
  expectedSha256: string,
  expectedBytes: number | null,
  context: string,
): Promise<Uint8Array | null> {
  const storage = cacheStorage();
  if (storage === null) return null;
  const cache = await storage.open(CACHE_NAME);
  const response = await cache.match(url);
  if (response === undefined) return null;
  const data = new Uint8Array(await response.arrayBuffer());
  try {
    await verifyBytes(data, expectedSha256, expectedBytes, context);
    return data;
  } catch {
    await cache.delete(url);
    return null;
  }
}

async function cacheVerified(url: string, data: Uint8Array): Promise<void> {
  const storage = cacheStorage();
  if (storage === null) return;
  const cache = await storage.open(CACHE_NAME);
  const copy = Uint8Array.from(data);
  await cache.put(url, new Response(copy.buffer, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/json; charset=utf-8",
    },
  }));
}

async function fetchVerifiedBytes(
  url: string,
  expectedSha256: string,
  expectedBytes: number | null,
  context: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const cached = await readCached(url, expectedSha256, expectedBytes, context);
  if (cached !== null) return cached;
  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`${context} request failed with HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  await verifyBytes(data, expectedSha256, expectedBytes, context);
  await cacheVerified(url, data);
  return data;
}

function parseJson(data: Uint8Array, context: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new AtlasIntegrityError(`${context} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AtlasIntegrityError(`${context} is not valid JSON`);
  }
}

async function loadDescriptor(
  pointer: AtlasReleasePointer,
  descriptor: AtlasRoleDescriptor,
  signal?: AbortSignal,
): Promise<unknown> {
  const context = `Atlas role ${descriptor.path}`;
  const data = await fetchVerifiedBytes(
    roleUrl(pointer, descriptor.path),
    descriptor.sha256,
    descriptor.bytes,
    context,
    signal,
  );
  return parseJson(data, context);
}

async function loadRelease(pointerValue: AtlasReleasePointer, signal?: AbortSignal): Promise<AtlasRelease> {
  const pointer = parseAtlasReleasePointer(pointerValue);
  const manifestUrl = roleUrl(pointer, "manifest.json");
  const manifestBytes = await fetchVerifiedBytes(
    manifestUrl,
    pointer.manifestSha256,
    null,
    "Atlas manifest",
    signal,
  );
  const manifest = parseAtlasManifest(parseJson(manifestBytes, "Atlas manifest"));
  if (manifest.releaseId !== pointer.id) {
    throw new AtlasIntegrityError("Atlas manifest release ID differs from the benchmark pointer");
  }
  const experimentsDescriptor = manifest.schemaVersion === 3 || manifest.schemaVersion === 4
    ? manifest.roles.experiments
    : manifest.schemaVersion === 5
      ? manifest.roles.experiments ?? null
      : null;
  const [
    ideasValue,
    solversValue,
    submissionsValue,
    experimentsValue,
    genealogyValue,
    decompositionValue,
  ] = await Promise.all([
    loadDescriptor(pointer, manifest.roles.ideas, signal),
    loadDescriptor(pointer, manifest.roles.solvers, signal),
    loadDescriptor(pointer, manifest.roles.submissions, signal),
    experimentsDescriptor === null
      ? Promise.resolve(null)
      : loadDescriptor(pointer, experimentsDescriptor, signal),
    manifest.schemaVersion === 4
      ? loadDescriptor(pointer, manifest.roles.genealogy, signal)
      : Promise.resolve(null),
    manifest.schemaVersion === 5
      ? loadDescriptor(pointer, manifest.roles.decomposition, signal)
      : Promise.resolve(null),
  ]);
  return buildAtlasRelease(
    pointer,
    manifest,
    parseAtlasIdeas(ideasValue),
    parseAtlasSolvers(solversValue),
    parseAtlasSubmissions(submissionsValue),
    experimentsValue === null ? null : parseAtlasExperiments(experimentsValue),
    genealogyValue === null ? null : parseAtlasGenealogy(genealogyValue),
    decompositionValue === null ? null : parseAtlasDecomposition(decompositionValue),
  );
}

export function loadAtlasRelease(
  pointerValue: AtlasReleasePointer,
  options: { signal?: AbortSignal } = {},
): Promise<AtlasRelease> {
  const pointer = parseAtlasReleasePointer(pointerValue);
  const key = releaseKey(pointer);
  return loadShared(releasePromises, key, options.signal, (signal) => loadRelease(pointer, signal));
}

async function loadDetail(
  release: AtlasRelease,
  descriptor: AtlasRoleDescriptor,
  signal?: AbortSignal,
): Promise<AtlasSubmissionDetailModel> {
  const value = await loadDescriptor(release.pointer, descriptor, signal);
  return parseAtlasSubmissionDetail(value, release, descriptor);
}

export function loadAtlasSubmissionDetail(
  release: AtlasRelease,
  submissionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AtlasSubmissionDetailModel> {
  const submission = release.submissionById.get(submissionId);
  if (submission === undefined) throw new Error(`Unknown Atlas submission ${submissionId}`);
  const descriptor = release.detailDescriptorByPath.get(submission.detailShard);
  if (descriptor === undefined) throw new AtlasIntegrityError(`Missing Atlas detail descriptor ${submission.detailShard}`);
  const key = `${releaseKey(release.pointer)}:${descriptor.sha256}`;
  return loadShared(
    detailPromises,
    key,
    options.signal,
    (signal) => loadDetail(release, descriptor, signal),
  );
}

export function loadAtlasExperimentDetail(
  release: AtlasRelease,
  experimentId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AtlasExperimentDetailModel> {
  const experiment = release.experimentById.get(experimentId);
  if (experiment === undefined) throw new Error(`Unknown Atlas experiment ${experimentId}`);
  const descriptor = release.experimentDetailDescriptorByPath.get(experiment.detailShard);
  if (descriptor === undefined) {
    throw new AtlasIntegrityError(`Missing Atlas experiment detail descriptor ${experiment.detailShard}`);
  }
  const key = `${releaseKey(release.pointer)}:experiment:${descriptor.sha256}`;
  return loadShared(experimentDetailPromises, key, options.signal, async (signal) => {
    const value = await loadDescriptor(release.pointer, descriptor, signal);
    return parseAtlasExperimentDetail(value, release, descriptor);
  });
}

export async function evictAtlasRelease(pointerValue: AtlasReleasePointer): Promise<void> {
  const pointer = parseAtlasReleasePointer(pointerValue);
  const key = releaseKey(pointer);
  const release = releasePromises.get(key);
  releasePromises.delete(key);
  if (release !== undefined && !release.settled) release.controller.abort();
  for (const [detailKey, detail] of detailPromises) {
    if (!detailKey.startsWith(`${key}:`)) continue;
    detailPromises.delete(detailKey);
    if (!detail.settled) detail.controller.abort();
  }
  for (const [detailKey, detail] of experimentDetailPromises) {
    if (!detailKey.startsWith(`${key}:`)) continue;
    experimentDetailPromises.delete(detailKey);
    if (!detail.settled) detail.controller.abort();
  }
  const storage = cacheStorage();
  if (storage === null) return;
  const cache = await storage.open(CACHE_NAME);
  const requests = await cache.keys();
  const prefix = `${pointer.baseUrl.replace(/\/+$/, "")}/`;
  await Promise.all(requests.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request)));
}
