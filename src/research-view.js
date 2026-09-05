import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const RESEARCH_EVENT_SCHEMA = "yukon.research-event.v1";
export const RESEARCH_VIEW_SCHEMA = "yukon.research-view.v1";
export const RESEARCH_VIEW_MANIFEST_SCHEMA = "yukon.research-view-manifest.v1";
export const RENDERER_VERSION = "yukon.research-view-renderer.v4";
export const TOKEN_POLICY = Object.freeze({
  id: "utf8-bytes-ceil-div2.v1",
  description: "conservative upper-bound proxy: ceil(canonical UTF-8 byte length / 2)",
});
export const DEFAULT_TOKEN_LIMITS = Object.freeze({ total: 32_000, index: 4_000 });
export const REPRESENTATIONS = Object.freeze(["R0", "R1", "R2"]);

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const DEFAULT_DATA_ROOT = path.join(MODULE_ROOT, "docs", "ecdsa");
const EXACT_EVENT_KEYS = Object.freeze([
  "baseArtifactId",
  "baseArtifactSha256",
  "candidateArtifactId",
  "candidateArtifactSha256",
  "changeSet",
  "commitSha",
  "conditions",
  "eventId",
  "execution",
  "interventions",
  "outcome",
  "provenance",
  "schema",
  "sequence",
]);
const EXACT_CONDITION_KEYS = Object.freeze([
  "bundleSize",
  "checkpointId",
  "configuration",
  "environment",
  "harness",
  "hasUnresolved",
  "policyCoupled",
  "routeInterpretation",
  "seed",
  "taskId",
]);
const EXACT_OUTCOME_KEYS = Object.freeze([
  "admission",
  "classification",
  "comparatorArtifactId",
  "comparatorHops",
  "comparatorScore",
  "direction",
  "directionalGain",
  "metricName",
  "rawDelta",
  "scope",
  "score",
  "sourceStatus",
  "status",
  "validity",
]);
const EXACT_CHANGE_SET_KEYS = Object.freeze(["changedPaths", "changedSymbols", "configuration", "diff"]);
const EXACT_DIFF_KEYS = Object.freeze(["sha256", "text"]);
const EXACT_EXECUTION_KEYS = Object.freeze([
  "evaluationCost",
  "evaluationId",
  "modelCost",
  "modelId",
  "modelProvider",
  "reasoningEffort",
  "totalCost",
]);
const EXACT_INTERVENTION_KEYS = Object.freeze([
  "changeId",
  "constraintIds",
  "ideaIds",
  "phase",
  "relation",
  "reviewDisposition",
  "site",
  "title",
]);
const EXACT_PROVENANCE_KEYS = Object.freeze([
  "evidenceSha256",
  "selectors",
  "sourceSetId",
]);
const EXACT_SELECTOR_KEYS = Object.freeze(["selector", "sourceRef"]);
const EXACT_SOURCE_KEYS = Object.freeze(["path", "sha256"]);
const EXACT_SOURCE_SET_KEYS = Object.freeze(["manifestSha256", "releaseId", "sourceSetId", "sources"]);
const ADVISORY_KEYS = new Set([
  "advice",
  "caveat",
  "caveats",
  "confidence",
  "inference",
  "interpretation",
  "nextaction",
  "nextstep",
  "proposedaction",
  "rationale",
  "recommendation",
  "recommendations",
  "suggestion",
  "summary",
]);
const ADVISORY_TEXT = /\b(?:recommend(?:ation|ed|s)?|should|suggest(?:ion|ed|s)?|try next|likely|probably|supports?|refutes?|confidence)\b/iu;
// `none` is a meaningful authored enum in several frozen contracts (for
// example verifier network mode and reasoning-summary policy). Reserve this
// guard for strings that can only stand in for missing information.
const UNKNOWN_SENTINEL = /^(?:unknown|n\/a|unspecified)$/iu;
const HEX_64 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const ALLOWED_PHASES = new Set(["decode", "prefill", "both", "unknown"]);
const ALLOWED_RELATIONS = new Set(["instance_of", "variant_of", "analogous_to", "unresolved"]);
const ALLOWED_ROUTES = new Set(["focused", "single_idea", "mixed", "unmapped", "unknown"]);
const ALLOWED_CLASSIFICATIONS = new Set([
  "artifact",
  "measurement",
  "artifact_and_measurement",
  "no_op",
  "unsupported",
]);
const ALLOWED_ADMISSIONS = new Set(["admitted", "rejected", "unknown"]);
const ALLOWED_VALIDITY = new Set(["valid", "invalid", "unknown"]);
const ALLOWED_REVIEW_DISPOSITIONS = new Set([
  "accepted_child",
  "proposed_child",
  "covered_by_owner",
  "parameter_only",
  "non_structural",
  "insufficient_evidence",
  "metric_only",
  "unresolved",
]);

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`canonical JSON does not support undefined at ${key}`);
      result[key] = normalize(value[key]);
    }
    return result;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : canonicalStringify(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function countDeterministicTokens(value) {
  const text = typeof value === "string" ? value : canonicalStringify(value);
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2);
}

async function currentRendererProvenance() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: MODULE_ROOT,
    encoding: "utf8",
  });
  const commit = stdout.trim();
  if (!COMMIT_SHA.test(commit)) throw new Error("renderer Git commit is not a full SHA-1");
  const files = [];
  for (const relative of ["src/research-view-cli.js", "src/research-view.js"]) {
    const bytes = await fs.readFile(path.join(MODULE_ROOT, relative));
    files.push({ path: relative, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  return {
    commit,
    source_sha256: sha256(files),
    source_files: files,
  };
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (canonicalStringify(actual) !== canonicalStringify(wanted)) {
    throw new Error(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireNullableString(value, label) {
  if (value !== null) requireString(value, label);
  return value;
}

function requireFiniteOrNull(value, label) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`${label} must be a finite number or null`);
  }
  return value;
}

function requireIntegerOrNull(value, label) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`${label} must be a non-negative integer or null`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function requireEnum(value, allowed, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!allowed.has(value)) throw new Error(`${label} has unsupported value: ${String(value)}`);
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item, index) => requireString(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

function requireIsoTimestamp(value, label) {
  requireString(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO-8601 UTC timestamp`);
  }
  return value;
}

function normalizedPolicyKey(key) {
  return key.toLowerCase().replace(/[^a-z]/gu, "");
}

export function assertNoAdvisoryDerivation(value, label = "derived representation") {
  const visit = (item, itemLabel) => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${itemLabel}[${index}]`));
      return;
    }
    if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (ADVISORY_KEYS.has(normalizedPolicyKey(key))) {
          throw new Error(`${itemLabel}.${key} is an inferred or advisory field`);
        }
        visit(child, `${itemLabel}.${key}`);
      }
      return;
    }
    if (typeof item === "string" && ADVISORY_TEXT.test(item)) {
      throw new Error(`${itemLabel} contains inferred or advisory language`);
    }
  };
  visit(value, label);
}

function assertNoUnknownCoercion(value, label) {
  const visit = (item, itemLabel) => {
    if (typeof item === "string" && UNKNOWN_SENTINEL.test(item.trim())) {
      throw new Error(`${itemLabel} uses an ambiguous unknown sentinel; use null`);
    }
    if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${itemLabel}[${index}]`));
    else if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) visit(child, `${itemLabel}.${key}`);
    }
  };
  visit(value, label);
}

export function validateResearchEvent(value) {
  const event = requireObject(value, "ResearchEvent");
  requireExactKeys(event, EXACT_EVENT_KEYS, "ResearchEvent");
  if (event.schema !== RESEARCH_EVENT_SCHEMA) throw new Error("ResearchEvent has unsupported schema");
  requireString(event.eventId, "ResearchEvent.eventId");
  requireNullableString(event.baseArtifactId, "ResearchEvent.baseArtifactId");
  requireString(event.candidateArtifactId, "ResearchEvent.candidateArtifactId");
  for (const key of ["baseArtifactSha256", "candidateArtifactSha256"]) {
    if (event[key] !== null && !HEX_64.test(event[key])) throw new Error(`ResearchEvent.${key} is invalid`);
  }
  requireNullableString(event.commitSha, "ResearchEvent.commitSha");
  if (event.commitSha !== null && !COMMIT_SHA.test(event.commitSha)) throw new Error("ResearchEvent.commitSha must be a lowercase 40-character SHA-1 or null");

  requireExactKeys(event.sequence, ["kind", "value"], "ResearchEvent.sequence");
  if (event.sequence.kind !== "timestamp") throw new Error("ResearchEvent.sequence.kind must be timestamp");
  requireIsoTimestamp(event.sequence.value, "ResearchEvent.sequence.value");

  requireExactKeys(event.conditions, EXACT_CONDITION_KEYS, "ResearchEvent.conditions");
  requireString(event.conditions.taskId, "ResearchEvent.conditions.taskId");
  requireNullableString(event.conditions.checkpointId, "ResearchEvent.conditions.checkpointId");
  if (!Number.isInteger(event.conditions.bundleSize) || event.conditions.bundleSize < 0) {
    throw new TypeError("ResearchEvent.conditions.bundleSize must be a non-negative integer");
  }
  requireBoolean(event.conditions.policyCoupled, "ResearchEvent.conditions.policyCoupled");
  requireBoolean(event.conditions.hasUnresolved, "ResearchEvent.conditions.hasUnresolved");
  requireEnum(event.conditions.routeInterpretation, ALLOWED_ROUTES, "ResearchEvent.conditions.routeInterpretation");
  for (const key of ["configuration", "environment", "harness", "seed"]) {
    normalize(event.conditions[key]);
    assertNoUnknownCoercion(event.conditions[key], `ResearchEvent.conditions.${key}`);
  }

  requireExactKeys(event.changeSet, EXACT_CHANGE_SET_KEYS, "ResearchEvent.changeSet");
  requireExactKeys(event.changeSet.diff, EXACT_DIFF_KEYS, "ResearchEvent.changeSet.diff");
  const diffText = event.changeSet.diff.text;
  const diffSha256 = event.changeSet.diff.sha256;
  if (diffText === null || diffSha256 === null) {
    if (diffText !== null || diffSha256 !== null) throw new Error("ResearchEvent diff text and hash must both be null or present");
  } else {
    if (typeof diffText !== "string") throw new TypeError("ResearchEvent.changeSet.diff.text must be a string or null");
    if (!HEX_64.test(diffSha256) || sha256(diffText) !== diffSha256) throw new Error("ResearchEvent exact diff hash does not match its text");
  }
  for (const changedPath of requireStringArray(event.changeSet.changedPaths, "ResearchEvent.changeSet.changedPaths")) {
    assertSafeRelativePath(changedPath, "ResearchEvent.changeSet.changedPaths item");
  }
  requireStringArray(event.changeSet.changedSymbols, "ResearchEvent.changeSet.changedSymbols");
  normalize(event.changeSet.configuration);
  assertNoUnknownCoercion(event.changeSet.configuration, "ResearchEvent.changeSet.configuration");

  requireExactKeys(event.execution, EXACT_EXECUTION_KEYS, "ResearchEvent.execution");
  for (const key of ["evaluationId", "modelId", "modelProvider", "reasoningEffort"]) {
    requireNullableString(event.execution[key], `ResearchEvent.execution.${key}`);
  }
  for (const key of ["evaluationCost", "modelCost", "totalCost"]) {
    normalize(event.execution[key]);
    assertNoUnknownCoercion(event.execution[key], `ResearchEvent.execution.${key}`);
  }

  if (!Array.isArray(event.interventions)) throw new TypeError("ResearchEvent.interventions must be an array");
  const changeIds = [];
  for (const [index, intervention] of event.interventions.entries()) {
    const label = `ResearchEvent.interventions[${index}]`;
    requireExactKeys(intervention, EXACT_INTERVENTION_KEYS, label);
    changeIds.push(requireString(intervention.changeId, `${label}.changeId`));
    requireString(intervention.title, `${label}.title`);
    requireString(intervention.site, `${label}.site`);
    requireEnum(intervention.phase, ALLOWED_PHASES, `${label}.phase`);
    requireEnum(intervention.relation, ALLOWED_RELATIONS, `${label}.relation`);
    requireStringArray(intervention.ideaIds, `${label}.ideaIds`);
    requireStringArray(intervention.constraintIds, `${label}.constraintIds`);
    requireEnum(
      intervention.reviewDisposition,
      ALLOWED_REVIEW_DISPOSITIONS,
      `${label}.reviewDisposition`,
      { nullable: true },
    );
  }
  if (new Set(changeIds).size !== changeIds.length) throw new Error("ResearchEvent repeats an intervention changeId");
  if (event.conditions.bundleSize !== event.interventions.length) {
    throw new Error("ResearchEvent bundleSize must equal the nested intervention count");
  }

  requireExactKeys(event.outcome, EXACT_OUTCOME_KEYS, "ResearchEvent.outcome");
  requireString(event.outcome.status, "ResearchEvent.outcome.status");
  requireString(event.outcome.sourceStatus, "ResearchEvent.outcome.sourceStatus");
  requireEnum(event.outcome.validity, ALLOWED_VALIDITY, "ResearchEvent.outcome.validity");
  requireEnum(event.outcome.classification, ALLOWED_CLASSIFICATIONS, "ResearchEvent.outcome.classification", { nullable: true });
  requireString(event.outcome.metricName, "ResearchEvent.outcome.metricName");
  if (!["+", "-", "minimize", "maximize"].includes(event.outcome.direction)) {
    throw new Error("ResearchEvent.outcome.direction must be +, -, minimize, or maximize");
  }
  for (const key of ["score", "comparatorScore", "rawDelta", "directionalGain"]) {
    requireFiniteOrNull(event.outcome[key], `ResearchEvent.outcome.${key}`);
  }
  requireNullableString(event.outcome.comparatorArtifactId, "ResearchEvent.outcome.comparatorArtifactId");
  requireIntegerOrNull(event.outcome.comparatorHops, "ResearchEvent.outcome.comparatorHops");
  if (
    event.outcome.comparatorArtifactId === null
    && (event.outcome.comparatorScore !== null || event.outcome.comparatorHops !== null)
  ) {
    throw new Error("ResearchEvent cannot attach comparator measurements without a comparator artifact");
  }
  if (event.outcome.scope !== "whole_artifact") {
    throw new Error("ResearchEvent outcome must remain scoped to the whole artifact");
  }
  requireEnum(event.outcome.admission, ALLOWED_ADMISSIONS, "ResearchEvent.outcome.admission");

  requireExactKeys(event.provenance, EXACT_PROVENANCE_KEYS, "ResearchEvent.provenance");
  if (!HEX_64.test(event.provenance.sourceSetId)) throw new Error("ResearchEvent provenance source-set hash is invalid");
  if (!Array.isArray(event.provenance.selectors) || event.provenance.selectors.length === 0) {
    throw new Error("ResearchEvent.provenance.selectors must be non-empty");
  }
  const evidenceHashes = requireStringArray(event.provenance.evidenceSha256, "ResearchEvent.provenance.evidenceSha256");
  if (evidenceHashes.some((value) => !HEX_64.test(value))) throw new Error("ResearchEvent provenance contains an invalid evidence hash");
  for (const [index, selector] of event.provenance.selectors.entries()) {
    const label = `ResearchEvent.provenance.selectors[${index}]`;
    requireExactKeys(selector, EXACT_SELECTOR_KEYS, label);
    if (!Number.isInteger(selector.sourceRef) || selector.sourceRef < 0) {
      throw new Error(`${label}.sourceRef must be a non-negative integer`);
    }
    requireString(selector.selector, `${label}.selector`);
  }
  return event;
}

export function serializeResearchEvent(value) {
  validateResearchEvent(value);
  return canonicalStringify(value);
}

export function assertSafeRelativePath(relativePath, label = "path") {
  requireString(relativePath, label);
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
  if (decoded.includes("\0") || path.isAbsolute(decoded)) throw new Error(`${label} must be a safe relative path`);
  const normalized = path.posix.normalize(decoded.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized !== decoded.replaceAll("\\", "/")) {
    throw new Error(`${label} escapes or is not normalized`);
  }
  return normalized;
}

function safePath(root, relativePath, label = "path") {
  const safeRelative = assertSafeRelativePath(relativePath, label);
  const target = path.resolve(root, safeRelative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escaped its root`);
  return target;
}

async function readVerifiedRole(releaseRoot, descriptor, label) {
  requireObject(descriptor, `${label} descriptor`);
  if (!HEX_64.test(descriptor.sha256)) throw new Error(`${label} descriptor hash is invalid`);
  const target = safePath(releaseRoot, descriptor.path, `${label} descriptor.path`);
  const bytes = await fs.readFile(target);
  if (bytes.byteLength !== descriptor.bytes) throw new Error(`${label} byte count does not match the manifest`);
  if (sha256(bytes) !== descriptor.sha256) throw new Error(`${label} hash does not match the manifest`);
  return JSON.parse(bytes.toString("utf8"));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEvents(left, right) {
  return compareText(left.sequence.value, right.sequence.value) || compareText(left.eventId, right.eventId);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function encodeEventSet(values) {
  const refs = [...new Set(values)].sort((left, right) => left - right);
  if (refs.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("event set requires non-negative integer references");
  }
  const ranges = [];
  for (let index = 0; index < refs.length;) {
    const start = refs[index];
    let end = start;
    while (index + 1 < refs.length && refs[index + 1] === end + 1) {
      index += 1;
      end = refs[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return ranges.join(",");
}

function decodeEventSet(value, atomCount, label) {
  if (typeof value !== "string") throw new Error(`${label} must be an encoded event set`);
  if (value === "") return [];
  const refs = [];
  for (const part of value.split(",")) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/u);
    if (match === null) throw new Error(`${label} has an invalid range`);
    const start = Number.parseInt(match[1], 10);
    const end = match[2] === undefined ? start : Number.parseInt(match[2], 10);
    if (end < start || end >= atomCount) throw new Error(`${label} has an out-of-range reference`);
    for (let ref = start; ref <= end; ref += 1) refs.push(ref);
  }
  if (new Set(refs).size !== refs.length || refs.some((ref, index) => index > 0 && ref <= refs[index - 1])) {
    throw new Error(`${label} is not strictly ordered and unique`);
  }
  return refs;
}

function buildResearchEvent(submission, context) {
  const route = context.routeBySubmission.get(submission.id);
  if (route === undefined) throw new Error(`dated submission ${submission.id} has no decomposition route`);
  const interventions = submission.changes.map((change) => {
    const witness = context.witnessById.get(change.id);
    if (witness === undefined) throw new Error(`dated submission ${submission.id} has no witness for ${change.id}`);
    if (witness.submissionId !== submission.id) throw new Error(`witness ${change.id} names another submission`);
    const ideaIds = witness.ideaIds.length > 0
      ? witness.ideaIds
      : witness.mappingIdeaId === null ? [] : [witness.mappingIdeaId];
    return {
      changeId: change.id,
      constraintIds: sortedUnique(witness.constraintIds),
      ideaIds: sortedUnique(ideaIds),
      phase: change.phase,
      relation: change.relation,
      reviewDisposition: witness.reviewDisposition,
      site: change.site,
      title: change.title,
    };
  });
  const event = {
    schema: RESEARCH_EVENT_SCHEMA,
    eventId: submission.id,
    sequence: { kind: "timestamp", value: submission.createdAt },
    baseArtifactId: submission.parentId,
    baseArtifactSha256: null,
    candidateArtifactId: submission.id,
    candidateArtifactSha256: null,
    commitSha: submission.commitSha,
    changeSet: {
      diff: { text: null, sha256: null },
      changedPaths: sortedUnique(submission.changes.map((change) => change.site.split("::", 1)[0])),
      changedSymbols: sortedUnique(submission.changes.flatMap((change) => {
        const parts = change.site.split("::");
        return parts.length > 1 ? [parts.slice(1).join("::")] : [];
      })),
      configuration: null,
    },
    interventions,
    conditions: {
      taskId: context.taskId,
      checkpointId: null,
      bundleSize: interventions.length,
      policyCoupled: route.policyCoupled,
      routeInterpretation: route.interpretation,
      hasUnresolved: route.hasUnresolved,
      configuration: null,
      seed: null,
      environment: null,
      harness: null,
    },
    execution: {
      evaluationId: null,
      modelProvider: null,
      modelId: null,
      reasoningEffort: null,
      modelCost: null,
      evaluationCost: null,
      totalCost: null,
    },
    outcome: {
      status: submission.status,
      sourceStatus: submission.status,
      validity: "unknown",
      classification: submission.classification,
      metricName: context.metricName,
      direction: context.direction,
      score: submission.score,
      comparatorArtifactId: submission.scoreComparatorId,
      comparatorScore: submission.scoreComparatorScore,
      comparatorHops: submission.scoreComparatorHops,
      rawDelta: submission.rawDelta,
      directionalGain: submission.directionalGain,
      scope: "whole_artifact",
      admission: "unknown",
    },
    provenance: {
      sourceSetId: context.sourceSetId,
      evidenceSha256: [context.submissionsDescriptor.sha256, context.decompositionDescriptor.sha256].sort(compareText),
      selectors: [
        { sourceRef: 0, selector: `submission:${submission.id}` },
        { sourceRef: 1, selector: `route:${submission.id}` },
      ],
    },
  };
  return validateResearchEvent(event);
}

export async function loadDatedEcdsaCalibrationCohort({
  dataRoot = DEFAULT_DATA_ROOT,
  cutoff = null,
  expectedCount = null,
} = {}) {
  const absoluteDataRoot = path.resolve(dataRoot);
  const indexBytes = await fs.readFile(safePath(absoluteDataRoot, "index.json", "Atlas index path"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  if (index.schema !== "yukon-kg.public-atlas-index.v1") throw new Error("unsupported Atlas public index");
  const releaseEntry = index.releases.find((entry) => entry.releaseId === index.defaultReleaseId);
  if (releaseEntry === undefined) throw new Error("Atlas default release is absent from the index");
  if (!HEX_64.test(releaseEntry.releaseId) || !HEX_64.test(releaseEntry.manifestSha256)) {
    throw new Error("Atlas release index contains an invalid content hash");
  }
  const releaseRoot = safePath(absoluteDataRoot, `releases/${releaseEntry.releaseId}`, "Atlas release path");
  const manifestPath = safePath(releaseRoot, "manifest.json", "Atlas manifest path");
  const manifestBytes = await fs.readFile(manifestPath);
  if (sha256(manifestBytes) !== releaseEntry.manifestSha256) throw new Error("Atlas manifest hash does not match the index");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.releaseId !== releaseEntry.releaseId) throw new Error("Atlas manifest names another release");
  const submissions = await readVerifiedRole(releaseRoot, manifest.roles.submissions, "submissions");
  const decomposition = await readVerifiedRole(releaseRoot, manifest.roles.decomposition, "decomposition");
  if (!["+", "-"].includes(submissions.direction)) throw new Error("Atlas submissions direction is invalid");

  const dated = submissions.submissions.filter((submission) => submission.createdAt !== null || submission.commitSha !== null);
  for (const submission of dated) {
    if (submission.createdAt === null || submission.commitSha === null) {
      throw new Error(`submission ${submission.id} has only one of createdAt and commitSha`);
    }
    requireIsoTimestamp(submission.createdAt, `submission ${submission.id}.createdAt`);
  }
  dated.sort((left, right) => compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id));
  const effectiveCutoff = cutoff ?? dated.at(-1)?.createdAt;
  if (effectiveCutoff === undefined) throw new Error("Atlas release has no dated submissions");
  requireIsoTimestamp(effectiveCutoff, "history cutoff");
  const selected = dated.filter((submission) => submission.createdAt <= effectiveCutoff);
  if (expectedCount !== null && selected.length !== expectedCount) {
    throw new Error(`dated calibration cohort has ${selected.length} events; expected ${expectedCount}`);
  }
  const context = {
    taskId: manifest.benchmark.id,
    metricName: manifest.benchmark.unit,
    direction: submissions.direction,
    releaseId: manifest.releaseId,
    manifestSha256: releaseEntry.manifestSha256,
    submissionsDescriptor: manifest.roles.submissions,
    decompositionDescriptor: manifest.roles.decomposition,
    routeBySubmission: new Map(decomposition.submissionRoutes.map((route) => [route.submissionId, route])),
    witnessById: new Map(decomposition.mutationWitnesses.map((witness) => [witness.witnessId, witness])),
  };
  const sourceSetCore = {
    releaseId: manifest.releaseId,
    manifestSha256: releaseEntry.manifestSha256,
    sources: [
      { path: manifest.roles.submissions.path, sha256: manifest.roles.submissions.sha256 },
      { path: manifest.roles.decomposition.path, sha256: manifest.roles.decomposition.sha256 },
    ],
  };
  context.sourceSetId = sha256(sourceSetCore);
  const sourceSets = [{ sourceSetId: context.sourceSetId, ...sourceSetCore }];
  const events = selected.map((submission) => buildResearchEvent(submission, context));
  const selection = {
    predicate: "createdAt_and_commitSha_present_and_createdAt_lte_cutoff",
    cutoff: effectiveCutoff,
    selectedEventIds: events.map((event) => event.eventId),
    excludedUndated: submissions.submissions.length - dated.length,
    excludedAfterCutoff: dated.length - selected.length,
  };
  return {
    events,
    target: {
      taskId: manifest.benchmark.id,
      metricName: manifest.benchmark.unit,
      direction: submissions.direction,
    },
    cutoff: effectiveCutoff,
    releaseId: manifest.releaseId,
    manifestSha256: releaseEntry.manifestSha256,
    selection,
    cutoffSealSha256: sha256({
      releaseId: manifest.releaseId,
      manifestSha256: releaseEntry.manifestSha256,
      selection,
    }),
    sourceSets,
  };
}

export function buildEcdsaVerificationPlan(cohort, selection) {
  const selected = requireObject(selection, "ECDSA history selection");
  requireExactKeys(selected, [
    "candidate_path",
    "checkpoint_ref",
    "minimum_headroom_meaningful_gains",
    "official_baseline_score",
    "reference_event_id",
    "release_id",
    "repository_url",
    "schema",
    "task_ref",
    "verifier_run",
    "verifier_tree_sha256",
    "windows",
  ], "ECDSA history selection");
  if (selected.schema !== "yukon.ecdsa-history-selection.v1") {
    throw new Error("unsupported ECDSA history selection schema");
  }
  if (selected.release_id !== cohort.releaseId) {
    throw new Error("ECDSA history selection names another sealed release");
  }
  for (const key of ["repository_url", "task_ref", "checkpoint_ref", "verifier_run"]) {
    requireString(selected[key], `ECDSA history selection.${key}`);
  }
  assertSafeRelativePath(selected.candidate_path, "ECDSA history selection.candidate_path");
  if (!HEX_64.test(selected.verifier_tree_sha256)) {
    throw new Error("ECDSA history selection.verifier_tree_sha256 is invalid");
  }
  const officialBaseline = requireFiniteOrNull(
    selected.official_baseline_score,
    "ECDSA history selection.official_baseline_score",
  );
  if (officialBaseline === null) throw new Error("ECDSA official baseline is required");
  const minimumHeadroom = selected.minimum_headroom_meaningful_gains;
  if (typeof minimumHeadroom !== "number" || !Number.isFinite(minimumHeadroom) || minimumHeadroom <= 0) {
    throw new Error("ECDSA minimum headroom must be positive");
  }
  if (!Array.isArray(selected.windows) || selected.windows.length === 0) {
    throw new Error("ECDSA history selection.windows must be non-empty");
  }

  const eventsById = new Map(cohort.events.map((event) => [event.eventId, event]));
  const sequenceById = new Map(cohort.events.map((event, index) => [event.eventId, index]));
  const reference = eventsById.get(requireString(
    selected.reference_event_id,
    "ECDSA history selection.reference_event_id",
  ));
  if (reference === undefined || reference.outcome.validity !== "unknown" || reference.outcome.score === null) {
    throw new Error("ECDSA reference event is absent or has no sealed score");
  }
  const meaningfulGain = Math.abs(officialBaseline - reference.outcome.score) * 0.1;
  if (!(meaningfulGain > 0)) throw new Error("ECDSA meaningful-gain denominator is zero");

  const admittedIds = new Set();
  const requiredIds = new Set([reference.eventId]);
  const windows = selected.windows.map((rawWindow, windowIndex) => {
    const label = `ECDSA history selection.windows[${windowIndex}]`;
    requireExactKeys(rawWindow, ["base_event_id", "event_ids", "id", "start_event_id"], label);
    const id = requireString(rawWindow.id, `${label}.id`);
    const baseId = requireString(rawWindow.base_event_id, `${label}.base_event_id`);
    const eventIds = requireStringArray(rawWindow.event_ids, `${label}.event_ids`);
    const startId = requireString(rawWindow.start_event_id, `${label}.start_event_id`);
    if (eventIds.length === 0 || startId !== eventIds.at(-1)) {
      throw new Error(`${label} must end at start_event_id`);
    }
    const base = eventsById.get(baseId);
    if (base === undefined) throw new Error(`${label}.base_event_id is absent from the cohort`);
    let parentId = baseId;
    let previousSequence = sequenceById.get(baseId);
    for (const eventId of eventIds) {
      const event = eventsById.get(eventId);
      if (event === undefined) throw new Error(`${label} event ${eventId} is absent from the cohort`);
      const sequence = sequenceById.get(eventId);
      if (sequence <= previousSequence) throw new Error(`${label} event order is not increasing`);
      if (event.baseArtifactId !== parentId) {
        throw new Error(`${label} is not a direct candidate lineage at ${eventId}`);
      }
      if (admittedIds.has(eventId)) throw new Error(`ECDSA history windows overlap at ${eventId}`);
      admittedIds.add(eventId);
      requiredIds.add(eventId);
      parentId = eventId;
      previousSequence = sequence;
    }
    requiredIds.add(baseId);
    const start = eventsById.get(startId);
    if (start.outcome.status !== "promoted" || start.outcome.score === null) {
      throw new Error(`${label} start event is not a scored promoted candidate`);
    }
    if (start.sequence.value >= reference.sequence.value) {
      throw new Error(`${label} reference must remain after the history cutoff`);
    }
    const rawHeadroom = cohort.target.direction === "-"
      ? start.outcome.score - reference.outcome.score
      : reference.outcome.score - start.outcome.score;
    const headroomMeaningfulGains = rawHeadroom / meaningfulGain;
    if (headroomMeaningfulGains < minimumHeadroom) {
      throw new Error(`${label} has only ${headroomMeaningfulGains} meaningful gains of sealed headroom`);
    }
    return {
      id,
      base_event_id: baseId,
      event_ids: eventIds,
      start_event_id: startId,
      cutoff: start.sequence.value,
      starting_score: start.outcome.score,
      reference_score: reference.outcome.score,
      headroom: rawHeadroom,
      headroom_meaningful_gains: headroomMeaningfulGains,
    };
  });
  if (new Set(windows.map((window) => window.id)).size !== windows.length) {
    throw new Error("ECDSA history window IDs must be unique");
  }

  const events = cohort.events
    .filter((event) => requiredIds.has(event.eventId))
    .map((event) => ({
      event_id: event.eventId,
      sequence: event.sequence.value,
      commit_sha: event.commitSha,
      base_event_id: eventsById.has(event.baseArtifactId) ? event.baseArtifactId : null,
      roles: sortedUnique([
        ...(event.eventId === reference.eventId ? ["reference"] : []),
        ...windows.filter((window) => window.base_event_id === event.eventId).map((window) => `base:${window.id}`),
        ...windows.filter((window) => window.event_ids.includes(event.eventId)).map((window) => `event:${window.id}`),
        ...windows.filter((window) => window.start_event_id === event.eventId).map((window) => `start:${window.id}`),
      ]),
      changes: {
        paths: event.changeSet.changedPaths,
        symbols: event.changeSet.changedSymbols,
        configuration: event.changeSet.configuration,
        interventions: event.interventions,
      },
      expected: {
        status: event.outcome.status,
        source_status: event.outcome.sourceStatus,
        classification: event.outcome.classification,
        score: event.outcome.score,
        comparator_event_id: event.outcome.comparatorArtifactId,
        comparator_score: event.outcome.comparatorScore,
        raw_delta: event.outcome.rawDelta,
        directional_gain: event.outcome.directionalGain,
      },
    }));
  if (events.length !== requiredIds.size) {
    throw new Error("ECDSA verification plan requires an event outside the sealed cohort");
  }
  return {
    schema: "yukon.ecdsa-verification-plan.v1",
    source: {
      release_id: cohort.releaseId,
      manifest_sha256: cohort.manifestSha256,
      cutoff: cohort.cutoff,
      cutoff_seal_sha256: cohort.cutoffSealSha256,
      repository_url: selected.repository_url,
      source_sets: cohort.sourceSets,
    },
    target: {
      task_ref: selected.task_ref,
      task_id: cohort.target.taskId,
      checkpoint_ref: selected.checkpoint_ref,
      candidate_path: selected.candidate_path,
      // The Atlas release label is a human-facing unit. Dungeness and the
      // sealed verifier exchange the executable metric key below.
      metric_name: "ecdsafail_score",
      direction: cohort.target.direction,
      official_baseline_score: officialBaseline,
      reference_event_id: reference.eventId,
      reference_score: reference.outcome.score,
      meaningful_gain: meaningfulGain,
    },
    verifier: {
      source_run: selected.verifier_run,
      tree_sha256: selected.verifier_tree_sha256,
    },
    windows,
    events,
  };
}

const DUNGENESS_EXPORT_SCHEMA_V1 = "dungeness.trusted-research-events.v1";
const DUNGENESS_EXPORT_SCHEMA_V2 = "dungeness.trusted-research-events.v2";
const DUNGENESS_EVENT_KEYS = Object.freeze([
  "budget",
  "candidate_commit_sha",
  "candidate_paths",
  "changes",
  "content_sha256",
  "cost",
  "created_at",
  "development_outcome",
  "evaluation_id",
  "exact_diff",
  "execution",
  "parent_content_sha256",
  "payload",
  "provenance",
  "timing",
]);
const DUNGENESS_EVENT_V2_KEYS = Object.freeze([...DUNGENESS_EVENT_KEYS, "interventions"]);
const DUNGENESS_MEASUREMENT_KEYS = Object.freeze([
  "admission",
  "comparator_content_sha256",
  "comparator_hops",
  "comparator_score",
  "direction",
  "directional_gain",
  "metric_name",
  "raw_delta",
  "score",
  "status",
  "validity",
]);
const DUNGENESS_EXECUTION_KEYS = Object.freeze([
  "evaluation_cost",
  "evaluation_id",
  "model_cost",
  "model_id",
  "model_provider",
  "reasoning_effort",
  "total_cost",
]);

function compactPayloadDescriptor(payloadValue, contentSha256, label) {
  const payload = requireObject(payloadValue, `${label}.payload`);
  requireExactKeys(
    payload,
    ["algorithm", "bytes", "file_count", "files", "sha256"],
    `${label}.payload`,
  );
  const algorithm = requireString(payload.algorithm, `${label}.payload.algorithm`);
  if (!HEX_64.test(payload.sha256) || payload.sha256 !== contentSha256) {
    throw new Error(`${label}.payload hash differs from candidate content hash`);
  }
  if (!Number.isInteger(payload.bytes) || payload.bytes < 0) {
    throw new TypeError(`${label}.payload.bytes must be a non-negative integer`);
  }
  if (!Number.isInteger(payload.file_count) || payload.file_count < 1) {
    throw new TypeError(`${label}.payload.file_count must be a positive integer`);
  }
  if (!Array.isArray(payload.files) || payload.files.length !== payload.file_count) {
    throw new Error(`${label}.payload file count differs from its manifest`);
  }
  const paths = new Set();
  let manifestBytes = 0;
  for (const [fileIndex, rawFile] of payload.files.entries()) {
    const fileLabel = `${label}.payload.files[${fileIndex}]`;
    const file = requireObject(rawFile, fileLabel);
    requireExactKeys(file, ["bytes", "path", "sha256"], fileLabel);
    const filePath = assertSafeRelativePath(file.path, `${fileLabel}.path`);
    if (paths.has(filePath)) throw new Error(`${label}.payload manifest repeats ${filePath}`);
    paths.add(filePath);
    if (!HEX_64.test(file.sha256)) throw new Error(`${fileLabel}.sha256 is invalid`);
    if (!Number.isInteger(file.bytes) || file.bytes < 0) {
      throw new TypeError(`${fileLabel}.bytes must be a non-negative integer`);
    }
    manifestBytes += file.bytes;
  }
  if (manifestBytes !== payload.bytes) {
    throw new Error(`${label}.payload byte count differs from its manifest`);
  }
  return {
    algorithm,
    bytes: payload.bytes,
    fileCount: payload.file_count,
    sha256: payload.sha256,
  };
}

function contentAddressedRecord(value) {
  return { sha256: sha256(canonicalStringify(value)) };
}

export function adaptDungenessTrustedExport(value, {
  sourcePath,
  sourceSha256,
  exportId = sourceSha256,
} = {}) {
  const exported = requireObject(value, "Dungeness trusted export");
  requireExactKeys(
    exported,
    ["checkpoint", "environment", "events", "harness", "run", "schema", "seed", "selection", "task"],
    "Dungeness trusted export",
  );
  if (![DUNGENESS_EXPORT_SCHEMA_V1, DUNGENESS_EXPORT_SCHEMA_V2].includes(exported.schema)) {
    throw new Error("unsupported Dungeness trusted export schema");
  }
  const hasRecordedInterventions = exported.schema === DUNGENESS_EXPORT_SCHEMA_V2;
  for (const key of ["checkpoint", "environment", "harness", "run", "seed", "task"]) {
    requireObject(exported[key], `Dungeness trusted export.${key}`);
  }
  const taskId = requireString(exported.task.ref, "Dungeness trusted export.task.ref");
  const checkpointId = requireString(exported.checkpoint.ref, "Dungeness trusted export.checkpoint.ref");
  requireString(exported.run.id, "Dungeness trusted export.run.id");
  const safeSourcePath = assertSafeRelativePath(sourcePath, "Dungeness export sourcePath");
  if (!HEX_64.test(sourceSha256)) throw new Error("Dungeness export sourceSha256 is invalid");
  requireString(exportId, "Dungeness exportId");
  if (!Array.isArray(exported.events)) throw new Error("Dungeness trusted export.events must be an array");
  if (!Array.isArray(exported.selection) || canonicalStringify(exported.selection) !== canonicalStringify(exported.events.map((row) => row.evaluation_id))) {
    throw new Error("Dungeness trusted export selection differs from its event order");
  }
  const sourceSetCore = {
    releaseId: exportId,
    manifestSha256: sourceSha256,
    sources: [{ path: safeSourcePath, sha256: sourceSha256 }],
  };
  const sourceSetId = sha256(sourceSetCore);
  const events = exported.events.map((row, index) => {
    const label = `Dungeness trusted export.events[${index}]`;
    requireExactKeys(row, hasRecordedInterventions ? DUNGENESS_EVENT_V2_KEYS : DUNGENESS_EVENT_KEYS, label);
    const exactDiff = requireObject(row.exact_diff, `${label}.exact_diff`);
    requireExactKeys(exactDiff, ["sha256", "text"], `${label}.exact_diff`);
    const changes = requireObject(row.changes, `${label}.changes`);
    requireExactKeys(changes, ["config", "detection", "paths", "symbols"], `${label}.changes`);
    const developmentOutcome = requireObject(row.development_outcome, `${label}.development_outcome`);
    requireExactKeys(developmentOutcome, ["measurement", "metric", "status", "valid"], `${label}.development_outcome`);
    const measurement = requireObject(developmentOutcome.measurement, `${label}.development_outcome.measurement`);
    requireExactKeys(measurement, DUNGENESS_MEASUREMENT_KEYS, `${label}.development_outcome.measurement`);
    requireExactKeys(row.execution, DUNGENESS_EXECUTION_KEYS, `${label}.execution`);
    requireExactKeys(row.provenance, ["event_path", "event_sha256", "source_transport_sha256"], `${label}.provenance`);
    for (const key of ["budget", "cost", "timing"]) {
      requireObject(row[key], `${label}.${key}`);
      normalize(row[key]);
    }
    assertSafeRelativePath(row.provenance.event_path, `${label}.provenance.event_path`);
    requireIsoTimestamp(row.created_at, `${label}.created_at`);
    if (!HEX_64.test(row.parent_content_sha256) || !HEX_64.test(row.content_sha256)) {
      throw new Error(`${label} must contain trusted base and candidate content hashes`);
    }
    const payload = compactPayloadDescriptor(row.payload, row.content_sha256, label);
    if (row.candidate_commit_sha !== null && !COMMIT_SHA.test(row.candidate_commit_sha)) {
      throw new Error(`${label}.candidate_commit_sha is invalid`);
    }
    if (!HEX_64.test(exactDiff.sha256) || sha256(exactDiff.text) !== exactDiff.sha256) {
      throw new Error(`${label}.exact_diff hash does not match its text`);
    }
    const changedPaths = requireStringArray(changes.paths, `${label}.changes.paths`);
    changedPaths.forEach((changedPath) => assertSafeRelativePath(changedPath, `${label}.changes.paths item`));
    const changedSymbols = requireStringArray(changes.symbols, `${label}.changes.symbols`);
    const interventions = hasRecordedInterventions ? row.interventions : [];
    if (!Array.isArray(interventions)) throw new Error(`${label}.interventions must be an array`);
    requireStringArray(changes.config, `${label}.changes.config`);
    requireString(changes.detection, `${label}.changes.detection`);
    if (!Array.isArray(row.candidate_paths) || row.candidate_paths.length === 0) throw new Error(`${label}.candidate_paths must be non-empty`);
    row.candidate_paths.forEach((candidatePath) => assertSafeRelativePath(candidatePath, `${label}.candidate_paths item`));
    for (const key of ["evaluation_id", "model_provider", "model_id"]) {
      requireString(row.execution[key], `${label}.execution.${key}`);
    }
    requireNullableString(row.execution.reasoning_effort, `${label}.execution.reasoning_effort`);
    for (const key of ["model_cost", "evaluation_cost", "total_cost"]) {
      if (row.execution[key] === null) throw new Error(`${label}.execution.${key} is required`);
      normalize(row.execution[key]);
    }
    for (const key of ["event_sha256", "source_transport_sha256"]) {
      if (!HEX_64.test(row.provenance[key])) throw new Error(`${label}.provenance.${key} is invalid`);
    }
    if (!ALLOWED_VALIDITY.has(measurement.validity) || !ALLOWED_ADMISSIONS.has(measurement.admission)) {
      throw new Error(`${label} measurement validity/admission is invalid`);
    }
    if (!["+", "-"].includes(measurement.direction)) throw new Error(`${label} measurement direction is invalid`);
    const eventId = `${exported.run.id}:${row.evaluation_id}`;
    const evidenceSha256 = sortedUnique([
      sourceSha256,
      row.parent_content_sha256,
      row.content_sha256,
      exactDiff.sha256,
      row.provenance.event_sha256,
      row.provenance.source_transport_sha256,
    ]);
    const event = {
      schema: RESEARCH_EVENT_SCHEMA,
      eventId,
      sequence: { kind: "timestamp", value: row.created_at },
      baseArtifactId: row.parent_content_sha256,
      baseArtifactSha256: row.parent_content_sha256,
      candidateArtifactId: row.content_sha256,
      candidateArtifactSha256: row.content_sha256,
      commitSha: row.candidate_commit_sha,
      changeSet: {
        diff: { text: exactDiff.text, sha256: exactDiff.sha256 },
        changedPaths,
        changedSymbols,
        configuration: { keys: changes.config, detection: changes.detection },
      },
      interventions,
      conditions: {
        taskId,
        checkpointId,
        bundleSize: interventions.length,
        policyCoupled: false,
        routeInterpretation: "unknown",
        hasUnresolved: changedPaths.length > 0,
        configuration: {
          candidatePaths: row.candidate_paths,
          payload,
          transportProjection: "content-addressed-summary-v1",
        },
        seed: contentAddressedRecord(exported.seed),
        environment: contentAddressedRecord(exported.environment),
        harness: contentAddressedRecord(exported.harness),
      },
      execution: {
        evaluationId: row.execution.evaluation_id,
        modelProvider: row.execution.model_provider,
        modelId: row.execution.model_id,
        reasoningEffort: row.execution.reasoning_effort,
        modelCost: row.execution.model_cost,
        evaluationCost: row.execution.evaluation_cost,
        totalCost: row.execution.total_cost,
      },
      outcome: {
        status: measurement.status,
        sourceStatus: developmentOutcome.status,
        validity: measurement.validity,
        classification: null,
        metricName: measurement.metric_name,
        direction: measurement.direction,
        score: measurement.score,
        comparatorArtifactId: measurement.comparator_content_sha256,
        comparatorScore: measurement.comparator_score,
        comparatorHops: measurement.comparator_hops,
        rawDelta: measurement.raw_delta,
        directionalGain: measurement.directional_gain,
        scope: "whole_artifact",
        admission: measurement.admission,
      },
      provenance: {
        sourceSetId,
        evidenceSha256,
        selectors: [{
          sourceRef: 0,
          selector: `event:${row.evaluation_id}`,
        }],
      },
    };
    validateResearchEvent(event);
    return event;
  });
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("Dungeness trusted export repeats an eventId");
  }
  let metricName;
  let direction;
  if (events.length > 0) {
    metricName = events[0].outcome.metricName;
    direction = events[0].outcome.direction;
  } else {
    const metric = requireObject(exported.task.metric, "Dungeness trusted export.task.metric");
    metricName = requireString(metric.name, "Dungeness trusted export.task.metric.name");
    if (!["maximize", "minimize"].includes(metric.direction)) {
      throw new Error("Dungeness trusted export.task.metric.direction is invalid");
    }
    direction = metric.direction === "maximize" ? "+" : "-";
  }
  const target = { taskId, metricName, direction };
  for (const event of events) {
    if (event.conditions.taskId !== target.taskId || event.outcome.metricName !== target.metricName || event.outcome.direction !== target.direction) {
      throw new Error("Dungeness trusted export mixes task or metric contracts");
    }
  }
  return {
    target,
    events,
    checkpoint: checkpointId,
    exportId,
    sourcePath: safeSourcePath,
    sourceSha256,
    sourceSets: [{ sourceSetId, ...sourceSetCore }],
  };
}

function validateAtomTable(atomTable, expectedAtomSetSha256) {
  if (!Array.isArray(atomTable) || atomTable.length === 0) throw new Error("research view atomTable must be non-empty");
  for (const [index, entry] of atomTable.entries()) {
    requireExactKeys(entry, ["atom", "atomSha256", "eventId", "ref"], `atomTable[${index}]`);
    if (entry.ref !== index) throw new Error(`atomTable[${index}].ref is not canonical`);
    validateResearchEvent(entry.atom);
    if (entry.eventId !== entry.atom.eventId) throw new Error(`atomTable[${index}] eventId differs from its atom`);
    if (sha256(serializeResearchEvent(entry.atom)) !== entry.atomSha256) throw new Error(`atomTable[${index}] atom hash changed`);
  }
  if (atomSetHash(atomTable) !== expectedAtomSetSha256) throw new Error("research view atom-set hash changed");
}

export async function loadCompiledResearchView(manifestPath) {
  const absoluteManifest = path.resolve(requireString(manifestPath, "research-view manifest path"));
  if ((await fs.lstat(absoluteManifest)).isSymbolicLink()) throw new Error("research-view manifest must not be a symlink");
  const manifestBytes = await fs.readFile(absoluteManifest, "utf8");
  const manifestSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema_version !== 1 || manifest.type !== "research-view") throw new Error("unsupported Dungeness research-view manifest");
  if (!HEX_64.test(manifest.id) || path.basename(absoluteManifest) !== `${manifest.id}.yaml`) {
    throw new Error("research-view manifest filename must equal its payload tree hash");
  }
  const data = requireObject(manifest.data, "research-view manifest.data");
  const renderer = requireObject(data.renderer, "research-view manifest.data.renderer");
  requireExactKeys(
    renderer,
    ["commit", "source_files", "source_sha256", "variant", "version"],
    "research-view manifest.data.renderer",
  );
  if (renderer.version !== RENDERER_VERSION || !REPRESENTATIONS.includes(renderer.variant)) {
    throw new Error("research-view manifest names an unsupported renderer");
  }
  const currentRenderer = await currentRendererProvenance();
  if (canonicalStringify({
    commit: renderer.commit,
    source_sha256: renderer.source_sha256,
    source_files: renderer.source_files,
  }) !== canonicalStringify(currentRenderer)) {
    throw new Error("research-view renderer source differs from the current compiler");
  }
  const payloadDescriptor = requireObject(data.payload, "research-view manifest.data.payload");
  requireExactKeys(payloadDescriptor, ["root", "sha256"], "research-view manifest.data.payload");
  if (payloadDescriptor.sha256 !== manifest.id) throw new Error("research-view id and payload hash differ");
  if (payloadDescriptor.root !== `${manifest.id}.payload`) throw new Error("research-view payload root must be its opaque tree hash");
  const payloadPath = safePath(path.dirname(absoluteManifest), payloadDescriptor.root, "research-view payload root");
  if ((await fs.lstat(payloadPath)).isSymbolicLink()) throw new Error("research-view payload root must not be a symlink");
  const entries = await fs.readdir(payloadPath, { withFileTypes: true });
  const mountedFiles = {};
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`research-view payload contains a non-regular file: ${entry.name}`);
    mountedFiles[entry.name] = await fs.readFile(path.join(payloadPath, entry.name), "utf8");
  }
  const tree = treeSnapshotForFiles(mountedFiles);
  if (tree.sha256 !== manifest.id) throw new Error("research-view payload tree hash changed");
  if (canonicalStringify(data.file_manifest) !== canonicalStringify(tree.files)) {
    throw new Error("research-view file manifest changed");
  }
  const authoredTree = requireObject(data.tree, "research-view manifest.data.tree");
  if (
    authoredTree.algorithm !== tree.algorithm
    || authoredTree.sha256 !== tree.sha256
    || authoredTree.file_count !== tree.fileCount
    || authoredTree.bytes !== tree.bytes
  ) throw new Error("research-view tree accounting changed");
  if (!("atoms.json" in mountedFiles) || !("index.md" in mountedFiles)) {
    throw new Error("research-view payload must contain atoms.json and index.md");
  }
  const decoded = decodeAtomsDocument(JSON.parse(mountedFiles["atoms.json"]));
  const index = parseIndexMarkdown(
    mountedFiles["index.md"],
    decoded.document.stringTable,
  );
  validateIndexRefs(index, decoded.atomTable.length, "loaded research-view index");
  assertNoAdvisoryDerivation(index, "loaded research-view index");
  if (data.atom_set_sha256 !== decoded.document.atomSetSha256) throw new Error("manifest and atoms document atom-set hashes differ");
  if (data.source_history_sha256 !== decoded.document.cutoffSealSha256) throw new Error("manifest and atoms document history seals differ");
  if (data.cutoff !== decoded.document.historyCutoff) throw new Error("manifest and atoms document cutoffs differ");
  const tokens = requireObject(data.tokens, "research-view manifest.data.tokens");
  if (tokens.total !== Math.ceil(tree.bytes / 2) || tokens.index !== countDeterministicTokens(mountedFiles["index.md"])) {
    throw new Error("research-view token accounting changed");
  }
  const payload = {
    schema: RESEARCH_VIEW_SCHEMA,
    rendererVersion: RENDERER_VERSION,
    historyCutoff: decoded.document.historyCutoff,
    cutoffSealSha256: decoded.document.cutoffSealSha256,
    target: decoded.document.target,
    atomSetSha256: decoded.document.atomSetSha256,
    sourceSets: decoded.document.sourceSets,
    atomTable: decoded.atomTable,
  };
  return {
    manifest,
    manifestBytes,
    manifestSha256,
    payload,
    payloadPath,
    mountedFiles,
    tree,
    index,
  };
}

export function appendDungenessEvents(historyPayload, adaptedExport, { limits = DEFAULT_TOKEN_LIMITS } = {}) {
  requireObject(historyPayload, "history payload");
  if (historyPayload.schema !== RESEARCH_VIEW_SCHEMA) throw new Error("history payload has unsupported schema");
  validateAtomTable(historyPayload.atomTable, historyPayload.atomSetSha256);
  requireObject(adaptedExport, "adapted Dungeness export");
  validateTarget(adaptedExport.target);
  if (canonicalStringify(historyPayload.target) !== canonicalStringify(adaptedExport.target)) {
    throw new Error("Dungeness export metric contract differs from the canonical history");
  }
  const priorIds = new Set(historyPayload.atomTable.map((entry) => entry.eventId));
  for (const event of adaptedExport.events) {
    validateResearchEvent(event);
    if (priorIds.has(event.eventId)) throw new Error(`Dungeness export repeats prior event ${event.eventId}`);
    if (event.sequence.value <= historyPayload.historyCutoff) {
      throw new Error(`Dungeness event ${event.eventId} is not strictly after the prior sealed cutoff`);
    }
  }
  const events = [
    ...historyPayload.atomTable.map((entry) => entry.atom),
    ...adaptedExport.events,
  ];
  const cutoff = [...adaptedExport.events].sort(compareEvents).at(-1).sequence.value;
  const cutoffSealSha256 = sha256({
    parentPayloadSha256: sha256(canonicalStringify(historyPayload)),
    priorCutoffSealSha256: historyPayload.cutoffSealSha256,
    exportSha256: adaptedExport.sourceSha256,
    cutoff,
    appendedEventIds: [...adaptedExport.events].sort(compareEvents).map((event) => event.eventId),
  });
  const sourceSets = [...historyPayload.sourceSets, ...adaptedExport.sourceSets];
  return compileResearchViews({ events, sourceSets, target: historyPayload.target, cutoff, cutoffSealSha256, limits });
}

export function compileDungenessEvents(adaptedExport, { limits = DEFAULT_TOKEN_LIMITS } = {}) {
  requireObject(adaptedExport, "adapted Dungeness export");
  validateTarget(adaptedExport.target);
  if (!Array.isArray(adaptedExport.events) || adaptedExport.events.length === 0) {
    throw new Error("adapted Dungeness export must contain at least one event");
  }
  if (!HEX_64.test(adaptedExport.sourceSha256)) {
    throw new Error("adapted Dungeness export sourceSha256 is invalid");
  }
  const events = [...adaptedExport.events].sort(compareEvents);
  const cutoff = events.at(-1).sequence.value;
  const cutoffSealSha256 = sha256({
    schema: "dungeness.research-history-seal.v1",
    sourceSha256: adaptedExport.sourceSha256,
    target: adaptedExport.target,
    cutoff,
    eventIds: events.map((event) => event.eventId),
  });
  return compileResearchViews({
    events,
    sourceSets: adaptedExport.sourceSets,
    target: adaptedExport.target,
    cutoff,
    cutoffSealSha256,
    limits,
  });
}

export function compileDungenessCampaign(
  adaptedExports,
  { campaignManifestSha256, limits = DEFAULT_TOKEN_LIMITS } = {},
) {
  if (!Array.isArray(adaptedExports) || adaptedExports.length === 0) {
    throw new Error("Dungeness campaign requires at least one adapted export");
  }
  if (!HEX_64.test(campaignManifestSha256)) {
    throw new Error("Dungeness campaign manifest SHA-256 is invalid");
  }
  const [first] = adaptedExports;
  requireObject(first, "adapted Dungeness campaign export");
  validateTarget(first.target);
  const events = [];
  const sourceSets = [];
  const sourceSha256 = [];
  const eventIds = new Set();
  for (const [index, adapted] of adaptedExports.entries()) {
    requireObject(adapted, `adapted Dungeness campaign export[${index}]`);
    validateTarget(adapted.target);
    if (canonicalStringify(adapted.target) !== canonicalStringify(first.target)) {
      throw new Error("Dungeness campaign mixes task or metric contracts");
    }
    if (adapted.checkpoint !== first.checkpoint) {
      throw new Error("Dungeness campaign mixes checkpoints");
    }
    if (!HEX_64.test(adapted.sourceSha256)) {
      throw new Error("Dungeness campaign export source SHA-256 is invalid");
    }
    sourceSha256.push(adapted.sourceSha256);
    sourceSets.push(...adapted.sourceSets);
    for (const event of adapted.events) {
      validateResearchEvent(event);
      if (eventIds.has(event.eventId)) {
        throw new Error(`Dungeness campaign repeats event ${event.eventId}`);
      }
      eventIds.add(event.eventId);
      events.push(event);
    }
  }
  if (new Set(sourceSha256).size !== sourceSha256.length) {
    throw new Error("Dungeness campaign repeats an export source");
  }
  if (events.length === 0) {
    throw new Error("Dungeness campaign must contain at least one observed event");
  }
  const orderedEvents = [...events].sort(compareEvents);
  const cutoff = orderedEvents.at(-1).sequence.value;
  const cutoffSealSha256 = sha256({
    schema: "dungeness.research-campaign-seal.v1",
    campaignManifestSha256,
    sourceSha256,
    target: first.target,
    cutoff,
    eventIds: orderedEvents.map((event) => event.eventId),
  });
  return compileResearchViews({
    events: orderedEvents,
    sourceSets,
    target: first.target,
    cutoff,
    cutoffSealSha256,
    limits,
  });
}

function validateSourceSets(sourceSets, events = []) {
  if (!Array.isArray(sourceSets) || sourceSets.length === 0) throw new Error("research views require sourceSets");
  const byId = new Map();
  for (const [index, sourceSet] of sourceSets.entries()) {
    const label = `sourceSets[${index}]`;
    requireExactKeys(sourceSet, EXACT_SOURCE_SET_KEYS, label);
    if (!HEX_64.test(sourceSet.sourceSetId)) throw new Error(`${label}.sourceSetId is invalid`);
    requireString(sourceSet.releaseId, `${label}.releaseId`);
    if (!HEX_64.test(sourceSet.manifestSha256)) throw new Error(`${label}.manifestSha256 is invalid`);
    if (!Array.isArray(sourceSet.sources) || sourceSet.sources.length === 0) throw new Error(`${label}.sources must be non-empty`);
    for (const [sourceIndex, source] of sourceSet.sources.entries()) {
      const sourceLabel = `${label}.sources[${sourceIndex}]`;
      requireExactKeys(source, EXACT_SOURCE_KEYS, sourceLabel);
      assertSafeRelativePath(source.path, `${sourceLabel}.path`);
      if (!HEX_64.test(source.sha256)) throw new Error(`${sourceLabel}.sha256 is invalid`);
    }
    const core = {
      releaseId: sourceSet.releaseId,
      manifestSha256: sourceSet.manifestSha256,
      sources: sourceSet.sources,
    };
    if (sha256(core) !== sourceSet.sourceSetId) throw new Error(`${label} content hash changed`);
    if (byId.has(sourceSet.sourceSetId)) throw new Error(`duplicate sourceSetId: ${sourceSet.sourceSetId}`);
    byId.set(sourceSet.sourceSetId, sourceSet);
  }
  for (const event of events) {
    const sourceSet = byId.get(event.provenance.sourceSetId);
    if (sourceSet === undefined) throw new Error(`ResearchEvent ${event.eventId} names an absent source set`);
    for (const selector of event.provenance.selectors) {
      if (selector.sourceRef >= sourceSet.sources.length) {
        throw new Error(`ResearchEvent ${event.eventId} has an invalid sourceRef`);
      }
    }
  }
  return [...sourceSets].sort((left, right) => compareText(left.sourceSetId, right.sourceSetId));
}

function buildAtomTable(events) {
  const sorted = [...events].sort((left, right) => compareText(left.eventId, right.eventId));
  return sorted.map((event, ref) => {
    const bytes = serializeResearchEvent(event);
    return { ref, eventId: event.eventId, atomSha256: sha256(bytes), atom: event };
  });
}

function atomSetHash(atomTable) {
  return sha256(atomTable.map(({ eventId, atomSha256 }) => ({ eventId, atomSha256 })));
}

const ATOM_FIELD_ORDER = Object.freeze({
  event: [
    "eventId",
    "timestamp",
    "baseArtifactId",
    "baseArtifactSha256",
    "candidateArtifactId",
    "candidateArtifactSha256",
    "commitSha",
    "changeSet",
    "interventions",
    "conditions",
    "execution",
    "outcome",
    "provenance",
  ],
  changeSet: ["diffText", "diffSha256", "changedPaths", "changedSymbols", "configuration"],
  intervention: [...EXACT_INTERVENTION_KEYS],
  conditions: [...EXACT_CONDITION_KEYS],
  execution: [...EXACT_EXECUTION_KEYS],
  outcome: [...EXACT_OUTCOME_KEYS],
  provenance: ["sourceSetId", "evidenceSha256", "selectors"],
  selector: [...EXACT_SELECTOR_KEYS],
});

function valuesForKeys(value, keys) {
  return keys.map((key) => value[key]);
}

function encodeResearchEvent(event) {
  return [
    event.eventId,
    event.sequence.value,
    event.baseArtifactId,
    event.baseArtifactSha256,
    event.candidateArtifactId,
    event.candidateArtifactSha256,
    event.commitSha,
    [
      event.changeSet.diff.text,
      event.changeSet.diff.sha256,
      event.changeSet.changedPaths,
      event.changeSet.changedSymbols,
      event.changeSet.configuration,
    ],
    event.interventions.map((item) => valuesForKeys(item, ATOM_FIELD_ORDER.intervention)),
    valuesForKeys(event.conditions, ATOM_FIELD_ORDER.conditions),
    valuesForKeys(event.execution, ATOM_FIELD_ORDER.execution),
    valuesForKeys(event.outcome, ATOM_FIELD_ORDER.outcome),
    [
      event.provenance.sourceSetId,
      event.provenance.evidenceSha256,
      event.provenance.selectors.map((item) => valuesForKeys(item, ATOM_FIELD_ORDER.selector)),
    ],
  ];
}

function collectStringValues(value, strings) {
  if (typeof value === "string") {
    strings.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, strings));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, strings));
  }
}

function collectStringFrequencies(value, frequencies) {
  if (typeof value === "string") {
    frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringFrequencies(item, frequencies));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => collectStringFrequencies(item, frequencies));
  }
}

function encodeStringValues(value, indexByString) {
  if (typeof value === "string") return indexByString.get(value).toString(36);
  if (Array.isArray(value)) return value.map((item) => encodeStringValues(item, indexByString));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      encodeStringValues(item, indexByString),
    ]));
  }
  return value;
}

function decodeStringValues(value, stringTable, label) {
  if (typeof value === "string") {
    if (!/^(?:0|[1-9a-z][0-9a-z]*)$/u.test(value)) throw new Error(`${label} has an invalid string reference`);
    const index = Number.parseInt(value, 36);
    if (!Number.isSafeInteger(index) || index < 0 || index >= stringTable.length) {
      throw new Error(`${label} has an out-of-range string reference`);
    }
    return stringTable[index];
  }
  if (Array.isArray(value)) return value.map((item, index) => decodeStringValues(item, stringTable, `${label}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      decodeStringValues(item, stringTable, `${label}.${key}`),
    ]));
  }
  return value;
}

function objectFromValues(keys, values, label) {
  if (!Array.isArray(values) || values.length !== keys.length) throw new Error(`${label} has the wrong column count`);
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function decodeResearchEvent(row) {
  const columns = objectFromValues(ATOM_FIELD_ORDER.event, row, "encoded ResearchEvent");
  const changeSet = objectFromValues(ATOM_FIELD_ORDER.changeSet, columns.changeSet, "encoded changeSet");
  const provenance = objectFromValues(ATOM_FIELD_ORDER.provenance, columns.provenance, "encoded provenance");
  const event = {
    schema: RESEARCH_EVENT_SCHEMA,
    eventId: columns.eventId,
    sequence: { kind: "timestamp", value: columns.timestamp },
    baseArtifactId: columns.baseArtifactId,
    baseArtifactSha256: columns.baseArtifactSha256,
    candidateArtifactId: columns.candidateArtifactId,
    candidateArtifactSha256: columns.candidateArtifactSha256,
    commitSha: columns.commitSha,
    changeSet: {
      diff: { text: changeSet.diffText, sha256: changeSet.diffSha256 },
      changedPaths: changeSet.changedPaths,
      changedSymbols: changeSet.changedSymbols,
      configuration: changeSet.configuration,
    },
    interventions: columns.interventions.map((item, index) => (
      objectFromValues(ATOM_FIELD_ORDER.intervention, item, `encoded intervention ${index}`)
    )),
    conditions: objectFromValues(ATOM_FIELD_ORDER.conditions, columns.conditions, "encoded conditions"),
    execution: objectFromValues(ATOM_FIELD_ORDER.execution, columns.execution, "encoded execution"),
    outcome: objectFromValues(ATOM_FIELD_ORDER.outcome, columns.outcome, "encoded outcome"),
    provenance: {
      sourceSetId: provenance.sourceSetId,
      evidenceSha256: provenance.evidenceSha256,
      selectors: provenance.selectors.map((item, index) => (
        objectFromValues(ATOM_FIELD_ORDER.selector, item, `encoded selector ${index}`)
      )),
    },
  };
  return validateResearchEvent(event);
}

function buildAtomsDocument({ atomTable, atomSetSha256, sourceSets, target, cutoff, cutoffSealSha256 }) {
  const rows = atomTable.map((entry) => encodeResearchEvent(entry.atom));
  const strings = new Set(atomTable.map((entry) => entry.atomSha256));
  rows.forEach((row) => collectStringValues(row, strings));
  const stringTable = [...strings].sort(compareText);
  const indexByString = new Map(stringTable.map((value, index) => [value, index]));
  return {
    schema: "yukon.research-atoms.columnar-string-table.v2",
    historyCutoff: cutoff,
    cutoffSealSha256,
    target,
    atomSetSha256,
    sourceSets,
    fieldOrder: ATOM_FIELD_ORDER,
    stringTable,
    atomSha256Refs: atomTable.map((entry) => indexByString.get(entry.atomSha256).toString(36)),
    events: rows.map((row) => encodeStringValues(row, indexByString)),
  };
}

function decodeAtomsDocument(value) {
  const document = requireObject(value, "research atoms document");
  if (document.schema !== "yukon.research-atoms.columnar-string-table.v2") throw new Error("unsupported research atoms document schema");
  if (canonicalStringify(document.fieldOrder) !== canonicalStringify(ATOM_FIELD_ORDER)) {
    throw new Error("research atoms document field order changed");
  }
  if (
    !Array.isArray(document.stringTable)
    || document.stringTable.length === 0
    || document.stringTable.some((value) => typeof value !== "string")
    || new Set(document.stringTable).size !== document.stringTable.length
    || canonicalStringify([...document.stringTable].sort(compareText)) !== canonicalStringify(document.stringTable)
  ) throw new Error("research atoms string table is invalid");
  if (!Array.isArray(document.events) || !Array.isArray(document.atomSha256Refs) || document.events.length !== document.atomSha256Refs.length) {
    throw new Error("research atoms document rows and hashes differ in length");
  }
  const events = document.events.map((row, index) => decodeResearchEvent(
    decodeStringValues(row, document.stringTable, `encoded ResearchEvent ${index}`),
  ));
  const atomSha256 = document.atomSha256Refs.map((reference, index) => (
    decodeStringValues(reference, document.stringTable, `atomSha256Refs[${index}]`)
  ));
  const atomTable = buildAtomTable(events);
  for (const [index, entry] of atomTable.entries()) {
    if (entry.atomSha256 !== atomSha256[index]) throw new Error(`research atom ${index} hash changed`);
  }
  validateAtomTable(atomTable, document.atomSetSha256);
  validateSourceSets(document.sourceSets, events);
  validateTarget(document.target);
  requireIsoTimestamp(document.historyCutoff, "research atoms historyCutoff");
  if (!HEX_64.test(document.cutoffSealSha256)) throw new Error("research atoms cutoff seal is invalid");
  return { document, events, atomTable };
}

function encodeIndexStringValues(value, atomIndex, localIndex) {
  if (typeof value === "string") {
    const atomRef = atomIndex.get(value);
    if (atomRef !== undefined) return `a${atomRef.toString(36)}`;
    const localRef = localIndex.get(value);
    return localRef === undefined ? `v${value}` : `l${localRef.toString(36)}`;
  }
  if (Array.isArray(value)) return value.map((item) => encodeIndexStringValues(item, atomIndex, localIndex));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      encodeIndexStringValues(item, atomIndex, localIndex),
    ]));
  }
  return value;
}

function decodeIndexStringValues(value, atomStrings, localStrings, label) {
  if (typeof value === "string") {
    if (value.startsWith("v")) return value.slice(1);
    const match = value.match(/^([al])(0|[1-9a-z][0-9a-z]*)$/u);
    if (match === null) throw new Error(`${label} has an invalid string reference`);
    const table = match[1] === "a" ? atomStrings : localStrings;
    const index = Number.parseInt(match[2], 36);
    if (!Number.isSafeInteger(index) || index < 0 || index >= table.length) {
      throw new Error(`${label} has an out-of-range string reference`);
    }
    return table[index];
  }
  if (Array.isArray(value)) return value.map((item, index) => (
    decodeIndexStringValues(item, atomStrings, localStrings, `${label}[${index}]`)
  ));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      decodeIndexStringValues(item, atomStrings, localStrings, `${label}.${key}`),
    ]));
  }
  return value;
}

function renderIndexMarkdown(index, atomsDocument) {
  const frequencies = new Map();
  collectStringFrequencies(index, frequencies);
  const atomIndex = new Map(atomsDocument.stringTable.map((value, position) => [value, position]));
  const localStringTable = [...frequencies.entries()]
    .filter(([value, count]) => count > 1 && !atomIndex.has(value))
    .map(([value]) => value)
    .sort(compareText);
  const localIndex = new Map(localStringTable.map((value, position) => [value, position]));
  const indexDocument = {
    schema: "yukon.research-index.string-table.v1",
    atomStringTableSha256: sha256(atomsDocument.stringTable),
    localStringTable,
    data: encodeIndexStringValues(index, atomIndex, localIndex),
  };
  const indexJson = canonicalStringify(indexDocument);
  return [
    "# Earlier Research",
    "",
    `History cutoff: ${atomsDocument.historyCutoff}`,
    `Metric: ${atomsDocument.target.metricName} (${atomsDocument.target.direction})`,
    `Atom set: ${atomsDocument.atomSetSha256}`,
    "",
    "Evidence: `atoms.json`. `stringTable` resolves base-36 references; atom `fieldOrder` names columns; index event refs are zero-based rows.",
    "",
    "## Index",
    "",
    "```json",
    indexJson,
    "```",
    "",
  ].join("\n");
}

function parseIndexMarkdown(text, atomStrings) {
  const match = text.match(/## Index\n\n```json\n([^\n]+)\n```\n?$/u);
  if (match === null) throw new Error("research-view index.md has no canonical JSON index");
  const document = JSON.parse(match[1]);
  requireExactKeys(
    document,
    ["atomStringTableSha256", "data", "localStringTable", "schema"],
    "research-view index document",
  );
  if (document.schema !== "yukon.research-index.string-table.v1") {
    throw new Error("research-view index has an unsupported schema");
  }
  if (
    !Array.isArray(atomStrings)
    || sha256(atomStrings) !== document.atomStringTableSha256
    || !Array.isArray(document.localStringTable)
    || document.localStringTable.some((value) => typeof value !== "string")
    || new Set(document.localStringTable).size !== document.localStringTable.length
    || canonicalStringify([...document.localStringTable].sort(compareText)) !== canonicalStringify(document.localStringTable)
  ) throw new Error("research-view index string table is invalid");
  return decodeIndexStringValues(
    document.data,
    atomStrings,
    document.localStringTable,
    "research-view index.data",
  );
}

function lengthBytes(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}

function treeSnapshotForFiles(files) {
  const entries = Object.entries(files).sort(([left], [right]) => compareText(left, right));
  if (entries.length === 0) throw new Error("research-view payload must contain files");
  const digest = createHash("sha256");
  let bytes = 0;
  const manifest = [];
  for (const [relativePath, content] of entries) {
    assertSafeRelativePath(relativePath, "research-view file path");
    const pathBytes = Buffer.from(relativePath, "utf8");
    const contentBytes = Buffer.from(content, "utf8");
    digest.update(lengthBytes(pathBytes.byteLength));
    digest.update(pathBytes);
    digest.update(lengthBytes(contentBytes.byteLength));
    digest.update(contentBytes);
    manifest.push({ path: relativePath, sha256: sha256(contentBytes), bytes: contentBytes.byteLength });
    bytes += contentBytes.byteLength;
  }
  return { algorithm: "tree-sha256-v1", sha256: digest.digest("hex"), fileCount: entries.length, bytes, files: manifest };
}

function chronologyIndex(events, refById) {
  return [...events].sort(compareEvents).map((event) => refById.get(event.eventId));
}

function eligibleForFrontier(event) {
  return event.outcome.score !== null
    && (
      event.outcome.status === "promoted"
      || (event.outcome.validity === "valid" && event.outcome.admission !== "rejected")
    );
}

function minimizes(direction) {
  return direction === "-" || direction === "minimize";
}

function frontierIndex(events, refById, direction) {
  const eligible = events.filter(eligibleForFrontier);
  if (eligible.length === 0) return [];
  const scores = eligible.map((event) => event.outcome.score);
  const best = minimizes(direction) ? Math.min(...scores) : Math.max(...scores);
  return eligible
    .filter((event) => event.outcome.score === best)
    .map((event) => refById.get(event.eventId))
    .sort((left, right) => left - right);
}

function groupedIndex(entries) {
  const groups = new Map();
  for (const [key, ref] of entries) {
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(ref);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, refs]) => ({ key, eventSet: encodeEventSet(refs) }));
}

function compactFingerprintIndex(entries) {
  const groups = groupedIndex(entries);
  let prefixLength = 12;
  while (
    prefixLength < 64
    && new Set(groups.map((group) => group.key.slice(0, prefixLength))).size !== groups.length
  ) prefixLength += 1;
  return {
    algorithm: "sha256-unique-prefix.v1",
    prefixLength,
    groups: groups.map((group) => ({
      key: group.key.slice(0, prefixLength),
      eventSet: group.eventSet,
    })),
  };
}

function recordedConditionVector(event) {
  return {
    bundleSize: event.conditions.bundleSize,
    checkpointId: event.conditions.checkpointId,
    configuration: event.conditions.configuration,
    environment: event.conditions.environment,
    harness: event.conditions.harness,
    hasUnresolved: event.conditions.hasUnresolved,
    policyCoupled: event.conditions.policyCoupled,
    routeInterpretation: event.conditions.routeInterpretation,
    seed: event.conditions.seed,
  };
}

function interventionFingerprint(event) {
  return sha256({
    changedPaths: event.changeSet.changedPaths,
    changedSymbols: event.changeSet.changedSymbols,
    configuration: event.changeSet.configuration,
    interventions: event.interventions,
  });
}

function conditionIndexes(events, refById) {
  const byConditionFingerprint = [];
  const byInterventionFingerprint = [];
  for (const event of events) {
    const ref = refById.get(event.eventId);
    const conditions = recordedConditionVector(event);
    const conditionFingerprint = sha256(conditions);
    byConditionFingerprint.push([conditionFingerprint, ref]);
    byInterventionFingerprint.push([interventionFingerprint(event), ref]);
  }
  const conditionIndex = compactFingerprintIndex(byConditionFingerprint);
  const conditionFields = Object.keys(recordedConditionVector(events[0])).sort(compareText);
  return {
    conditionFields,
    conditionGroups: {
      algorithm: conditionIndex.algorithm,
      prefixLength: conditionIndex.prefixLength,
      groups: conditionIndex.groups,
    },
    interventionGroups: compactFingerprintIndex(byInterventionFingerprint),
  };
}

function oneConditionDifferentSets(events, refById) {
  const fields = Object.keys(recordedConditionVector(events[0])).sort(compareText);
  const groups = new Map();
  for (const event of events) {
    const conditions = recordedConditionVector(event);
    const key = canonicalStringify(conditions);
    if (!groups.has(key)) groups.set(key, { conditions, eventRefs: [] });
    groups.get(key).eventRefs.push(refById.get(event.eventId));
  }
  const ordered = [...groups.values()]
    .map((group) => ({ ...group, eventRefs: group.eventRefs.sort((left, right) => left - right) }))
    .sort((left, right) => compareText(canonicalStringify(left.conditions), canonicalStringify(right.conditions)));
  const comparisons = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      const differingFields = fields.filter((field) => (
        canonicalStringify(left.conditions[field]) !== canonicalStringify(right.conditions[field])
      ));
      if (differingFields.length === 1) {
        comparisons.push({
          differingField: differingFields[0],
          leftEventSet: encodeEventSet(left.eventRefs),
          rightEventSet: encodeEventSet(right.eventRefs),
        });
      }
    }
  }
  return comparisons;
}

function observedCategory(event) {
  if (
    ["failed", "promotion failed", "invalid", "error", "timeout", "cancelled"].includes(event.outcome.status)
    || event.outcome.validity === "invalid"
    || event.outcome.admission === "rejected"
    || event.outcome.score === null
  ) return "invalid_or_unmeasured";
  if (event.outcome.directionalGain === null) return "unknown_gain";
  return event.outcome.directionalGain > 0 ? "positive_gain" : "nonpositive_gain";
}

function comparisonGroups(events, refById) {
  const groups = new Map();
  for (const event of events) {
    const ref = refById.get(event.eventId);
    for (const intervention of event.interventions) {
      for (const ideaId of intervention.ideaIds) {
        const key = canonicalStringify({ ideaId, site: intervention.site });
        if (!groups.has(key)) groups.set(key, { key: { ideaId, site: intervention.site }, rows: [] });
        groups.get(key).rows.push({ ref, category: observedCategory(event) });
      }
    }
  }
  return [...groups.values()].sort((left, right) => compareText(canonicalStringify(left.key), canonicalStringify(right.key)));
}

function unresolvedFlags(events, refById) {
  const mixedObservedOutcomes = [];
  const unreplicatedPositiveGain = [];
  const bundledGroups = new Map();
  const missingMatchedControl = [];
  for (const group of comparisonGroups(events, refById)) {
    const categories = sortedUnique(group.rows.map((row) => row.category));
    const eventRefs = [...new Set(group.rows.map((row) => row.ref))].sort((left, right) => left - right);
    if (categories.includes("positive_gain") && categories.some((category) => category !== "positive_gain")) {
      mixedObservedOutcomes.push({
        groupKey: group.key,
        eventRefs,
        observedCategories: categories,
      });
    }
    if (new Set(group.rows.filter((row) => row.category === "positive_gain").map((row) => row.ref)).size === 1) {
      unreplicatedPositiveGain.push({
        groupKey: group.key,
        eventRefs,
        observedCategories: categories,
      });
    }
  }
  for (const event of events) {
    const eventRefs = [refById.get(event.eventId)];
    if (
      event.interventions.length > 1
      || event.conditions.routeInterpretation === "mixed"
      || event.conditions.policyCoupled
    ) {
      const values = [
        event.conditions.bundleSize,
        event.conditions.policyCoupled,
        event.conditions.routeInterpretation,
      ];
      const key = canonicalStringify(values);
      if (!bundledGroups.has(key)) bundledGroups.set(key, { values, eventRefs: [] });
      bundledGroups.get(key).eventRefs.push(eventRefs[0]);
    }
    if (event.outcome.comparatorArtifactId === null || event.outcome.comparatorHops !== 1) {
      missingMatchedControl.push(eventRefs[0]);
    }
  }
  return {
    ruleVersion: "mechanical-comparison.v1",
    fieldOrder: {
      bundledAttributionColumns: ["bundleSize", "policyCoupled", "routeInterpretation", "eventSet"],
      groupedOutcomeColumns: ["ideaId", "site", "eventSet", "observedCategories"],
      oneConditionDifferentColumns: ["differingField", "leftEventSet", "rightEventSet"],
      recordedConditionFields: Object.keys(recordedConditionVector(events[0])).sort(compareText),
    },
    bundledAttribution: [...bundledGroups.values()]
      .sort((left, right) => compareText(canonicalStringify(left.values), canonicalStringify(right.values)))
      .map((row) => [...row.values, encodeEventSet(row.eventRefs)]),
    missingMatchedControl: encodeEventSet(missingMatchedControl),
    mixedObservedOutcomes: mixedObservedOutcomes.map((row) => [
      row.groupKey.ideaId,
      row.groupKey.site,
      encodeEventSet(row.eventRefs),
      row.observedCategories,
    ]),
    oneConditionDifferent: oneConditionDifferentSets(events, refById).map((row) => [
      row.differingField,
      row.leftEventSet,
      row.rightEventSet,
    ]),
    unreplicatedPositiveGain: unreplicatedPositiveGain.map((row) => [
      row.groupKey.ideaId,
      row.groupKey.site,
      encodeEventSet(row.eventRefs),
      row.observedCategories,
    ]),
  };
}

function validateIndexRefs(value, atomCount, label = "index") {
  const visit = (item, key) => {
    if (Array.isArray(item)) {
      if (key === "artifactLineage") {
        for (const row of item) {
          if (
            !Array.isArray(row)
            || row.length !== 2
            || !Number.isInteger(row[0])
            || row[0] < 0
            || row[0] >= atomCount
            || (row[1] !== null && (!Number.isInteger(row[1]) || row[1] < 0 || row[1] >= atomCount))
          ) {
            throw new Error(`${label}.${key} contains an invalid lineage row`);
          }
        }
      } else if (key === "bundledAttribution") {
        for (const row of item) {
          if (!Array.isArray(row) || row.length !== 4) throw new Error(`${label}.${key} has an invalid row`);
          decodeEventSet(row[3], atomCount, `${label}.${key}.eventSet`);
        }
      } else if (["mixedObservedOutcomes", "unreplicatedPositiveGain"].includes(key)) {
        for (const row of item) decodeEventSet(row[2], atomCount, `${label}.${key}.eventSet`);
      } else if (key === "oneConditionDifferent") {
        for (const row of item) {
          decodeEventSet(row[1], atomCount, `${label}.${key}.leftEventSet`);
          decodeEventSet(row[2], atomCount, `${label}.${key}.rightEventSet`);
        }
      } else if (["chronology", "frontier"].includes(key)) {
        for (const ref of item) {
          if (!Number.isInteger(ref) || ref < 0 || ref >= atomCount) {
            throw new Error(`${label}.${key} contains an invalid atom reference`);
          }
        }
      } else {
        item.forEach((child) => visit(child, key));
      }
    } else if (item !== null && typeof item === "object") {
      for (const [childKey, child] of Object.entries(item)) visit(child, childKey);
    } else if (key === "eventSet" || key === "missingMatchedControl") {
      decodeEventSet(item, atomCount, `${label}.${key}`);
    } else if (key === "eventRef") {
      if (!Number.isInteger(item) || item < 0 || item >= atomCount) {
        throw new Error(`${label}.${key} contains an invalid atom reference`);
      }
    }
  };
  visit(value, label);
}

function buildIndex(representation, events, atomTable, target) {
  const refById = new Map(atomTable.map((entry) => [entry.eventId, entry.ref]));
  const candidateRefByIdentity = new Map();
  for (const event of events) {
    const ref = refById.get(event.eventId);
    candidateRefByIdentity.set(event.candidateArtifactId, ref);
    if (event.candidateArtifactSha256 !== null) candidateRefByIdentity.set(event.candidateArtifactSha256, ref);
  }
  const chronology = chronologyIndex(events, refById);
  if (representation === "R0") return { chronology };
  const index = {
    chronology,
    eventSetEncoding: "ascending-inclusive-ranges.v1",
    target,
    frontier: frontierIndex(events, refById, target.direction),
    frontierEligibilityRule: "numeric_score_and_promoted_or_valid_nonrejected_status",
    artifactLineageFieldOrder: ["eventRef", "parentEventRef"],
    artifactLineage: [...events].sort(compareEvents).map((event) => [
      refById.get(event.eventId),
      candidateRefByIdentity.get(event.baseArtifactSha256) ?? candidateRefByIdentity.get(event.baseArtifactId) ?? null,
    ]),
    conditions: conditionIndexes(events, refById),
  };
  if (representation === "R2") index.unresolved = unresolvedFlags(events, refById);
  assertNoAdvisoryDerivation(index, `${representation} index`);
  validateIndexRefs(index, atomTable.length, `${representation} index`);
  return index;
}

function validateTarget(target) {
  requireExactKeys(target, ["direction", "metricName", "taskId"], "research target");
  requireString(target.taskId, "research target.taskId");
  requireString(target.metricName, "research target.metricName");
  if (!["+", "-", "minimize", "maximize"].includes(target.direction)) {
    throw new Error("research target direction must be +, -, minimize, or maximize");
  }
}

function validateLimits(limits) {
  requireExactKeys(limits, ["index", "total"], "token limits");
  for (const key of ["total", "index"]) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) throw new Error(`token limit ${key} must be a positive integer`);
  }
}

export function compileResearchViews({
  events,
  sourceSets,
  target,
  cutoff,
  cutoffSealSha256,
  limits = DEFAULT_TOKEN_LIMITS,
} = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error("research views require at least one event");
  validateTarget(target);
  validateLimits(limits);
  requireIsoTimestamp(cutoff, "history cutoff");
  if (!HEX_64.test(cutoffSealSha256)) throw new Error("cutoff seal hash is invalid");
  const eventIds = new Set();
  for (const event of events) {
    validateResearchEvent(event);
    if (eventIds.has(event.eventId)) throw new Error(`duplicate ResearchEvent id: ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.sequence.value > cutoff) throw new Error(`ResearchEvent ${event.eventId} is after the sealed cutoff`);
    if (event.conditions.taskId !== target.taskId) throw new Error(`ResearchEvent ${event.eventId} belongs to another task`);
    if (event.outcome.metricName !== target.metricName || event.outcome.direction !== target.direction) {
      throw new Error(`ResearchEvent ${event.eventId} has a different metric contract`);
    }
  }
  const canonicalSourceSets = validateSourceSets(sourceSets, events);
  const atomTable = buildAtomTable(events);
  const sharedAtomSetSha256 = atomSetHash(atomTable);
  const historyPayload = {
    schema: RESEARCH_VIEW_SCHEMA,
    rendererVersion: RENDERER_VERSION,
    historyCutoff: cutoff,
    cutoffSealSha256,
    target,
    atomSetSha256: sharedAtomSetSha256,
    sourceSets: canonicalSourceSets,
    atomTable,
  };
  const atomsDocument = buildAtomsDocument({
    atomTable,
    atomSetSha256: sharedAtomSetSha256,
    sourceSets: canonicalSourceSets,
    target,
    cutoff,
    cutoffSealSha256,
  });
  const atomsBytes = canonicalStringify(atomsDocument);
  const results = {};
  for (const representation of REPRESENTATIONS) {
    const index = buildIndex(representation, events, atomTable, target);
    const indexMarkdown = renderIndexMarkdown(index, atomsDocument);
    const mountedFiles = { "atoms.json": atomsBytes, "index.md": indexMarkdown };
    const tree = treeSnapshotForFiles(mountedFiles);
    const totalTokens = Math.ceil(tree.bytes / 2);
    const indexTokens = countDeterministicTokens(indexMarkdown);
    if (totalTokens > limits.total) {
      throw new Error(`${representation} mounted payload uses ${totalTokens} deterministic tokens; limit is ${limits.total}`);
    }
    if (indexTokens > limits.index) {
      throw new Error(`${representation} index uses ${indexTokens} deterministic tokens; limit is ${limits.index}`);
    }
    const audit = {
      schema: RESEARCH_VIEW_MANIFEST_SCHEMA,
      rendererVersion: RENDERER_VERSION,
      representation,
      historyCutoff: cutoff,
      cutoffSealSha256,
      atomSetSha256: sharedAtomSetSha256,
      eventCount: atomTable.length,
      tokenPolicy: TOKEN_POLICY,
      tokenLimits: limits,
      observedTokens: { total: totalTokens, index: indexTokens },
      payload: {
        root: `${tree.sha256}.payload`,
        sha256: tree.sha256,
        bytes: tree.bytes,
        files: tree.files,
      },
    };
    results[representation] = {
      payload: historyPayload,
      index,
      atomsBytes,
      indexMarkdown,
      mountedFiles,
      tree,
      audit,
    };
  }
  const atomHashes = REPRESENTATIONS.map((representation) => sha256(results[representation].atomsBytes));
  if (new Set(atomHashes).size !== 1) throw new Error("representations do not contain byte-identical atoms");
  for (const representation of REPRESENTATIONS) {
    const mountedText = Object.values(results[representation].mountedFiles).join("\n");
    if (/"representation"\s*:/iu.test(mountedText) || /(?:^|[^A-Za-z0-9])R[012](?:[^A-Za-z0-9]|$)/u.test(mountedText)) {
      throw new Error(`${representation} mounted payload leaks a treatment label`);
    }
  }
  return { atomSetSha256: sharedAtomSetSha256, views: results };
}

async function writeContentAddressed(target, bytes) {
  try {
    await fs.writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await fs.readFile(target, "utf8");
    if (existing !== bytes) throw new Error(`content-addressed artifact collision at ${target}`);
  }
}

async function verifyPayloadDirectory(directory, expectedTree) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const expectedNames = expectedTree.files.map((entry) => entry.path).sort(compareText);
  const actualNames = entries.map((entry) => entry.name).sort(compareText);
  if (canonicalStringify(actualNames) !== canonicalStringify(expectedNames)) {
    throw new Error(`research-view payload directory has unexpected files: ${directory}`);
  }
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`research-view payload contains a non-regular file: ${entry.name}`);
    files[entry.name] = await fs.readFile(path.join(directory, entry.name), "utf8");
  }
  const actualTree = treeSnapshotForFiles(files);
  if (actualTree.sha256 !== expectedTree.sha256) throw new Error("written research-view tree hash changed");
}

function requireNamespace(namespace) {
  requireString(namespace, "research-view namespace");
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u.test(namespace)) {
    throw new Error("research-view namespace must use lowercase slash-separated segments");
  }
  return namespace;
}

function nativeResearchViewRecord(
  view,
  namespace,
  checkpoint,
  parentResearchView,
  rendererProvenance,
) {
  const tree = view.tree;
  const relations = {};
  if (checkpoint !== null) relations.checkpoint = checkpoint;
  if (parentResearchView !== null) relations.previous_research_view = parentResearchView;
  return {
    schema_version: 1,
    id: tree.sha256,
    type: "research-view",
    namespace,
    created_at: null,
    published_at: null,
    labels: {},
    relations,
    data: {
      source_history_sha256: view.audit.cutoffSealSha256,
      atom_set_sha256: view.audit.atomSetSha256,
      cutoff: view.audit.historyCutoff,
      renderer: {
        version: view.audit.rendererVersion,
        variant: view.audit.representation,
        ...rendererProvenance,
      },
      config: {
        token_policy: view.audit.tokenPolicy,
        token_limits: view.audit.tokenLimits,
      },
      tree: {
        algorithm: tree.algorithm,
        sha256: tree.sha256,
        file_count: tree.fileCount,
        bytes: tree.bytes,
      },
      file_manifest: tree.files,
      tokens: view.audit.observedTokens,
      payload: {
        root: `${tree.sha256}.payload`,
        sha256: tree.sha256,
      },
    },
  };
}

export async function writeResearchViews(compilation, outputRoot, {
  namespace = "users/bx",
  checkpoint = null,
  parentResearchView = null,
} = {}) {
  requireObject(compilation, "research-view compilation");
  requireObject(compilation.views, "research-view compilation.views");
  requireNamespace(namespace);
  if (checkpoint !== null) requireString(checkpoint, "checkpoint relation");
  if (parentResearchView !== null) requireString(parentResearchView, "parent research-view relation");
  const root = path.resolve(requireString(outputRoot, "output root"));
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  const namespaceRoot = safePath(realRoot, namespace, "research-view namespace path");
  await fs.mkdir(namespaceRoot, { recursive: true });
  const realNamespaceRoot = await fs.realpath(namespaceRoot);
  if (!realNamespaceRoot.startsWith(`${realRoot}${path.sep}`)) throw new Error("research-view namespace escapes through a symlink");
  const rendererProvenance = await currentRendererProvenance();
  const written = [];
  for (const representation of REPRESENTATIONS) {
    const view = compilation.views[representation];
    if (view === undefined) throw new Error(`compilation is missing ${representation}`);
    const expectedTree = treeSnapshotForFiles(view.mountedFiles);
    if (expectedTree.sha256 !== view.tree.sha256) throw new Error(`${representation} mounted tree hash changed`);
    const payloadPath = safePath(realNamespaceRoot, `${view.tree.sha256}.payload`, `${representation} payload path`);
    await fs.mkdir(payloadPath, { recursive: true });
    const realPayloadPath = await fs.realpath(payloadPath);
    if (!realPayloadPath.startsWith(`${realNamespaceRoot}${path.sep}`)) throw new Error(`${representation} payload escapes through a symlink`);
    for (const [relativePath, content] of Object.entries(view.mountedFiles)) {
      await writeContentAddressed(safePath(realPayloadPath, relativePath, `${representation} mounted file`), content);
    }
    await verifyPayloadDirectory(realPayloadPath, view.tree);
    const record = nativeResearchViewRecord(
      view,
      namespace,
      checkpoint,
      parentResearchView,
      rendererProvenance,
    );
    const manifestBytes = canonicalStringify(record);
    const manifestPath = safePath(realNamespaceRoot, `${view.tree.sha256}.yaml`, `${representation} manifest path`);
    await writeContentAddressed(manifestPath, manifestBytes);
    written.push({
      representation,
      ref: `research-view:${namespace}/${view.tree.sha256}`,
      payloadPath,
      manifestPath,
      payloadSha256: view.tree.sha256,
      manifestSha256: sha256(manifestBytes),
    });
  }
  return written;
}
