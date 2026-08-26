import type {
  AtlasChangePhase,
  AtlasConstraintIdeaLink,
  AtlasConstraintAssessment,
  AtlasConstraintAssessmentEvidence,
  AtlasDecompositionRole,
  AtlasDecompositionCorpusCoverage,
  AtlasDecompositionUnresolved,
  AtlasConceptRelation,
  AtlasDirection,
  AtlasExperiment,
  AtlasExperimentControlledResult,
  AtlasExperimentDetail,
  AtlasExperimentDetailModel,
  AtlasExperimentEvidenceLevel,
  AtlasExperimentFactorialResultV1,
  AtlasExperimentFramingProvenance,
  AtlasExperimentMembershipEvidence,
  AtlasExperimentStatus,
  AtlasExperimentsRole,
  AtlasExperimentGenealogy,
  AtlasExperimentVariant,
  AtlasGenealogyRole,
  AtlasGenealogyUnresolved,
  AtlasIdeaGenealogyAnnotation,
  AtlasIdeaGenealogyEdge,
  AtlasIdeaGenealogyEvent,
  AtlasIdea,
  AtlasIdeaApproach,
  AtlasIdeaDossier,
  AtlasIdeaRepresentativeWitness,
  AtlasIdeaVariationGroup,
  AtlasIdeaRelation,
  AtlasIdeasRole,
  AtlasMutationRelation,
  AtlasMutationWitness,
  AtlasResearchArea,
  AtlasResearchConstraint,
  AtlasResearchIdea,
  AtlasRelease,
  AtlasReleaseManifest,
  AtlasReleasePointer,
  AtlasRoleSchemaVersion,
  AtlasRoleDescriptor,
  AtlasSolver,
  AtlasSolverHandoff,
  AtlasSolversRole,
  AtlasSubmission,
  AtlasSubmissionClassification,
  AtlasSubmissionDetail,
  AtlasSubmissionDetailModel,
  AtlasSubmissionDetailRole,
  AtlasSubmissionsRole,
  AtlasSubmissionStatus,
  AtlasSubmissionRoute,
} from "./types";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const DETAIL_PATH = /^submission-details\/([0-9a-f]{2,32})\.json$/;
const EXPERIMENT_DETAIL_PATH = /^experiment-details\/([0-9a-f]{2,32})\.json$/;
const GENEALOGY_PATH = /^genealogy\.json$/;
const DECOMPOSITION_PATH = /^decomposition\.json$/;
const DIRECTIONS = ["+", "-"] as const;
const STATUSES = ["promoted", "rejected", "failed", "promotion failed"] as const;
const CLASSIFICATIONS = ["artifact", "measurement", "artifact_and_measurement", "no_op", "unsupported"] as const;
const PHASES = ["decode", "prefill", "both", "unknown"] as const;
const MUTATION_RELATIONS = ["instance_of", "variant_of", "analogous_to", "unresolved"] as const;
const CONCEPT_RELATIONS = ["specializes", "extends", "uses", "influenced_by"] as const;
const EXPERIMENT_FRAMING = ["retrospective_review", "prospective"] as const;
const EXPERIMENT_STATUSES = ["candidate", "pilot_ready", "running", "completed", "inconclusive"] as const;
const EXPERIMENT_EVIDENCE = [
  "historical_observation",
  "matched_control",
  "one_change_ablation",
  "reproduced",
  "replicated",
] as const;
const EXPERIMENT_MEMBERSHIP_EVIDENCE = ["focused", "bundled_observation"] as const;
const GENEALOGY_BASIS = ["documented", "conceptual_reconstruction"] as const;
const GENEALOGY_STATUS = ["machine_admitted", "human_reviewed"] as const;
const GENEALOGY_EVENT_KIND = ["synthesis", "convergence", "split"] as const;
const DECOMPOSITION_STATUS = ["machine_admitted", "human_reviewed"] as const;
const DECOMPOSITION_SOURCE_KIND = ["concept", "reviewed_intervention"] as const;
const DECOMPOSITION_UNRESOLVED_KIND = ["constraint", "idea_identity", "placement"] as const;
const CONSTRAINT_METRIC_DIRECTION = ["lower", "higher"] as const;
const CONSTRAINT_LIMIT_KIND = [
  "proven_floor", "pinned_floor", "working_bound", "best_known_construction", "unknown",
] as const;
const CONSTRAINT_EVIDENCE_KIND = [
  "formal_proof", "benchmark_definition", "artifact_measurement", "reviewed_analysis", "official_document",
] as const;
const SUBMISSION_INTERPRETATION = ["focused", "single_idea", "mixed", "unmapped"] as const;
const SUBMISSION_TERMINAL_REASON = [
  "unsupported", "measurement_only", "no_op", "metric_only", "unresolved_only",
] as const;
const MUTATION_WITNESS_REVIEW_DISPOSITION = [
  "accepted_child",
  "proposed_child",
  "covered_by_owner",
  "parameter_only",
  "non_structural",
  "insufficient_evidence",
  "metric_only",
  "unresolved",
] as const;

function fail(path: string, message: string): never {
  throw new Error(`Atlas ${path} ${message}`);
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(", ")}`);
  }
  return row;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(path, "must be a non-empty string");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be boolean");
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(path, "must be a non-negative safe integer");
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be finite");
  return value;
}

function nullableFinite(value: unknown, path: string): number | null {
  return value === null ? null : finite(value, path);
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  const parsed = integer(value, path);
  if (parsed === 0) fail(path, "must be positive");
  return parsed;
}

function member<T extends string>(value: unknown, values: readonly T[], path: string): T {
  const parsed = string(value, path);
  if (!values.includes(parsed as T)) fail(path, `must be one of ${values.join(", ")}`);
  return parsed as T;
}

function sha256(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!SHA256.test(parsed)) fail(path, "must be a lowercase SHA-256");
  return parsed;
}

function nullableSha256(value: unknown, path: string): string | null {
  return value === null ? null : sha256(value, path);
}

function nullableCommit(value: unknown, path: string): string | null {
  const parsed = nullableString(value, path);
  if (parsed !== null && !GIT_SHA.test(parsed)) fail(path, "must be a lowercase Git commit SHA");
  return parsed;
}

function nullableIsoDate(value: unknown, path: string): string | null {
  const parsed = nullableString(value, path);
  if (parsed !== null && !Number.isFinite(Date.parse(parsed))) fail(path, "must be an ISO date");
  return parsed;
}

function isoDate(value: unknown, path: string): string {
  const parsed = string(value, path);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(parsed);
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed);
  const millis = Date.parse(dateOnly ? `${parsed}T00:00:00Z` : parsed);
  if ((!dateOnly && !timestamp) || !Number.isFinite(millis)) fail(path, "must be an ISO date");
  if (dateOnly && new Date(millis).toISOString().slice(0, 10) !== parsed) fail(path, "must be an ISO date");
  return parsed;
}

function nullableGenealogyIsoDate(value: unknown, path: string): string | null {
  return value === null ? null : isoDate(value, path);
}

function nullableHttpUrl(value: unknown, path: string): string | null {
  const parsed = nullableString(value, path);
  if (parsed === null) return null;
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    fail(path, "must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(path, "must use HTTP or HTTPS");
  return parsed;
}

function strings(value: unknown, path: string): string[] {
  const result = array(value, path).map((entry, index) => string(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string, path: string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) fail(path, `contains duplicate ${JSON.stringify(id)}`);
    result.set(id, value);
  }
  return result;
}

function safeRolePath(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (parsed.startsWith("/") || parsed.includes("\\") || parsed.includes("?") || parsed.includes("#")) {
    fail(path, "must be a relative release path");
  }
  const segments = parsed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(path, "contains an unsafe path segment");
  }
  return parsed;
}

function parseDescriptor(value: unknown, path: string): AtlasRoleDescriptor {
  const row = exactRecord(value, ["path", "sha256", "bytes", "gzipBytes"], path);
  const descriptor = {
    path: safeRolePath(row.path, `${path}.path`),
    sha256: sha256(row.sha256, `${path}.sha256`),
    bytes: integer(row.bytes, `${path}.bytes`),
    gzipBytes: integer(row.gzipBytes, `${path}.gzipBytes`),
  };
  if (descriptor.bytes === 0 || descriptor.gzipBytes === 0) fail(path, "must describe non-empty bytes");
  return descriptor;
}

export function parseAtlasReleasePointer(value: unknown): AtlasReleasePointer {
  const row = exactRecord(value, ["id", "baseUrl", "manifestSha256"], "pointer");
  const baseUrl = string(row.baseUrl, "pointer.baseUrl");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    fail("pointer.baseUrl", "must be an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    fail("pointer.baseUrl", "must use HTTPS outside local development");
  }
  if (url.search !== "" || url.hash !== "") fail("pointer.baseUrl", "must not contain a query or fragment");
  return {
    id: sha256(row.id, "pointer.id"),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    manifestSha256: sha256(row.manifestSha256, "pointer.manifestSha256"),
  };
}

export function parseAtlasManifest(value: unknown): AtlasReleaseManifest {
  const row = exactRecord(
    value,
    ["schema", "schemaVersion", "releaseId", "source", "benchmark", "counts", "roles"],
    "manifest",
  );
  if (row.schema !== "yukon.atlas-release"
    || (row.schemaVersion !== 2 && row.schemaVersion !== 3
      && row.schemaVersion !== 4 && row.schemaVersion !== 5)) {
    fail("manifest", "has unsupported identity");
  }
  const schemaVersion = row.schemaVersion;
  const v5Source = schemaVersion === 5 && row.source !== null && typeof row.source === "object"
    && !Array.isArray(row.source) ? row.source as Record<string, unknown> : null;
  const v5Counts = schemaVersion === 5 && row.counts !== null && typeof row.counts === "object"
    && !Array.isArray(row.counts) ? row.counts as Record<string, unknown> : null;
  const v5Roles = schemaVersion === 5 && row.roles !== null && typeof row.roles === "object"
    && !Array.isArray(row.roles) ? row.roles as Record<string, unknown> : null;
  const hasAssessmentPin = v5Source !== null && Object.hasOwn(v5Source, "constraintAssessmentRegistrySha256");
  const hasAssessmentCount = v5Counts !== null && Object.hasOwn(v5Counts, "constraintAssessments");
  const hasExperimentPin = v5Source !== null && Object.hasOwn(v5Source, "experimentRegistrySha256");
  const hasExperimentCount = v5Counts !== null && Object.hasOwn(v5Counts, "experiments");
  const hasExperimentDetailCount = v5Counts !== null && Object.hasOwn(v5Counts, "experimentDetailShards");
  const hasExperimentRole = v5Roles !== null && Object.hasOwn(v5Roles, "experiments");
  const hasExperimentDetailRole = v5Roles !== null && Object.hasOwn(v5Roles, "experimentDetails");
  if (hasAssessmentPin !== hasAssessmentCount) {
    fail("manifest", "must provide the constraint assessment pin and count together");
  }
  if (hasExperimentCount !== hasExperimentDetailCount
    || hasExperimentCount !== hasExperimentRole
    || hasExperimentCount !== hasExperimentDetailRole) {
    fail("manifest", "must provide the experiment counts and roles together");
  }
  const source = exactRecord(
    row.source,
    schemaVersion === 2
      ? ["exportId", "researchMapSha256"]
      : schemaVersion === 3
        ? ["exportId", "researchMapSha256", "experimentRegistrySha256"]
        : schemaVersion === 4
          ? ["exportId", "researchMapSha256", "experimentRegistrySha256", "ideaGenealogyRegistrySha256"]
          : [
              "exportId", "researchMapSha256", "researchDecompositionRegistrySha256",
              ...(hasExperimentPin ? ["experimentRegistrySha256"] : []),
              ...(hasAssessmentPin ? ["constraintAssessmentRegistrySha256"] : []),
            ],
    "manifest.source",
  );
  const benchmark = exactRecord(
    row.benchmark,
    ["id", "name", "description", "direction", "unit", "baselineScore"],
    "manifest.benchmark",
  );
  const counts = exactRecord(
    row.counts,
    schemaVersion === 2
      ? ["ideas", "solvers", "submissions", "detailShards"]
      : schemaVersion === 3
        ? ["ideas", "solvers", "submissions", "detailShards", "experiments", "experimentDetailShards"]
        : schemaVersion === 4 ? [
          "ideas",
          "solvers",
          "submissions",
          "detailShards",
          "experiments",
          "experimentDetailShards",
          "genealogyEdges",
          "genealogyEvents",
          "variants",
          "ungroupedRuns",
        ] : [
          ...(hasExperimentCount ? ["experiments", "experimentDetailShards"] : []),
          "ideas", "solvers", "submissions", "detailShards", "areas", "constraints",
          "decompositionIdeas", "constraintIdeaLinks",
          ...(hasAssessmentCount ? ["constraintAssessments"] : []),
        ],
    "manifest.counts",
  );
  const roles = exactRecord(
    row.roles,
    schemaVersion === 2
      ? ["ideas", "solvers", "submissions", "details"]
      : schemaVersion === 3
        ? ["ideas", "solvers", "submissions", "details", "experiments", "experimentDetails"]
        : schemaVersion === 4
          ? ["ideas", "solvers", "submissions", "details", "experiments", "experimentDetails", "genealogy"]
          : [
              "ideas",
              "solvers",
              "submissions",
              "details",
              ...(hasExperimentRole ? ["experiments", "experimentDetails"] : []),
              "decomposition",
            ],
    "manifest.roles",
  );
  const details = array(roles.details, "manifest.roles.details")
    .map((entry, index) => parseDescriptor(entry, `manifest.roles.details[${index}]`));
  uniqueBy(details, (descriptor) => descriptor.path, "manifest.roles.details");
  for (const descriptor of details) {
    if (!DETAIL_PATH.test(descriptor.path)) fail("manifest.roles.details", `contains invalid path ${descriptor.path}`);
  }
  const common = {
    schema: "yukon.atlas-release" as const,
    releaseId: sha256(row.releaseId, "manifest.releaseId"),
    benchmark: {
      id: nullableString(benchmark.id, "manifest.benchmark.id"),
      name: string(benchmark.name, "manifest.benchmark.name"),
      description: string(benchmark.description, "manifest.benchmark.description"),
      direction: member(benchmark.direction, DIRECTIONS, "manifest.benchmark.direction"),
      unit: nullableString(benchmark.unit, "manifest.benchmark.unit"),
      baselineScore: nullableFinite(benchmark.baselineScore, "manifest.benchmark.baselineScore"),
    },
  };
  const commonCounts = {
    ideas: integer(counts.ideas, "manifest.counts.ideas"),
    solvers: integer(counts.solvers, "manifest.counts.solvers"),
    submissions: integer(counts.submissions, "manifest.counts.submissions"),
    detailShards: integer(counts.detailShards, "manifest.counts.detailShards"),
  };
  const commonRoles = {
    ideas: parseDescriptor(roles.ideas, "manifest.roles.ideas"),
    solvers: parseDescriptor(roles.solvers, "manifest.roles.solvers"),
    submissions: parseDescriptor(roles.submissions, "manifest.roles.submissions"),
    details,
  };
  let result: AtlasReleaseManifest;
  if (schemaVersion === 2) {
    result = {
      ...common,
      schemaVersion: 2,
      source: {
        exportId: nullableSha256(source.exportId, "manifest.source.exportId"),
        researchMapSha256: sha256(source.researchMapSha256, "manifest.source.researchMapSha256"),
      },
      counts: commonCounts,
      roles: commonRoles,
    };
  } else if (schemaVersion === 3 || schemaVersion === 4) {
    const experimentDetails = array(roles.experimentDetails, "manifest.roles.experimentDetails")
      .map((entry, index) => parseDescriptor(entry, `manifest.roles.experimentDetails[${index}]`));
    uniqueBy(experimentDetails, (descriptor) => descriptor.path, "manifest.roles.experimentDetails");
    for (const descriptor of experimentDetails) {
      if (!EXPERIMENT_DETAIL_PATH.test(descriptor.path)) {
        fail("manifest.roles.experimentDetails", `contains invalid path ${descriptor.path}`);
      }
    }
    const commonExperimentManifest = {
      source: {
        exportId: nullableSha256(source.exportId, "manifest.source.exportId"),
        researchMapSha256: sha256(source.researchMapSha256, "manifest.source.researchMapSha256"),
        experimentRegistrySha256: sha256(
          source.experimentRegistrySha256,
          "manifest.source.experimentRegistrySha256",
        ),
      },
      counts: {
        ...commonCounts,
        experiments: integer(counts.experiments, "manifest.counts.experiments"),
        experimentDetailShards: integer(
          counts.experimentDetailShards,
          "manifest.counts.experimentDetailShards",
        ),
      },
      roles: {
        ...commonRoles,
        experiments: parseDescriptor(roles.experiments, "manifest.roles.experiments"),
        experimentDetails,
      },
    };
    if (schemaVersion === 3) {
      result = {
        ...common,
        schemaVersion: 3,
        ...commonExperimentManifest,
      };
    } else {
      const genealogy = parseDescriptor(roles.genealogy, "manifest.roles.genealogy");
      if (!GENEALOGY_PATH.test(genealogy.path)) fail("manifest.roles.genealogy", "must use genealogy.json");
      result = {
        ...common,
        schemaVersion: 4,
        source: {
          ...commonExperimentManifest.source,
          ideaGenealogyRegistrySha256: sha256(
            source.ideaGenealogyRegistrySha256,
            "manifest.source.ideaGenealogyRegistrySha256",
          ),
        },
        counts: {
          ...commonExperimentManifest.counts,
          genealogyEdges: integer(counts.genealogyEdges, "manifest.counts.genealogyEdges"),
          genealogyEvents: integer(counts.genealogyEvents, "manifest.counts.genealogyEvents"),
          variants: integer(counts.variants, "manifest.counts.variants"),
          ungroupedRuns: integer(counts.ungroupedRuns, "manifest.counts.ungroupedRuns"),
        },
        roles: {
          ...commonExperimentManifest.roles,
          genealogy,
        },
      };
    }
  } else {
    const decomposition = parseDescriptor(roles.decomposition, "manifest.roles.decomposition");
    if (!DECOMPOSITION_PATH.test(decomposition.path)) {
      fail("manifest.roles.decomposition", "must use decomposition.json");
    }
    result = {
      ...common,
      schemaVersion: 5,
      source: {
        exportId: nullableSha256(source.exportId, "manifest.source.exportId"),
        researchMapSha256: sha256(source.researchMapSha256, "manifest.source.researchMapSha256"),
        researchDecompositionRegistrySha256: sha256(
          source.researchDecompositionRegistrySha256,
          "manifest.source.researchDecompositionRegistrySha256",
        ),
        ...(hasExperimentPin ? {
          experimentRegistrySha256: sha256(
            source.experimentRegistrySha256,
            "manifest.source.experimentRegistrySha256",
          ),
        } : {}),
        ...(hasAssessmentPin ? {
          constraintAssessmentRegistrySha256: sha256(
            source.constraintAssessmentRegistrySha256,
            "manifest.source.constraintAssessmentRegistrySha256",
          ),
        } : {}),
      },
      counts: {
        ...commonCounts,
        ...(hasExperimentCount ? {
          experiments: integer(counts.experiments, "manifest.counts.experiments"),
          experimentDetailShards: integer(
            counts.experimentDetailShards,
            "manifest.counts.experimentDetailShards",
          ),
        } : {}),
        areas: integer(counts.areas, "manifest.counts.areas"),
        constraints: integer(counts.constraints, "manifest.counts.constraints"),
        decompositionIdeas: integer(counts.decompositionIdeas, "manifest.counts.decompositionIdeas"),
        constraintIdeaLinks: integer(counts.constraintIdeaLinks, "manifest.counts.constraintIdeaLinks"),
        ...(hasAssessmentCount ? {
          constraintAssessments: integer(
            counts.constraintAssessments,
            "manifest.counts.constraintAssessments",
          ),
        } : {}),
      },
      roles: {
        ...commonRoles,
        ...(hasExperimentRole ? {
          experiments: parseDescriptor(roles.experiments, "manifest.roles.experiments"),
          experimentDetails: array(roles.experimentDetails, "manifest.roles.experimentDetails")
            .map((entry, index) => parseDescriptor(entry, `manifest.roles.experimentDetails[${index}]`)),
        } : {}),
        decomposition,
      },
    };
    if (hasExperimentRole) {
      const experimentDetails = result.roles.experimentDetails ?? [];
      uniqueBy(experimentDetails, (descriptor) => descriptor.path, "manifest.roles.experimentDetails");
      for (const descriptor of experimentDetails) {
        if (!EXPERIMENT_DETAIL_PATH.test(descriptor.path)) {
          fail("manifest.roles.experimentDetails", `contains invalid path ${descriptor.path}`);
        }
      }
    }
  }
  const resultExperimentRole = result.schemaVersion === 3 || result.schemaVersion === 4
    ? result.roles.experiments
    : result.schemaVersion === 5
      ? result.roles.experiments ?? null
      : null;
  const resultExperimentDetails = result.schemaVersion === 3 || result.schemaVersion === 4
    ? result.roles.experimentDetails
    : result.schemaVersion === 5
      ? result.roles.experimentDetails ?? []
      : [];
  const resultExperimentDetailCount = result.schemaVersion === 3 || result.schemaVersion === 4
    ? result.counts.experimentDetailShards
    : result.schemaVersion === 5
      ? result.counts.experimentDetailShards ?? null
      : null;
  if (result.roles.ideas.path !== "ideas.json"
    || result.roles.solvers.path !== "solvers.json"
    || result.roles.submissions.path !== "submissions.json") {
    fail("manifest.roles", "must use canonical eager role paths");
  }
  if (resultExperimentRole !== null && resultExperimentRole.path !== "experiments.json") {
    fail("manifest.roles.experiments", "must use experiments.json");
  }
  const allDescriptors = [
    result.roles.ideas,
    result.roles.solvers,
    result.roles.submissions,
    ...details,
    ...(
      result.schemaVersion === 2
        ? []
        : result.schemaVersion === 3
          ? [result.roles.experiments, ...result.roles.experimentDetails]
        : result.schemaVersion === 4
            ? [result.roles.experiments, ...result.roles.experimentDetails, result.roles.genealogy]
            : [
                ...(resultExperimentRole === null
                  ? []
                  : [resultExperimentRole, ...resultExperimentDetails]),
                result.roles.decomposition,
              ]
    ),
  ];
  uniqueBy(allDescriptors, (descriptor) => descriptor.path, "manifest.roles");
  if (result.counts.detailShards !== details.length) fail("manifest.counts.detailShards", "must match role descriptors");
  if (resultExperimentDetailCount !== null && resultExperimentDetailCount !== resultExperimentDetails.length) {
    fail("manifest.counts.experimentDetailShards", "must match role descriptors");
  }
  return result;
}

function roleRoot(value: unknown, view: string, keys: readonly string[]): Record<string, unknown> {
  const row = exactRecord(value, ["schema", "schemaVersion", "view", ...keys], view);
  if (row.schema !== "yukon.atlas"
    || (row.schemaVersion !== 2 && row.schemaVersion !== 3)
    || row.view !== view) {
    fail(view, "has unsupported identity");
  }
  return row;
}

function parseAggregate<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  path: string,
): { [Key in Keys[number]]: number } {
  const row = exactRecord(value, keys, path);
  return Object.fromEntries(
    keys.map((key) => [key, integer(row[key], `${path}.${key}`)]),
  ) as { [Key in Keys[number]]: number };
}

function assertAcyclic(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
  path: string,
): void {
  const children = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) children.get(edge.from)?.push(edge.to);
  const complete = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (complete.has(id)) return;
    if (active.has(id)) fail(path, "must not form a cycle");
    active.add(id);
    for (const child of children.get(id) ?? []) visit(child);
    active.delete(id);
    complete.add(id);
  };
  for (const id of nodeIds) visit(id);
}

export function parseAtlasIdeas(value: unknown): AtlasIdeasRole {
  const row = roleRoot(value, "ideas", ["ideas", "relations"]);
  const ideas = array(row.ideas, "ideas.ideas").map((entry, index): AtlasIdea => {
    const path = `ideas.ideas[${index}]`;
    const item = exactRecord(
      entry,
      ["id", "name", "summary", "family", "searchTerms", "variationOf", "coined", "status", "aggregate"],
      path,
    );
    const aggregate = parseAggregate(item.aggregate, ["attempts", "promoted", "solvers"], `${path}.aggregate`);
    if (aggregate.promoted > aggregate.attempts) fail(`${path}.aggregate.promoted`, "cannot exceed attempts");
    return {
      id: string(item.id, `${path}.id`),
      name: string(item.name, `${path}.name`),
      summary: string(item.summary, `${path}.summary`),
      family: string(item.family, `${path}.family`),
      searchTerms: strings(item.searchTerms, `${path}.searchTerms`),
      variationOf: nullableString(item.variationOf, `${path}.variationOf`),
      coined: boolean(item.coined, `${path}.coined`),
      status: string(item.status, `${path}.status`),
      aggregate: {
        attempts: aggregate.attempts,
        promoted: aggregate.promoted,
        solvers: aggregate.solvers,
      },
    };
  });
  const ideaById = uniqueBy(ideas, (idea) => idea.id, "ideas.ideas");
  for (const idea of ideas) {
    if (idea.variationOf !== null && (!ideaById.has(idea.variationOf) || idea.variationOf === idea.id)) {
      fail(`ideas.ideas[${JSON.stringify(idea.id)}].variationOf`, "must name a different included idea");
    }
  }
  assertAcyclic(
    ideas.map((idea) => idea.id),
    ideas.flatMap((idea) => idea.variationOf === null ? [] : [{ from: idea.variationOf, to: idea.id }]),
    "ideas.ideas.variationOf",
  );
  const topLevelIdeaIds = new Set(ideas.filter((idea) => idea.variationOf === null).map((idea) => idea.id));
  const relations = array(row.relations, "ideas.relations").map((entry, index): AtlasIdeaRelation => {
    const path = `ideas.relations[${index}]`;
    const item = exactRecord(entry, ["id", "subjectIdeaId", "relation", "objectIdeaId", "description"], path);
    const relation = {
      id: string(item.id, `${path}.id`),
      subjectIdeaId: string(item.subjectIdeaId, `${path}.subjectIdeaId`),
      relation: member(item.relation, CONCEPT_RELATIONS, `${path}.relation`) as AtlasConceptRelation,
      objectIdeaId: string(item.objectIdeaId, `${path}.objectIdeaId`),
      description: string(item.description, `${path}.description`),
    };
    if (relation.subjectIdeaId === relation.objectIdeaId
      || !topLevelIdeaIds.has(relation.subjectIdeaId)
      || !topLevelIdeaIds.has(relation.objectIdeaId)) {
      fail(path, "must connect two distinct included top-level concepts");
    }
    return relation;
  });
  uniqueBy(relations, (relation) => relation.id, "ideas.relations");
  assertAcyclic(
    ideas.map((idea) => idea.id),
    relations
      .filter((relation) => relation.relation === "specializes" || relation.relation === "extends")
      .map((relation) => ({ from: relation.objectIdeaId, to: relation.subjectIdeaId })),
    "ideas.relations structural graph",
  );
  return {
    schema: "yukon.atlas",
    schemaVersion: row.schemaVersion as AtlasRoleSchemaVersion,
    view: "ideas",
    ideas,
    relations,
  };
}

export function parseAtlasSolvers(value: unknown): AtlasSolversRole {
  const row = roleRoot(value, "solvers", ["solvers", "handoffs"]);
  const solvers = array(row.solvers, "solvers.solvers").map((entry, index): AtlasSolver => {
    const path = `solvers.solvers[${index}]`;
    const item = exactRecord(
      entry,
      ["id", "name", "avatarUrl", "profileUrl", "identityStatus", "aggregate"],
      path,
    );
    const aggregate = parseAggregate(item.aggregate, ["attempts", "promoted", "ideas", "roots"], `${path}.aggregate`);
    if (aggregate.promoted > aggregate.attempts || aggregate.roots > aggregate.attempts) {
      fail(`${path}.aggregate`, "contains impossible counts");
    }
    return {
      id: string(item.id, `${path}.id`),
      name: string(item.name, `${path}.name`),
      avatarUrl: nullableHttpUrl(item.avatarUrl, `${path}.avatarUrl`),
      profileUrl: nullableHttpUrl(item.profileUrl, `${path}.profileUrl`),
      identityStatus: member(item.identityStatus, ["verified_account", "solver_lineage"] as const, `${path}.identityStatus`),
      aggregate: {
        attempts: aggregate.attempts,
        promoted: aggregate.promoted,
        ideas: aggregate.ideas,
        roots: aggregate.roots,
      },
    };
  });
  const solverById = uniqueBy(solvers, (solver) => solver.id, "solvers.solvers");
  const handoffs = array(row.handoffs, "solvers.handoffs").map((entry, index): AtlasSolverHandoff => {
    const path = `solvers.handoffs[${index}]`;
    const item = exactRecord(entry, ["fromSolverId", "toSolverId", "commits"], path);
    const handoff = {
      fromSolverId: string(item.fromSolverId, `${path}.fromSolverId`),
      toSolverId: string(item.toSolverId, `${path}.toSolverId`),
      commits: integer(item.commits, `${path}.commits`),
    };
    if (handoff.commits === 0 || handoff.fromSolverId === handoff.toSolverId
      || !solverById.has(handoff.fromSolverId) || !solverById.has(handoff.toSolverId)) {
      fail(path, "must connect two distinct included solvers with positive commits");
    }
    return handoff;
  });
  uniqueBy(handoffs, (handoff) => `${handoff.fromSolverId}\0${handoff.toSolverId}`, "solvers.handoffs");
  return {
    schema: "yukon.atlas",
    schemaVersion: row.schemaVersion as AtlasRoleSchemaVersion,
    view: "solvers",
    solvers,
    handoffs,
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-12;
}

function parseChange(value: unknown, path: string): AtlasSubmission["changes"][number] {
  const row = exactRecord(value, ["id", "title", "description", "phase", "site", "relation", "ideaId"], path);
  const relation = member(row.relation, MUTATION_RELATIONS, `${path}.relation`) as AtlasMutationRelation;
  const ideaId = nullableString(row.ideaId, `${path}.ideaId`);
  if ((relation === "unresolved") !== (ideaId === null)) fail(path, "must separate unresolved and mapped changes");
  return {
    id: string(row.id, `${path}.id`),
    title: string(row.title, `${path}.title`),
    description: string(row.description, `${path}.description`),
    phase: member(row.phase, PHASES, `${path}.phase`) as AtlasChangePhase,
    site: string(row.site, `${path}.site`),
    relation,
    ideaId,
  };
}

export function parseAtlasSubmissions(value: unknown): AtlasSubmissionsRole {
  const row = roleRoot(value, "submissions", ["direction", "submissions"]);
  const direction = member(row.direction, DIRECTIONS, "submissions.direction") as AtlasDirection;
  const submissions = array(row.submissions, "submissions.submissions").map((entry, index): AtlasSubmission => {
    const path = `submissions.submissions[${index}]`;
    const item = exactRecord(entry, [
      "id", "parentId", "scoreComparatorId", "scoreComparatorHops", "solverId", "createdAt", "status", "classification",
      "score", "scoreComparatorScore", "rawDelta", "directionalGain", "commitSha", "label", "changes", "detailShard",
    ], path);
    const score = nullableFinite(item.score, `${path}.score`);
    const comparatorScore = nullableFinite(item.scoreComparatorScore, `${path}.scoreComparatorScore`);
    const scoreComparatorId = nullableString(item.scoreComparatorId, `${path}.scoreComparatorId`);
    const scoreComparatorHops = nullablePositiveInteger(item.scoreComparatorHops, `${path}.scoreComparatorHops`);
    if ((scoreComparatorId === null) !== (scoreComparatorHops === null)
      || (scoreComparatorId === null) !== (comparatorScore === null)) {
      fail(path, "must keep score comparator ID, hops, and score together");
    }
    const rawDelta = nullableFinite(item.rawDelta, `${path}.rawDelta`);
    const directionalGain = nullableFinite(item.directionalGain, `${path}.directionalGain`);
    const expectedDelta = score === null || comparatorScore === null ? null : score - comparatorScore;
    if ((expectedDelta === null) !== (rawDelta === null)
      || (expectedDelta !== null && rawDelta !== null && !approximatelyEqual(expectedDelta, rawDelta))) {
      fail(`${path}.rawDelta`, "must equal score minus comparator score");
    }
    let expectedGain: number | null = null;
    if (rawDelta !== null) expectedGain = direction === "+" ? rawDelta : -rawDelta;
    if ((expectedGain === null) !== (directionalGain === null)
      || (expectedGain !== null && directionalGain !== null && !approximatelyEqual(expectedGain, directionalGain))) {
      fail(`${path}.directionalGain`, "must normalize rawDelta to the benchmark direction");
    }
    const changes = array(item.changes, `${path}.changes`)
      .map((change, changeIndex) => parseChange(change, `${path}.changes[${changeIndex}]`));
    uniqueBy(changes, (change) => change.id, `${path}.changes`);
    const detailShard = safeRolePath(item.detailShard, `${path}.detailShard`);
    if (!DETAIL_PATH.test(detailShard)) fail(`${path}.detailShard`, "must name a canonical detail shard");
    return {
      id: string(item.id, `${path}.id`),
      parentId: nullableString(item.parentId, `${path}.parentId`),
      scoreComparatorId,
      scoreComparatorHops,
      solverId: string(item.solverId, `${path}.solverId`),
      createdAt: nullableIsoDate(item.createdAt, `${path}.createdAt`),
      status: member(item.status, STATUSES, `${path}.status`) as AtlasSubmissionStatus,
      classification: item.classification === null
        ? null
        : member(item.classification, CLASSIFICATIONS, `${path}.classification`) as AtlasSubmissionClassification,
      score,
      scoreComparatorScore: comparatorScore,
      rawDelta,
      directionalGain,
      commitSha: nullableCommit(item.commitSha, `${path}.commitSha`),
      label: nullableString(item.label, `${path}.label`),
      changes,
      detailShard,
    };
  });
  const submissionById = uniqueBy(submissions, (submission) => submission.id, "submissions.submissions");
  for (const submission of submissions) {
    if (submission.parentId !== null && (submission.parentId === submission.id || !submissionById.has(submission.parentId))) {
      fail(`submissions.submissions[${JSON.stringify(submission.id)}].parentId`, "must name a different included submission");
    }
    if (submission.scoreComparatorId !== null) {
      const comparator = submissionById.get(submission.scoreComparatorId);
      if (comparator === undefined || comparator.id === submission.id) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].scoreComparatorId`, "must name a different included submission");
      }
      if (submission.scoreComparatorScore !== comparator.score) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].scoreComparatorScore`, "must match the named comparator");
      }
      let ancestorId = submission.parentId;
      for (let hop = 1; hop < submission.scoreComparatorHops! && ancestorId !== null; hop += 1) {
        ancestorId = submissionById.get(ancestorId)?.parentId ?? null;
      }
      if (ancestorId !== submission.scoreComparatorId) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].scoreComparatorHops`, "must locate the comparator on the Git-parent chain");
      }
    }
    const seen = new Set([submission.id]);
    let parentId = submission.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) fail(`submissions.submissions[${JSON.stringify(submission.id)}].parentId`, "must not form a cycle");
      seen.add(parentId);
      parentId = submissionById.get(parentId)!.parentId;
    }
  }
  return {
    schema: "yukon.atlas",
    schemaVersion: row.schemaVersion as AtlasRoleSchemaVersion,
    view: "submissions",
    direction,
    submissions,
  };
}

export function parseAtlasExperiments(value: unknown): AtlasExperimentsRole {
  const row = roleRoot(value, "experiments", ["experiments", "edges", "relations"]);
  if (row.schemaVersion !== 3) fail("experiments", "requires schema version 3");
  const experiments = array(row.experiments, "experiments.experiments")
    .map((entry, index): AtlasExperiment => {
      const path = `experiments.experiments[${index}]`;
      const hasRecordedFinding = entry !== null
        && typeof entry === "object"
        && !Array.isArray(entry)
        && Object.hasOwn(entry, "recordedFinding");
      const hasRelatedIdeaIds = entry !== null
        && typeof entry === "object"
        && !Array.isArray(entry)
        && Object.hasOwn(entry, "relatedIdeaIds");
      const item = exactRecord(entry, [
        "id", "ideaId", "title", "question", "intervention", "framingProvenance", "status", "evidenceLevel",
        ...(hasRelatedIdeaIds ? ["relatedIdeaIds"] : []),
        ...(hasRecordedFinding ? ["recordedFinding"] : []),
        "representativeVariationId", "variationMemberships", "aggregate", "detailShard",
      ], path);
      const variationMemberships = array(item.variationMemberships, `${path}.variationMemberships`)
        .map((membership, membershipIndex) => {
          const membershipPath = `${path}.variationMemberships[${membershipIndex}]`;
          const membershipRow = exactRecord(membership, ["variationRef", "evidenceRole"], membershipPath);
          const variationRefRow = exactRecord(
            membershipRow.variationRef,
            ["kind", "id"],
            `${membershipPath}.variationRef`,
          );
          return {
            variationRef: {
              kind: member(
                variationRefRow.kind,
                ["submission", "research_artifact"] as const,
                `${membershipPath}.variationRef.kind`,
              ),
              id: string(variationRefRow.id, `${membershipPath}.variationRef.id`),
            },
            evidenceRole: member(
              membershipRow.evidenceRole,
              EXPERIMENT_MEMBERSHIP_EVIDENCE,
              `${membershipPath}.evidenceRole`,
            ) as AtlasExperimentMembershipEvidence,
          };
        });
      if (variationMemberships.length === 0) fail(`${path}.variationMemberships`, "must not be empty");
      uniqueBy(
        variationMemberships,
        (membership) => variationRefKey(membership.variationRef),
        `${path}.variationMemberships`,
      );
      const aggregate = parseAggregate(
        item.aggregate,
        ["variations", "focused", "bundled", "solvers", "promoted", "failed"],
        `${path}.aggregate`,
      );
      const representativeVariationId = string(
        item.representativeVariationId,
        `${path}.representativeVariationId`,
      );
      const representativeMemberships = variationMemberships.filter(
        (membership) => membership.variationRef.id === representativeVariationId,
      );
      if (representativeMemberships.length !== 1) {
        fail(`${path}.representativeVariationId`, "must unambiguously name one included variation");
      }
      const focused = variationMemberships.filter((membership) => membership.evidenceRole === "focused").length;
      const bundled = variationMemberships.length - focused;
      if (aggregate.variations !== variationMemberships.length
        || aggregate.focused !== focused
        || aggregate.bundled !== bundled
        || aggregate.promoted > aggregate.variations
        || aggregate.failed > aggregate.variations) {
        fail(`${path}.aggregate`, "must match its variation memberships");
      }
      const detailShard = safeRolePath(item.detailShard, `${path}.detailShard`);
      if (!EXPERIMENT_DETAIL_PATH.test(detailShard)) {
        fail(`${path}.detailShard`, "must name a canonical experiment detail shard");
      }
      const ideaId = string(item.ideaId, `${path}.ideaId`);
      const relatedIdeaIds = hasRelatedIdeaIds
        ? strings(item.relatedIdeaIds, `${path}.relatedIdeaIds`)
        : [];
      uniqueBy(relatedIdeaIds, (relatedIdeaId) => relatedIdeaId, `${path}.relatedIdeaIds`);
      if (relatedIdeaIds.includes(ideaId)) {
        fail(`${path}.relatedIdeaIds`, "must not repeat the primary Idea");
      }
      return {
        id: string(item.id, `${path}.id`),
        ideaId,
        ...(hasRelatedIdeaIds ? { relatedIdeaIds } : {}),
        title: string(item.title, `${path}.title`),
        question: string(item.question, `${path}.question`),
        intervention: string(item.intervention, `${path}.intervention`),
        framingProvenance: member(
          item.framingProvenance,
          EXPERIMENT_FRAMING,
          `${path}.framingProvenance`,
        ) as AtlasExperimentFramingProvenance,
        status: member(item.status, EXPERIMENT_STATUSES, `${path}.status`) as AtlasExperimentStatus,
        evidenceLevel: member(
          item.evidenceLevel,
          EXPERIMENT_EVIDENCE,
          `${path}.evidenceLevel`,
        ) as AtlasExperimentEvidenceLevel,
        ...(hasRecordedFinding
          ? { recordedFinding: nullableString(item.recordedFinding, `${path}.recordedFinding`) }
          : {}),
        representativeVariationId,
        variationMemberships,
        aggregate: {
          variations: aggregate.variations,
          focused: aggregate.focused,
          bundled: aggregate.bundled,
          solvers: aggregate.solvers,
          promoted: aggregate.promoted,
          failed: aggregate.failed,
        },
        detailShard,
      };
    });
  const experimentById = uniqueBy(experiments, (experiment) => experiment.id, "experiments.experiments");
  const edges = array(row.edges, "experiments.edges").map((entry, index) => {
    const path = `experiments.edges[${index}]`;
    const item = exactRecord(entry, [
      "id", "parentExperimentId", "childExperimentId", "witnessParentSubmissionId", "witnessChildSubmissionId",
    ], path);
    const edge = {
      id: string(item.id, `${path}.id`),
      parentExperimentId: string(item.parentExperimentId, `${path}.parentExperimentId`),
      childExperimentId: string(item.childExperimentId, `${path}.childExperimentId`),
      witnessParentSubmissionId: string(item.witnessParentSubmissionId, `${path}.witnessParentSubmissionId`),
      witnessChildSubmissionId: string(item.witnessChildSubmissionId, `${path}.witnessChildSubmissionId`),
    };
    if (edge.parentExperimentId === edge.childExperimentId
      || !experimentById.has(edge.parentExperimentId)
      || !experimentById.has(edge.childExperimentId)) {
      fail(path, "must connect two distinct included experiments");
    }
    return edge;
  });
  uniqueBy(edges, (edge) => edge.id, "experiments.edges");
  uniqueBy(edges, (edge) => `${edge.parentExperimentId}\0${edge.childExperimentId}`, "experiments.edges");
  assertAcyclic(
    experiments.map((experiment) => experiment.id),
    edges.map((edge) => ({ from: edge.parentExperimentId, to: edge.childExperimentId })),
    "experiments.edges",
  );
  const relations = array(row.relations, "experiments.relations").map((entry, index) => {
    const path = `experiments.relations[${index}]`;
    const item = exactRecord(entry, [
      "id", "subjectExperimentId", "relation", "objectExperimentId", "description",
    ], path);
    const relation = {
      id: string(item.id, `${path}.id`),
      subjectExperimentId: string(item.subjectExperimentId, `${path}.subjectExperimentId`),
      relation: member(
        item.relation,
        ["replication_candidate"] as const,
        `${path}.relation`,
      ),
      objectExperimentId: string(item.objectExperimentId, `${path}.objectExperimentId`),
      description: string(item.description, `${path}.description`),
    };
    if (relation.subjectExperimentId === relation.objectExperimentId
      || !experimentById.has(relation.subjectExperimentId)
      || !experimentById.has(relation.objectExperimentId)) {
      fail(path, "must connect two distinct included experiments");
    }
    return relation;
  });
  uniqueBy(relations, (relation) => relation.id, "experiments.relations");
  return { schema: "yukon.atlas", schemaVersion: 3, view: "experiments", experiments, edges, relations };
}

function parseVariationRef(value: unknown, path: string) {
  const row = exactRecord(value, ["kind", "id"], path);
  return {
    kind: member(row.kind, ["submission", "research_artifact"] as const, `${path}.kind`),
    id: string(row.id, `${path}.id`),
  };
}

function variationRefKey(value: { kind: string; id: string }): string {
  return `${value.kind}\0${value.id}`;
}

export function parseAtlasGenealogy(value: unknown): AtlasGenealogyRole {
  const row = exactRecord(
    value,
    ["schema", "schemaVersion", "view", "ideaAnnotations", "edges", "events", "experiments", "unresolved"],
    "genealogy",
  );
  if (row.schema !== "yukon.atlas" || row.schemaVersion !== 4 || row.view !== "genealogy") {
    fail("genealogy", "has unsupported identity");
  }
  const ideaAnnotations = array(row.ideaAnnotations, "genealogy.ideaAnnotations")
    .map((entry, index): AtlasIdeaGenealogyAnnotation => {
      const path = `genealogy.ideaAnnotations[${index}]`;
      const item = exactRecord(
        entry,
        [
          "ideaId",
          "claimedAt",
          "firstEvidencedAt",
          "lastEvidencedAt",
          "reconstructedAt",
          "primaryIncomingEdgeId",
          "aliasRefs",
          "replacementIdeaIds",
        ],
        path,
      );
      return {
        ideaId: string(item.ideaId, `${path}.ideaId`),
        claimedAt: nullableGenealogyIsoDate(item.claimedAt, `${path}.claimedAt`),
        firstEvidencedAt: nullableGenealogyIsoDate(item.firstEvidencedAt, `${path}.firstEvidencedAt`),
        lastEvidencedAt: nullableGenealogyIsoDate(item.lastEvidencedAt, `${path}.lastEvidencedAt`),
        reconstructedAt: isoDate(item.reconstructedAt, `${path}.reconstructedAt`),
        primaryIncomingEdgeId: nullableString(item.primaryIncomingEdgeId, `${path}.primaryIncomingEdgeId`),
        aliasRefs: strings(item.aliasRefs, `${path}.aliasRefs`),
        replacementIdeaIds: strings(item.replacementIdeaIds, `${path}.replacementIdeaIds`),
      };
    });
  uniqueBy(ideaAnnotations, (annotation) => annotation.ideaId, "genealogy.ideaAnnotations");
  const edges = array(row.edges, "genealogy.edges").map((entry, index): AtlasIdeaGenealogyEdge => {
    const path = `genealogy.edges[${index}]`;
    const item = exactRecord(
      entry,
      ["edgeId", "parentIdeaId", "childIdeaId", "assertionId", "basis", "primary", "evidenceRefs", "status"],
      path,
    );
    return {
      edgeId: string(item.edgeId, `${path}.edgeId`),
      parentIdeaId: string(item.parentIdeaId, `${path}.parentIdeaId`),
      childIdeaId: string(item.childIdeaId, `${path}.childIdeaId`),
      assertionId: string(item.assertionId, `${path}.assertionId`),
      basis: member(item.basis, GENEALOGY_BASIS, `${path}.basis`),
      primary: boolean(item.primary, `${path}.primary`),
      evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
      status: member(item.status, GENEALOGY_STATUS, `${path}.status`),
    };
  });
  uniqueBy(edges, (edge) => edge.edgeId, "genealogy.edges");
  uniqueBy(edges, (edge) => `${edge.parentIdeaId}\0${edge.childIdeaId}`, "genealogy.edges");
  const events = array(row.events, "genealogy.events").map((entry, index): AtlasIdeaGenealogyEvent => {
    const path = `genealogy.events[${index}]`;
    const item = exactRecord(
      entry,
      [
        "eventId",
        "kind",
        "inputIdeaIds",
        "outputIdeaIds",
        "claimedAt",
        "firstEvidencedAt",
        "lastEvidencedAt",
        "reconstructedAt",
        "evidenceRefs",
        "status",
      ],
      path,
    );
    const inputIdeaIds = strings(item.inputIdeaIds, `${path}.inputIdeaIds`);
    const outputIdeaIds = strings(item.outputIdeaIds, `${path}.outputIdeaIds`);
    if (inputIdeaIds.length === 0 || outputIdeaIds.length === 0) {
      fail(path, "must include input and output ideas");
    }
    if (inputIdeaIds.some((ideaId) => outputIdeaIds.includes(ideaId))) {
      fail(path, "must not use one idea as both input and output");
    }
    const kind = member(item.kind, GENEALOGY_EVENT_KIND, `${path}.kind`);
    if ((kind === "synthesis" || kind === "convergence") && inputIdeaIds.length < 2) {
      fail(`${path}.inputIdeaIds`, `${kind} requires at least two inputs`);
    }
    if (kind === "split" && outputIdeaIds.length < 2) {
      fail(`${path}.outputIdeaIds`, "split requires at least two outputs");
    }
    return {
      eventId: string(item.eventId, `${path}.eventId`),
      kind,
      inputIdeaIds,
      outputIdeaIds,
      claimedAt: nullableGenealogyIsoDate(item.claimedAt, `${path}.claimedAt`),
      firstEvidencedAt: nullableGenealogyIsoDate(item.firstEvidencedAt, `${path}.firstEvidencedAt`),
      lastEvidencedAt: nullableGenealogyIsoDate(item.lastEvidencedAt, `${path}.lastEvidencedAt`),
      reconstructedAt: isoDate(item.reconstructedAt, `${path}.reconstructedAt`),
      evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
      status: member(item.status, GENEALOGY_STATUS, `${path}.status`),
    };
  });
  uniqueBy(events, (event) => event.eventId, "genealogy.events");
  const experiments = array(row.experiments, "genealogy.experiments")
    .map((entry, index): AtlasExperimentGenealogy => {
      const path = `genealogy.experiments[${index}]`;
      const experimentRow = exactRecord(entry, ["experimentId", "variants", "ungroupedRunRefs"], path);
      const experimentId = string(experimentRow.experimentId, `${path}.experimentId`);
      const variants = array(experimentRow.variants, `${path}.variants`)
        .map((variantEntry, variantIndex): AtlasExperimentVariant => {
          const variantPath = `${path}.variants[${variantIndex}]`;
          const item = exactRecord(
            variantEntry,
            [
              "variantId",
              "experimentId",
              "title",
              "condition",
              "heldConstant",
              "representativeRun",
              "runRefs",
              "witnessRefs",
              "membershipEvidence",
              "parentVariantIds",
            ],
            variantPath,
          );
          const runRefs = array(item.runRefs, `${variantPath}.runRefs`)
            .map((runRef, runIndex) => parseVariationRef(runRef, `${variantPath}.runRefs[${runIndex}]`));
          if (runRefs.length === 0) fail(`${variantPath}.runRefs`, "must not be empty");
          uniqueBy(runRefs, (runRef) => `${runRef.kind}\0${runRef.id}`, `${variantPath}.runRefs`);
          const representativeRun = parseVariationRef(item.representativeRun, `${variantPath}.representativeRun`);
          if (!runRefs.some((runRef) => (
            runRef.kind === representativeRun.kind && runRef.id === representativeRun.id
          ))) {
            fail(`${variantPath}.representativeRun`, "must name an included run");
          }
          const variantExperimentId = string(item.experimentId, `${variantPath}.experimentId`);
          if (variantExperimentId !== experimentId) {
            fail(`${variantPath}.experimentId`, "must match its experiment overlay");
          }
          return {
            variantId: string(item.variantId, `${variantPath}.variantId`),
            experimentId: variantExperimentId,
            title: string(item.title, `${variantPath}.title`),
            condition: string(item.condition, `${variantPath}.condition`),
            heldConstant: strings(item.heldConstant, `${variantPath}.heldConstant`),
            representativeRun,
            runRefs,
            witnessRefs: strings(item.witnessRefs, `${variantPath}.witnessRefs`),
            membershipEvidence: member(
              item.membershipEvidence,
              EXPERIMENT_MEMBERSHIP_EVIDENCE,
              `${variantPath}.membershipEvidence`,
            ),
            parentVariantIds: strings(item.parentVariantIds, `${variantPath}.parentVariantIds`),
          };
        });
      uniqueBy(variants, (variant) => variant.variantId, `${path}.variants`);
      const ungroupedRunRefs = array(experimentRow.ungroupedRunRefs, `${path}.ungroupedRunRefs`)
        .map((runRef, runIndex) => parseVariationRef(runRef, `${path}.ungroupedRunRefs[${runIndex}]`));
      uniqueBy(ungroupedRunRefs, (runRef) => `${runRef.kind}\0${runRef.id}`, `${path}.ungroupedRunRefs`);
      return { experimentId, variants, ungroupedRunRefs };
    });
  uniqueBy(experiments, (experiment) => experiment.experimentId, "genealogy.experiments");
  const allVariants = experiments.flatMap((experiment) => experiment.variants);
  uniqueBy(allVariants, (variant) => variant.variantId, "genealogy.experiments.variants");
  const unresolved = array(row.unresolved, "genealogy.unresolved")
    .map((entry, index): AtlasGenealogyUnresolved => {
      const path = `genealogy.unresolved[${index}]`;
      const item = exactRecord(entry, ["unresolvedId", "kind", "subjectIds", "reason", "evidenceRefs"], path);
      const subjectIds = strings(item.subjectIds, `${path}.subjectIds`);
      if (subjectIds.length === 0) fail(`${path}.subjectIds`, "must not be empty");
      return {
        unresolvedId: string(item.unresolvedId, `${path}.unresolvedId`),
        kind: member(
          item.kind,
          ["genealogy_edge", "variant_membership", "chronology"] as const,
          `${path}.kind`,
        ),
        subjectIds,
        reason: string(item.reason, `${path}.reason`),
        evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
      };
    });
  uniqueBy(unresolved, (entry) => entry.unresolvedId, "genealogy.unresolved");
  return {
    schema: "yukon.atlas",
    schemaVersion: 4,
    view: "genealogy",
    ideaAnnotations,
    edges,
    events,
    experiments,
    unresolved,
  };
}

export function parseAtlasDecomposition(value: unknown): AtlasDecompositionRole {
  const candidate = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const hasCorpus = candidate !== null && Object.hasOwn(candidate, "corpus");
  const hasDossiers = candidate !== null && Object.hasOwn(candidate, "dossiers");
  if (hasCorpus !== hasDossiers) fail("decomposition", "must provide corpus and dossiers together");
  const routingFields = ["mutationWitnesses", "submissionRoutes"] as const;
  const routingFieldCount = candidate === null
    ? 0
    : routingFields.filter((field) => Object.hasOwn(candidate, field)).length;
  if (routingFieldCount !== 0 && routingFieldCount !== routingFields.length) {
    fail("decomposition", "must provide mutation witnesses and submission routes together");
  }
  const hasRoutingOverlay = routingFieldCount === routingFields.length;
  const hasConstraintAssessments = candidate !== null && Object.hasOwn(candidate, "constraintAssessments");
  const hasAssessmentEvidence = candidate !== null && Object.hasOwn(candidate, "constraintAssessmentEvidence");
  if (hasConstraintAssessments !== hasAssessmentEvidence) {
    fail("decomposition", "must provide constraint assessments and their evidence together");
  }
  if (hasRoutingOverlay && (!hasCorpus || !hasDossiers)) {
    fail("decomposition", "evidence routing requires corpus and dossiers");
  }
  const row = exactRecord(
    value,
    [
      "schema", "schemaVersion", "view", "areas", "constraints", "ideas", "links", "unresolved",
      ...(hasDossiers ? ["corpus", "dossiers"] : []),
      ...(hasRoutingOverlay ? routingFields : []),
      ...(hasConstraintAssessments ? ["constraintAssessments", "constraintAssessmentEvidence"] : []),
    ],
    "decomposition",
  );
  if (row.schema !== "yukon.atlas" || row.schemaVersion !== 5 || row.view !== "decomposition") {
    fail("decomposition", "has unsupported identity");
  }
  const areas = array(row.areas, "decomposition.areas").map((entry, index): AtlasResearchArea => {
    const path = `decomposition.areas[${index}]`;
    const item = exactRecord(entry, ["areaId", "title", "summary"], path);
    return {
      areaId: string(item.areaId, `${path}.areaId`),
      title: string(item.title, `${path}.title`),
      summary: string(item.summary, `${path}.summary`),
    };
  });
  uniqueBy(areas, (area) => area.areaId, "decomposition.areas");
  if (areas.length === 0) fail("decomposition.areas", "must contain at least one Research Area");
  const constraints = array(row.constraints, "decomposition.constraints")
    .map((entry, index): AtlasResearchConstraint => {
      const path = `decomposition.constraints[${index}]`;
      const item = exactRecord(
        entry,
        ["constraintId", "owner", "label", "summary", "status", "evidenceRefs"],
        path,
      );
      const owner = exactRecord(item.owner, ["kind", "id"], `${path}.owner`);
      const label = string(item.label, `${path}.label`);
      const words = label.split(/\s+/u);
      if (words.length < 1 || words.length > 3 || /[.?!:;]$/u.test(label)) {
        fail(`${path}.label`, "must be a 1-3 word label");
      }
      return {
        constraintId: string(item.constraintId, `${path}.constraintId`),
        owner: {
          kind: member(owner.kind, ["area", "idea"] as const, `${path}.owner.kind`),
          id: string(owner.id, `${path}.owner.id`),
        },
        label,
        summary: string(item.summary, `${path}.summary`),
        status: member(item.status, DECOMPOSITION_STATUS, `${path}.status`),
        evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
      };
    });
  uniqueBy(constraints, (constraint) => constraint.constraintId, "decomposition.constraints");
  const ideas = array(row.ideas, "decomposition.ideas").map((entry, index): AtlasResearchIdea => {
    const path = `decomposition.ideas[${index}]`;
    const item = exactRecord(
      entry,
      ["ideaId", "title", "summary", "source", "status", "evidenceRefs"],
      path,
    );
    const source = exactRecord(item.source, ["kind", "id"], `${path}.source`);
    return {
      ideaId: string(item.ideaId, `${path}.ideaId`),
      title: string(item.title, `${path}.title`),
      summary: string(item.summary, `${path}.summary`),
      source: {
        kind: member(source.kind, DECOMPOSITION_SOURCE_KIND, `${path}.source.kind`),
        id: string(source.id, `${path}.source.id`),
      },
      status: member(item.status, DECOMPOSITION_STATUS, `${path}.status`),
      evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
    };
  });
  uniqueBy(ideas, (idea) => idea.ideaId, "decomposition.ideas");
  const links = array(row.links, "decomposition.links").map((entry, index): AtlasConstraintIdeaLink => {
    const path = `decomposition.links[${index}]`;
    const item = exactRecord(
      entry,
      ["linkId", "constraintId", "ideaId", "primary", "status", "evidenceRefs"],
      path,
    );
    return {
      linkId: string(item.linkId, `${path}.linkId`),
      constraintId: string(item.constraintId, `${path}.constraintId`),
      ideaId: string(item.ideaId, `${path}.ideaId`),
      primary: boolean(item.primary, `${path}.primary`),
      status: member(item.status, DECOMPOSITION_STATUS, `${path}.status`),
      evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
    };
  });
  uniqueBy(links, (link) => link.linkId, "decomposition.links");
  uniqueBy(links, (link) => `${link.constraintId}\0${link.ideaId}`, "decomposition.links");
  const unresolved = array(row.unresolved, "decomposition.unresolved")
    .map((entry, index): AtlasDecompositionUnresolved => {
      const path = `decomposition.unresolved[${index}]`;
      const item = exactRecord(
        entry,
        ["unresolvedId", "kind", "subjectIds", "reason", "evidenceRefs"],
        path,
      );
      return {
        unresolvedId: string(item.unresolvedId, `${path}.unresolvedId`),
        kind: member(item.kind, DECOMPOSITION_UNRESOLVED_KIND, `${path}.kind`),
        subjectIds: strings(item.subjectIds, `${path}.subjectIds`),
        reason: string(item.reason, `${path}.reason`),
        evidenceRefs: strings(item.evidenceRefs, `${path}.evidenceRefs`),
      };
    });
  uniqueBy(unresolved, (entry) => entry.unresolvedId, "decomposition.unresolved");
  const corpus = !hasDossiers ? undefined : (() => {
    const item = exactRecord(
      row.corpus,
      [
        "submissions", "mappedSubmissions", "unresolvedSubmissions", "withoutMappedMutation",
        "multiIdeaSubmissions",
      ],
      "decomposition.corpus",
    );
    const parsed: AtlasDecompositionCorpusCoverage = {
      submissions: integer(item.submissions, "decomposition.corpus.submissions"),
      mappedSubmissions: integer(item.mappedSubmissions, "decomposition.corpus.mappedSubmissions"),
      unresolvedSubmissions: integer(item.unresolvedSubmissions, "decomposition.corpus.unresolvedSubmissions"),
      withoutMappedMutation: integer(item.withoutMappedMutation, "decomposition.corpus.withoutMappedMutation"),
      multiIdeaSubmissions: integer(item.multiIdeaSubmissions, "decomposition.corpus.multiIdeaSubmissions"),
    };
    if (parsed.mappedSubmissions + parsed.withoutMappedMutation !== parsed.submissions
      || parsed.unresolvedSubmissions > parsed.submissions
      || parsed.multiIdeaSubmissions > parsed.mappedSubmissions) {
      fail("decomposition.corpus", "has inconsistent coverage counts");
    }
    return parsed;
  })();
  const dossiers = !hasDossiers ? undefined : array(row.dossiers, "decomposition.dossiers")
    .map((entry, index): AtlasIdeaDossier => {
      const path = `decomposition.dossiers[${index}]`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        fail(path, "must be an object");
      }
      const item = entry as Record<string, unknown>;
      const itemKeys = Object.keys(item).sort();
      const oldKeys = ["approaches", "coverage", "ideaId", "representativeWitnesses", "verification"];
      const newKeys = [...oldKeys, "variationGroups"].sort();
      const validKeys = (
        (itemKeys.length === oldKeys.length && itemKeys.every((key, keyIndex) => key === oldKeys[keyIndex]))
        || (itemKeys.length === newKeys.length && itemKeys.every((key, keyIndex) => key === newKeys[keyIndex]))
      );
      if (!validKeys) {
        fail(path, `must contain exactly ${newKeys.join(", ")} or ${oldKeys.join(", ")}`);
      }
      const coverageRow = exactRecord(
        item.coverage,
        [
          "submissions", "witnesses", "singleChangeSubmissions", "bundledSubmissions",
          "promoted", "rejected", "failed", "promotionFailed", "solvers",
        ],
        `${path}.coverage`,
      );
      const coverage = {
        submissions: integer(coverageRow.submissions, `${path}.coverage.submissions`),
        witnesses: integer(coverageRow.witnesses, `${path}.coverage.witnesses`),
        singleChangeSubmissions: integer(
          coverageRow.singleChangeSubmissions, `${path}.coverage.singleChangeSubmissions`),
        bundledSubmissions: integer(
          coverageRow.bundledSubmissions, `${path}.coverage.bundledSubmissions`),
        promoted: integer(coverageRow.promoted, `${path}.coverage.promoted`),
        rejected: integer(coverageRow.rejected, `${path}.coverage.rejected`),
        failed: integer(coverageRow.failed, `${path}.coverage.failed`),
        promotionFailed: integer(
          coverageRow.promotionFailed, `${path}.coverage.promotionFailed`),
        solvers: integer(coverageRow.solvers, `${path}.coverage.solvers`),
      };
      if (coverage.singleChangeSubmissions + coverage.bundledSubmissions !== coverage.submissions
        || coverage.promoted + coverage.rejected + coverage.failed + coverage.promotionFailed
          !== coverage.submissions) {
        fail(`${path}.coverage`, "has inconsistent submission counts");
      }
      const approaches = array(item.approaches, `${path}.approaches`)
        .map((approachEntry, approachIndex): AtlasIdeaApproach => {
          const approachPath = `${path}.approaches[${approachIndex}]`;
          const approach = exactRecord(
            approachEntry,
            ["ideaId", "title", "summary", "submissions", "promoted", "solvers"],
            approachPath,
          );
          return {
            ideaId: string(approach.ideaId, `${approachPath}.ideaId`),
            title: string(approach.title, `${approachPath}.title`),
            summary: string(approach.summary, `${approachPath}.summary`),
            submissions: integer(approach.submissions, `${approachPath}.submissions`),
            promoted: integer(approach.promoted, `${approachPath}.promoted`),
            solvers: integer(approach.solvers, `${approachPath}.solvers`),
          };
        });
      uniqueBy(approaches, (approach) => approach.ideaId, `${path}.approaches`);
      const variationGroups = item.variationGroups === undefined
        ? undefined
        : array(item.variationGroups, `${path}.variationGroups`)
          .map((variationEntry, variationIndex): AtlasIdeaVariationGroup => {
            const variationPath = `${path}.variationGroups[${variationIndex}]`;
            const variation = exactRecord(
              variationEntry,
              [
                "variationId",
                "label",
                "summary",
                "site",
                "submissions",
                "solvers",
                "bundledSubmissions",
                "representativeSubmissionId",
                "detailShard",
              ],
              variationPath,
            );
            const submissions = integer(
              variation.submissions, `${variationPath}.submissions`);
            const bundledSubmissions = integer(
              variation.bundledSubmissions, `${variationPath}.bundledSubmissions`);
            if (bundledSubmissions > submissions) {
              fail(`${variationPath}.bundledSubmissions`, "must not exceed submissions");
            }
            const detailShard = string(variation.detailShard, `${variationPath}.detailShard`);
            if (!DETAIL_PATH.test(detailShard)) {
              fail(`${variationPath}.detailShard`, "must be a detail shard path");
            }
            return {
              variationId: string(variation.variationId, `${variationPath}.variationId`),
              label: string(variation.label, `${variationPath}.label`),
              summary: string(variation.summary, `${variationPath}.summary`),
              site: string(variation.site, `${variationPath}.site`),
              submissions,
              solvers: integer(variation.solvers, `${variationPath}.solvers`),
              bundledSubmissions,
              representativeSubmissionId: string(
                variation.representativeSubmissionId,
                `${variationPath}.representativeSubmissionId`,
              ),
              detailShard,
            };
          });
      if (variationGroups !== undefined) {
        uniqueBy(
          variationGroups,
          (variation) => variation.variationId,
          `${path}.variationGroups`,
        );
      }
      const representativeWitnesses = array(
        item.representativeWitnesses,
        `${path}.representativeWitnesses`,
      ).map((witnessEntry, witnessIndex): AtlasIdeaRepresentativeWitness => {
        const witnessPath = `${path}.representativeWitnesses[${witnessIndex}]`;
        const witness = exactRecord(
          witnessEntry,
          [
            "submissionId", "changeId", "title", "description", "site", "status",
            "directionalGain", "scoreComparatorId", "scoreComparatorHops", "bundledChangeCount",
            "detailShard",
          ],
          witnessPath,
        );
        const detailShard = string(witness.detailShard, `${witnessPath}.detailShard`);
        if (!DETAIL_PATH.test(detailShard)) fail(`${witnessPath}.detailShard`, "must be a detail shard path");
        const bundledChangeCount = integer(
          witness.bundledChangeCount, `${witnessPath}.bundledChangeCount`);
        if (bundledChangeCount === 0) fail(`${witnessPath}.bundledChangeCount`, "must be positive");
        return {
          submissionId: string(witness.submissionId, `${witnessPath}.submissionId`),
          changeId: string(witness.changeId, `${witnessPath}.changeId`),
          title: string(witness.title, `${witnessPath}.title`),
          description: string(witness.description, `${witnessPath}.description`),
          site: string(witness.site, `${witnessPath}.site`),
          status: member(witness.status, STATUSES, `${witnessPath}.status`),
          directionalGain: nullableFinite(witness.directionalGain, `${witnessPath}.directionalGain`),
          scoreComparatorId: nullableString(
            witness.scoreComparatorId, `${witnessPath}.scoreComparatorId`),
          scoreComparatorHops: nullablePositiveInteger(
            witness.scoreComparatorHops, `${witnessPath}.scoreComparatorHops`),
          bundledChangeCount,
          detailShard,
        };
      });
      if (representativeWitnesses.length > 5) {
        fail(`${path}.representativeWitnesses`, "must contain at most five witnesses");
      }
      uniqueBy(
        representativeWitnesses,
        (witness) => witness.submissionId,
        `${path}.representativeWitnesses`,
      );
      if (item.verification !== "requires_verification") {
        fail(`${path}.verification`, "must be requires_verification");
      }
      return {
        ideaId: string(item.ideaId, `${path}.ideaId`),
        coverage,
        approaches,
        ...(variationGroups === undefined ? {} : { variationGroups }),
        representativeWitnesses,
        verification: "requires_verification",
      };
    });
  if (dossiers !== undefined) uniqueBy(dossiers, (dossier) => dossier.ideaId, "decomposition.dossiers");
  const constraintAssessmentEvidence = !hasAssessmentEvidence ? undefined : array(
    row.constraintAssessmentEvidence,
    "decomposition.constraintAssessmentEvidence",
  ).map((entry, index): AtlasConstraintAssessmentEvidence => {
    const path = `decomposition.constraintAssessmentEvidence[${index}]`;
    const item = exactRecord(
      entry,
      ["evidenceId", "kind", "locator", "sha256", "bytes", "description"],
      path,
    );
    const byteLength = integer(item.bytes, `${path}.bytes`);
    return {
      evidenceId: string(item.evidenceId, `${path}.evidenceId`),
      kind: member(item.kind, CONSTRAINT_EVIDENCE_KIND, `${path}.kind`),
      locator: string(item.locator, `${path}.locator`),
      sha256: sha256(item.sha256, `${path}.sha256`),
      bytes: byteLength,
      description: string(item.description, `${path}.description`),
    };
  });
  if (constraintAssessmentEvidence !== undefined) {
    uniqueBy(
      constraintAssessmentEvidence,
      (evidence) => evidence.evidenceId,
      "decomposition.constraintAssessmentEvidence",
    );
  }
  const constraintAssessments = !hasConstraintAssessments ? undefined : array(
    row.constraintAssessments,
    "decomposition.constraintAssessments",
  ).map((entry, index): AtlasConstraintAssessment => {
    const path = `decomposition.constraintAssessments[${index}]`;
    const item = exactRecord(
      entry,
      ["assessmentId", "constraintId", "metric", "baseline", "frontier", "limit", "progress", "status"],
      path,
    );
    const metric = exactRecord(item.metric, ["label", "unit", "direction", "regime"], `${path}.metric`);
    const baseline = exactRecord(item.baseline, ["value", "evidenceRefs"], `${path}.baseline`);
    const frontier = exactRecord(item.frontier, ["value", "evidenceRefs"], `${path}.frontier`);
    const limit = exactRecord(
      item.limit,
      ["kind", "value", "statement", "evidenceRefs"],
      `${path}.limit`,
    );
    const parsedLimit = {
      kind: member(limit.kind, CONSTRAINT_LIMIT_KIND, `${path}.limit.kind`),
      value: nullableFinite(limit.value, `${path}.limit.value`),
      statement: string(limit.statement, `${path}.limit.statement`),
      evidenceRefs: strings(limit.evidenceRefs, `${path}.limit.evidenceRefs`),
    };
    const progress = nullableFinite(item.progress, `${path}.progress`);
    if (progress !== null && (progress < 0 || progress > 1)) {
      fail(`${path}.progress`, "must be between zero and one");
    }
    if (parsedLimit.kind === "unknown" && parsedLimit.value !== null) {
      fail(`${path}.limit.value`, "must be null for an unknown limit");
    }
    if ((parsedLimit.kind === "best_known_construction" || parsedLimit.kind === "unknown")
      && progress !== null) {
      fail(`${path}.progress`, "requires a comparable floor or bound");
    }
    return {
      assessmentId: string(item.assessmentId, `${path}.assessmentId`),
      constraintId: string(item.constraintId, `${path}.constraintId`),
      metric: {
        label: string(metric.label, `${path}.metric.label`),
        unit: string(metric.unit, `${path}.metric.unit`),
        direction: member(metric.direction, CONSTRAINT_METRIC_DIRECTION, `${path}.metric.direction`),
        regime: string(metric.regime, `${path}.metric.regime`),
      },
      baseline: {
        value: nullableFinite(baseline.value, `${path}.baseline.value`),
        evidenceRefs: strings(baseline.evidenceRefs, `${path}.baseline.evidenceRefs`),
      },
      frontier: {
        value: nullableFinite(frontier.value, `${path}.frontier.value`),
        evidenceRefs: strings(frontier.evidenceRefs, `${path}.frontier.evidenceRefs`),
      },
      limit: parsedLimit,
      progress,
      status: member(item.status, DECOMPOSITION_STATUS, `${path}.status`),
    };
  });
  if (constraintAssessments !== undefined) {
    uniqueBy(constraintAssessments, (assessment) => assessment.assessmentId, "decomposition.constraintAssessments");
    uniqueBy(constraintAssessments, (assessment) => assessment.constraintId, "decomposition.constraintAssessments");
  }
  const mutationWitnesses = !hasRoutingOverlay ? undefined : array(
    row.mutationWitnesses,
    "decomposition.mutationWitnesses",
  ).map((entry, index): AtlasMutationWitness => {
    const path = `decomposition.mutationWitnesses[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(path, "must be an object");
    }
    const hasReviewDisposition = Object.hasOwn(entry, "reviewDisposition");
    const hasReviewNote = Object.hasOwn(entry, "reviewNote");
    if (hasReviewDisposition !== hasReviewNote) {
      fail(path, "must provide reviewDisposition and reviewNote together");
    }
    const item = exactRecord(
      entry,
      [
        "witnessId",
        "submissionId",
        "mappingIdeaId",
        "ideaIds",
        "constraintIds",
        "relation",
        ...(hasReviewDisposition ? ["reviewDisposition", "reviewNote"] : []),
      ],
      path,
    );
    return {
      witnessId: string(item.witnessId, `${path}.witnessId`),
      submissionId: string(item.submissionId, `${path}.submissionId`),
      mappingIdeaId: nullableString(item.mappingIdeaId, `${path}.mappingIdeaId`),
      ideaIds: strings(item.ideaIds, `${path}.ideaIds`),
      constraintIds: strings(item.constraintIds, `${path}.constraintIds`),
      relation: member(item.relation, MUTATION_RELATIONS, `${path}.relation`),
      reviewDisposition: !hasReviewDisposition
        ? null
        : member(
          item.reviewDisposition,
          MUTATION_WITNESS_REVIEW_DISPOSITION,
          `${path}.reviewDisposition`,
        ),
      reviewNote: !hasReviewNote
        ? null
        : item.reviewNote === null ? null : string(item.reviewNote, `${path}.reviewNote`),
    };
  });
  if (mutationWitnesses !== undefined) {
    uniqueBy(mutationWitnesses, (witness) => witness.witnessId, "decomposition.mutationWitnesses");
  }
  const submissionRoutes = !hasRoutingOverlay ? undefined : array(
    row.submissionRoutes,
    "decomposition.submissionRoutes",
  ).map((entry, index): AtlasSubmissionRoute => {
    const path = `decomposition.submissionRoutes[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(path, "must be an object");
    }
    const routeKeys = [
      "constraintIds", "hasUnresolved", "ideaIds", "interpretation", "mutationWitnessIds",
      "policyCoupled", "submissionId", "terminalReason",
    ];
    const routeRecord = exactRecord(entry, routeKeys, path);
    const interpretation = member(
      routeRecord.interpretation, SUBMISSION_INTERPRETATION, `${path}.interpretation`,
    );
    return {
      submissionId: string(routeRecord.submissionId, `${path}.submissionId`),
      mutationWitnessIds: strings(routeRecord.mutationWitnessIds, `${path}.mutationWitnessIds`),
      ideaIds: strings(routeRecord.ideaIds, `${path}.ideaIds`),
      constraintIds: strings(routeRecord.constraintIds, `${path}.constraintIds`),
      interpretation,
      policyCoupled: boolean(routeRecord.policyCoupled, `${path}.policyCoupled`),
      hasUnresolved: boolean(routeRecord.hasUnresolved, `${path}.hasUnresolved`),
      terminalReason: routeRecord.terminalReason === null
        ? null
        : member(routeRecord.terminalReason, SUBMISSION_TERMINAL_REASON, `${path}.terminalReason`),
    };
  });
  if (submissionRoutes !== undefined) {
    uniqueBy(submissionRoutes, (route) => route.submissionId, "decomposition.submissionRoutes");
  }
  return {
    schema: "yukon.atlas",
    schemaVersion: 5,
    view: "decomposition",
    areas,
    constraints,
    ideas,
    links,
    unresolved,
    ...(corpus === undefined ? {} : { corpus }),
    ...(dossiers === undefined ? {} : { dossiers }),
    ...(constraintAssessmentEvidence === undefined ? {} : { constraintAssessmentEvidence }),
    ...(constraintAssessments === undefined ? {} : { constraintAssessments }),
    ...(mutationWitnesses === undefined ? {} : { mutationWitnesses }),
    ...(submissionRoutes === undefined ? {} : { submissionRoutes }),
  };
}

export function buildAtlasRelease(
  pointer: AtlasReleasePointer,
  manifest: AtlasReleaseManifest,
  ideas: AtlasIdeasRole,
  solvers: AtlasSolversRole,
  submissions: AtlasSubmissionsRole,
  experiments: AtlasExperimentsRole | null = null,
  genealogy: AtlasGenealogyRole | null = null,
  decomposition: AtlasDecompositionRole | null = null,
): AtlasRelease {
  if (pointer.id !== manifest.releaseId) fail("manifest.releaseId", "must match the benchmark pointer");
  const expectedBaseSchemaVersion = manifest.schemaVersion === 2 ? 2 : 3;
  if (ideas.schemaVersion !== expectedBaseSchemaVersion
    || solvers.schemaVersion !== expectedBaseSchemaVersion
    || submissions.schemaVersion !== expectedBaseSchemaVersion) {
    fail("manifest.schemaVersion", "must match every eager base role");
  }
  const experimentRoleRequired = manifest.schemaVersion === 3
    || manifest.schemaVersion === 4
    || (manifest.schemaVersion === 5 && manifest.roles.experiments !== undefined);
  if (experimentRoleRequired !== (experiments !== null)) {
    fail("experiments", "must match the manifest experiment role");
  }
  if ((manifest.schemaVersion === 4) !== (genealogy !== null)) {
    fail("genealogy", "must match the manifest genealogy role");
  }
  if ((manifest.schemaVersion === 5) !== (decomposition !== null)) {
    fail("decomposition", "must be present exactly for an Atlas v5 release");
  }
  if (manifest.counts.ideas !== ideas.ideas.length
    || manifest.counts.solvers !== solvers.solvers.length
    || manifest.counts.submissions !== submissions.submissions.length) {
    fail("manifest.counts", "must match eager roles");
  }
  if ((manifest.schemaVersion === 3 || manifest.schemaVersion === 4
      || (manifest.schemaVersion === 5 && manifest.counts.experiments !== undefined))
    && manifest.counts.experiments !== (experiments?.experiments.length ?? 0)) {
    fail("manifest.counts.experiments", "must match the experiments role");
  }
  if (manifest.benchmark.direction !== submissions.direction) fail("submissions.direction", "must match the manifest");
  const ideaById = uniqueBy(ideas.ideas, (idea) => idea.id, "ideas.ideas");
  const solverById = uniqueBy(solvers.solvers, (solver) => solver.id, "solvers.solvers");
  const submissionById = uniqueBy(submissions.submissions, (submission) => submission.id, "submissions.submissions");
  const experimentById = uniqueBy(
    experiments?.experiments ?? [],
    (experiment) => experiment.id,
    "experiments.experiments",
  );
  const detailDescriptorByPath = uniqueBy(manifest.roles.details, (descriptor) => descriptor.path, "manifest.roles.details");
  const manifestExperimentDetails = manifest.schemaVersion === 3 || manifest.schemaVersion === 4
    ? manifest.roles.experimentDetails
    : manifest.schemaVersion === 5
      ? manifest.roles.experimentDetails ?? []
      : [];
  const experimentDetailDescriptorByPath = uniqueBy(
    manifestExperimentDetails,
    (descriptor) => descriptor.path,
    "manifest.roles.experimentDetails",
  );
  const usedDetailPaths = new Set<string>();
  const expectedHandoffs = new Map<string, number>();
  for (const submission of submissions.submissions) {
    if (!solverById.has(submission.solverId)) {
      fail(`submissions.submissions[${JSON.stringify(submission.id)}].solverId`, "must name an included solver");
    }
    if (!detailDescriptorByPath.has(submission.detailShard)) {
      fail(`submissions.submissions[${JSON.stringify(submission.id)}].detailShard`, "must name a manifest detail role");
    }
    usedDetailPaths.add(submission.detailShard);
    for (const change of submission.changes) {
      if (change.ideaId !== null && !ideaById.has(change.ideaId)) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].changes`, `names unknown idea ${change.ideaId}`);
      }
      const idea = change.ideaId === null ? undefined : ideaById.get(change.ideaId);
      if (change.relation === "instance_of" && idea?.variationOf !== null) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].changes`, "instance_of must target a top-level concept");
      }
      if (change.relation === "variant_of" && idea?.variationOf === null) {
        fail(`submissions.submissions[${JSON.stringify(submission.id)}].changes`, "variant_of must target a formal variant");
      }
    }
    if (submission.parentId !== null) {
      const parent = submissionById.get(submission.parentId)!;
      if (parent.solverId !== submission.solverId) {
        const pair = `${parent.solverId}\0${submission.solverId}`;
        expectedHandoffs.set(pair, (expectedHandoffs.get(pair) ?? 0) + 1);
      }
    }
  }
  if (usedDetailPaths.size !== detailDescriptorByPath.size) fail("manifest.roles.details", "contains an unused detail shard");
  const actualHandoffs = new Map(solvers.handoffs.map((handoff) => [
    `${handoff.fromSolverId}\0${handoff.toSolverId}`,
    handoff.commits,
  ]));
  if (actualHandoffs.size !== expectedHandoffs.size
    || [...expectedHandoffs].some(([pair, commits]) => actualHandoffs.get(pair) !== commits)) {
    fail("solvers.handoffs", "must equal verified cross-solver Git parents");
  }
  const usedExperimentDetailPaths = new Set<string>();
  for (const experiment of experiments?.experiments ?? []) {
    const experimentIdeaExists = manifest.schemaVersion === 5
      ? decomposition?.ideas.some((idea) => idea.ideaId === experiment.ideaId) ?? false
      : ideaById.has(experiment.ideaId);
    if (!experimentIdeaExists) {
      fail(
        `experiments.experiments[${JSON.stringify(experiment.id)}].ideaId`,
        manifest.schemaVersion === 5
          ? "must name an included recursive decomposition Idea"
          : "must name an included idea",
      );
    }
    for (const relatedIdeaId of experiment.relatedIdeaIds ?? []) {
      const relatedIdeaExists = manifest.schemaVersion === 5
        ? decomposition?.ideas.some((idea) => idea.ideaId === relatedIdeaId) ?? false
        : ideaById.has(relatedIdeaId);
      if (!relatedIdeaExists) {
        fail(
          `experiments.experiments[${JSON.stringify(experiment.id)}].relatedIdeaIds`,
          manifest.schemaVersion === 5
            ? `names unknown recursive decomposition Idea ${relatedIdeaId}`
            : `names unknown idea ${relatedIdeaId}`,
        );
      }
    }
    if (!experimentDetailDescriptorByPath.has(experiment.detailShard)) {
      fail(
        `experiments.experiments[${JSON.stringify(experiment.id)}].detailShard`,
        "must name a manifest experiment detail role",
      );
    }
    usedExperimentDetailPaths.add(experiment.detailShard);
    const solversInExperiment = new Set<string>();
    let promoted = 0;
    let failed = 0;
    for (const membership of experiment.variationMemberships) {
      if (membership.variationRef.kind === "research_artifact") continue;
      const submission = submissionById.get(membership.variationRef.id);
      if (submission === undefined) {
        fail(
          `experiments.experiments[${JSON.stringify(experiment.id)}].variationMemberships`,
          `names unknown submission ${membership.variationRef.id}`,
        );
      }
      const submissionMatchesIdea = manifest.schemaVersion === 5
        ? decomposition?.submissionRoutes?.some((route) => (
            route.submissionId === submission.id && route.ideaIds.includes(experiment.ideaId)
          )) ?? false
        : submission.changes.some((change) => {
            if (change.ideaId === experiment.ideaId) return true;
            if (change.ideaId === null) return false;
            return ideaById.get(change.ideaId)?.variationOf === experiment.ideaId;
          });
      if (!submissionMatchesIdea) {
        fail(
          `experiments.experiments[${JSON.stringify(experiment.id)}].variationMemberships`,
          manifest.schemaVersion === 5
            ? `submission ${membership.variationRef.id} is not routed to recursive decomposition Idea ${experiment.ideaId}`
            : `submission ${membership.variationRef.id} is not mapped to idea ${experiment.ideaId} or one of its formal variants`,
        );
      }
      solversInExperiment.add(submission.solverId);
      if (submission.status === "promoted") promoted += 1;
      if (submission.status === "failed" || submission.status === "promotion failed") failed += 1;
    }
    if (experiment.aggregate.solvers !== solversInExperiment.size
      || experiment.aggregate.promoted !== promoted
      || experiment.aggregate.failed !== failed) {
      fail(`experiments.experiments[${JSON.stringify(experiment.id)}].aggregate`, "must match included submissions");
    }
  }
  if (usedExperimentDetailPaths.size !== experimentDetailDescriptorByPath.size) {
    fail("manifest.roles.experimentDetails", "contains an unused experiment detail shard");
  }
  for (const edge of experiments?.edges ?? []) {
    const parent = experimentById.get(edge.parentExperimentId)!;
    const child = experimentById.get(edge.childExperimentId)!;
    if (!parent.variationMemberships.some((membership) => (
      membership.variationRef.kind === "submission" && membership.variationRef.id === edge.witnessParentSubmissionId
    ))
      || !child.variationMemberships.some((membership) => (
        membership.variationRef.kind === "submission" && membership.variationRef.id === edge.witnessChildSubmissionId
      ))
      || submissionById.get(edge.witnessChildSubmissionId)?.parentId !== edge.witnessParentSubmissionId) {
      fail(
        `experiments.edges[${JSON.stringify(edge.id)}]`,
        "must be witnessed by a literal source-parent relationship between member variations",
      );
    }
  }
  if (genealogy !== null) {
    if (manifest.schemaVersion !== 4) {
      fail("genealogy", "requires an Atlas v4 manifest");
    }
    const genealogyVariants = genealogy.experiments.flatMap((experiment) => experiment.variants);
    const genealogyUngroupedRuns = genealogy.experiments.flatMap((experiment) => experiment.ungroupedRunRefs);
    if (manifest.counts.genealogyEdges !== genealogy.edges.length
      || manifest.counts.genealogyEvents !== genealogy.events.length
      || manifest.counts.variants !== genealogyVariants.length
      || manifest.counts.ungroupedRuns !== genealogyUngroupedRuns.length) {
      fail("manifest.counts", "must match the genealogy overlay");
    }
    const annotationByIdeaId = uniqueBy(genealogy.ideaAnnotations, (annotation) => annotation.ideaId, "genealogy.ideaAnnotations");
    for (const [ideaId, annotation] of annotationByIdeaId) {
      if (!ideaById.has(ideaId)) fail(`genealogy.ideaAnnotations[${JSON.stringify(ideaId)}]`, "must name an included idea");
      for (const replacementId of annotation.replacementIdeaIds) {
        if (replacementId === ideaId || !ideaById.has(replacementId)) {
          fail(`genealogy.ideaAnnotations[${JSON.stringify(ideaId)}].replacementIdeaIds`, "must name other included ideas");
        }
      }
      if (annotation.firstEvidencedAt !== null
        && annotation.lastEvidencedAt !== null
        && Date.parse(annotation.firstEvidencedAt) > Date.parse(annotation.lastEvidencedAt)) {
        fail(`genealogy.ideaAnnotations[${JSON.stringify(ideaId)}]`, "must keep first evidence at or before last evidence");
      }
    }
    const incomingPrimaryByIdeaId = new Map<string, string>();
    const relationById = uniqueBy(ideas.relations, (relation) => relation.id, "ideas.relations");
    for (const edge of genealogy.edges) {
      if (!ideaById.has(edge.parentIdeaId) || !ideaById.has(edge.childIdeaId) || edge.parentIdeaId === edge.childIdeaId) {
        fail(`genealogy.edges[${JSON.stringify(edge.edgeId)}]`, "must connect two distinct included ideas");
      }
      const relation = relationById.get(edge.assertionId);
      if (relation === undefined
        || (relation.relation !== "specializes" && relation.relation !== "extends")
        || relation.subjectIdeaId !== edge.childIdeaId
        || relation.objectIdeaId !== edge.parentIdeaId) {
        fail(
          `genealogy.edges[${JSON.stringify(edge.edgeId)}].assertionId`,
          "must name the matching included specializes or extends assertion",
        );
      }
      if (edge.primary) {
        const prior = incomingPrimaryByIdeaId.get(edge.childIdeaId);
        if (prior !== undefined) {
          fail(
            `genealogy.edges[${JSON.stringify(edge.edgeId)}]`,
            "must not assign multiple primary incoming edges to one child",
          );
        }
        incomingPrimaryByIdeaId.set(edge.childIdeaId, edge.edgeId);
      }
    }
    assertAcyclic(
      ideas.ideas.filter((idea) => idea.variationOf === null).map((idea) => idea.id),
      genealogy.edges.map((edge) => ({ from: edge.parentIdeaId, to: edge.childIdeaId })),
      "genealogy.edges",
    );
    for (const annotation of genealogy.ideaAnnotations) {
      if (annotation.primaryIncomingEdgeId !== (incomingPrimaryByIdeaId.get(annotation.ideaId) ?? null)) {
        fail(
          `genealogy.ideaAnnotations[${JSON.stringify(annotation.ideaId)}].primaryIncomingEdgeId`,
          "must exactly name the idea's primary incoming edge",
        );
      }
    }
    for (const childIdeaId of incomingPrimaryByIdeaId.keys()) {
      if (!annotationByIdeaId.has(childIdeaId)) {
        fail(`genealogy.edges[${JSON.stringify(childIdeaId)}]`, "primary children must have a closing annotation");
      }
    }
    for (const event of genealogy.events) {
      for (const ideaId of [...event.inputIdeaIds, ...event.outputIdeaIds]) {
        if (!ideaById.has(ideaId)) {
          fail(`genealogy.events[${JSON.stringify(event.eventId)}]`, "must name included ideas");
        }
      }
      if (event.firstEvidencedAt !== null
        && event.lastEvidencedAt !== null
        && Date.parse(event.firstEvidencedAt) > Date.parse(event.lastEvidencedAt)) {
        fail(
          `genealogy.events[${JSON.stringify(event.eventId)}]`,
          "must keep first evidence at or before last evidence",
        );
      }
    }
    const overlaysByExperimentId = uniqueBy(
      genealogy.experiments,
      (experiment) => experiment.experimentId,
      "genealogy.experiments",
    );
    if (overlaysByExperimentId.size !== experimentById.size
      || [...experimentById.keys()].some((experimentId) => !overlaysByExperimentId.has(experimentId))) {
      fail("genealogy.experiments", "must contain exactly one overlay for every included experiment");
    }
    const variantsById = uniqueBy(genealogyVariants, (variant) => variant.variantId, "genealogy.experiments.variants");
    const groupedMembershipKeys = new Set<string>();
    const experimentMembershipKeys = new Map(
      (experiments?.experiments ?? []).map((experiment) => [
        experiment.id,
        new Map(experiment.variationMemberships.map((membership) => [
          variationRefKey(membership.variationRef),
          membership.evidenceRole,
        ])),
      ]),
    );
    for (const overlay of genealogy.experiments) {
      if (!experimentById.has(overlay.experimentId)) {
        fail(`genealogy.experiments[${JSON.stringify(overlay.experimentId)}]`, "must name an included experiment");
      }
      const membershipKeys = experimentMembershipKeys.get(overlay.experimentId)!;
      for (const runRef of overlay.ungroupedRunRefs) {
        const membershipKey = variationRefKey(runRef);
        if (!membershipKeys.has(membershipKey)) {
          fail(
            `genealogy.experiments[${JSON.stringify(overlay.experimentId)}].ungroupedRunRefs`,
            "must reference included experiment memberships",
          );
        }
        const groupedKey = `${overlay.experimentId}\0${membershipKey}`;
        if (groupedMembershipKeys.has(groupedKey)) {
          fail(
            `genealogy.experiments[${JSON.stringify(overlay.experimentId)}].ungroupedRunRefs`,
            "must not duplicate a run",
          );
        }
        groupedMembershipKeys.add(groupedKey);
      }
      for (const variant of overlay.variants) {
        for (const runRef of variant.runRefs) {
          const membershipKey = variationRefKey(runRef);
          if (!membershipKeys.has(membershipKey)) {
            fail(
              `genealogy.experiments[${JSON.stringify(overlay.experimentId)}].variants[${JSON.stringify(variant.variantId)}].runRefs`,
              "must reference included experiment memberships",
            );
          }
          if (membershipKeys.get(membershipKey) !== variant.membershipEvidence) {
            fail(
              `genealogy.experiments[${JSON.stringify(overlay.experimentId)}].variants[${JSON.stringify(variant.variantId)}].membershipEvidence`,
              "must match every covered experiment membership",
            );
          }
          const groupedKey = `${overlay.experimentId}\0${membershipKey}`;
          if (groupedMembershipKeys.has(groupedKey)) {
            fail(
              `genealogy.experiments[${JSON.stringify(overlay.experimentId)}].variants[${JSON.stringify(variant.variantId)}].runRefs`,
              "must not place the same run in multiple variants",
            );
          }
          groupedMembershipKeys.add(groupedKey);
        }
      }
    }
    for (const variant of genealogyVariants) {
      for (const parentVariantId of variant.parentVariantIds) {
        const parent = variantsById.get(parentVariantId);
        if (parent === undefined || parent.experimentId !== variant.experimentId || parent.variantId === variant.variantId) {
          fail(
            `genealogy.experiments.variants[${JSON.stringify(variant.variantId)}].parentVariantIds`,
            "must name other variants in the same experiment",
          );
        }
        const parentSubmissionIds = new Set(
          parent.runRefs.filter((runRef) => runRef.kind === "submission").map((runRef) => runRef.id),
        );
        const witnessed = variant.runRefs.some((runRef) => (
          runRef.kind === "submission"
          && submissionById.get(runRef.id)?.parentId !== null
          && parentSubmissionIds.has(submissionById.get(runRef.id)!.parentId!)
        ));
        if (!witnessed) {
          fail(
            `genealogy.experiments.variants[${JSON.stringify(variant.variantId)}].parentVariantIds`,
            `parent ${parentVariantId} requires a literal submission source-parent witness`,
          );
        }
      }
    }
    assertAcyclic(
      genealogyVariants.map((variant) => variant.variantId),
      genealogyVariants.flatMap((variant) => variant.parentVariantIds.map((parentVariantId) => ({ from: parentVariantId, to: variant.variantId }))),
      "genealogy.experiments.variants",
    );
    for (const experiment of experiments?.experiments ?? []) {
      const expected = experimentMembershipKeys.get(experiment.id)!;
      const covered = new Set(
        [...groupedMembershipKeys]
          .filter((entry) => entry.startsWith(`${experiment.id}\0`))
          .map((entry) => entry.slice(experiment.id.length + 1)),
      );
      if (covered.size !== expected.size || [...expected.keys()].some((membershipKey) => !covered.has(membershipKey))) {
        fail(
          `genealogy.experiments[${JSON.stringify(experiment.id)}]`,
          "must close exactly over the experiment memberships",
        );
      }
    }
  }
  const areaById = new Map<string, AtlasResearchArea>();
  const constraintById = new Map<string, AtlasResearchConstraint>();
  const decompositionIdeaById = new Map<string, AtlasResearchIdea>();
  const constraintsByOwnerKey = new Map<string, AtlasResearchConstraint[]>();
  const linksByConstraintId = new Map<string, AtlasConstraintIdeaLink[]>();
  const linksByIdeaId = new Map<string, AtlasConstraintIdeaLink[]>();
  const primaryPathByIdeaId = new Map<string, string[]>();
  const dossierByIdeaId = new Map<string, AtlasIdeaDossier>();
  const constraintAssessmentById = new Map<string, AtlasConstraintAssessment>();
  const constraintAssessmentEvidenceById = new Map<string, AtlasConstraintAssessmentEvidence>();
  const mutationWitnessById = new Map<string, AtlasMutationWitness>();
  const mutationWitnessesByIdeaId = new Map<string, AtlasMutationWitness[]>();
  const submissionRouteById = new Map<string, AtlasSubmissionRoute>();
  const ideaIdsBySubmissionId = new Map<string, string[]>();
  if (decomposition !== null) {
    if (manifest.schemaVersion !== 5) fail("decomposition", "requires an Atlas v5 manifest");
    if (manifest.counts.areas !== decomposition.areas.length
      || manifest.counts.constraints !== decomposition.constraints.length
      || manifest.counts.decompositionIdeas !== decomposition.ideas.length
      || manifest.counts.constraintIdeaLinks !== decomposition.links.length) {
      fail("manifest.counts", "must match the decomposition overlay");
    }
    const hasEvidenceOverlay = decomposition.constraintAssessments !== undefined;
    const hasAssessmentManifest = manifest.counts.constraintAssessments !== undefined
      || manifest.source.constraintAssessmentRegistrySha256 !== undefined;
    if (hasEvidenceOverlay !== hasAssessmentManifest
      || (manifest.counts.constraintAssessments === undefined)
        !== (manifest.source.constraintAssessmentRegistrySha256 === undefined)) {
      fail("manifest", "must pin and count the constraint evidence overlay exactly when present");
    }
    if (hasEvidenceOverlay
      && manifest.counts.constraintAssessments !== decomposition.constraintAssessments!.length) {
      fail("manifest.counts.constraintAssessments", "must match the decomposition overlay");
    }
    for (const area of decomposition.areas) areaById.set(area.areaId, area);
    if (areaById.size !== decomposition.areas.length) fail("decomposition.areas", "contains duplicate IDs");
    const knownChangeIds = new Set(
      submissions.submissions.flatMap((submission) => submission.changes.map((change) => change.id)),
    );
    for (const idea of decomposition.ideas) {
      if (decompositionIdeaById.has(idea.ideaId)) fail("decomposition.ideas", "contains duplicate IDs");
      if (idea.source.kind === "concept") {
        const source = ideaById.get(idea.source.id);
        if (source === undefined || source.variationOf !== null) {
          fail(`decomposition.ideas[${JSON.stringify(idea.ideaId)}].source`, "must name a canonical included Idea");
        }
      } else if (!knownChangeIds.has(idea.source.id)) {
        fail(`decomposition.ideas[${JSON.stringify(idea.ideaId)}].source`, "must name an included reviewed intervention");
      }
      decompositionIdeaById.set(idea.ideaId, idea);
    }
    for (const constraint of decomposition.constraints) {
      if (constraintById.has(constraint.constraintId)) fail("decomposition.constraints", "contains duplicate IDs");
      const ownerExists = constraint.owner.kind === "area"
        ? areaById.has(constraint.owner.id)
        : decompositionIdeaById.has(constraint.owner.id);
      if (!ownerExists) {
        fail(`decomposition.constraints[${JSON.stringify(constraint.constraintId)}].owner`, "must name one Area or Idea");
      }
      constraintById.set(constraint.constraintId, constraint);
      const ownerKey = `${constraint.owner.kind}:${constraint.owner.id}`;
      const owned = constraintsByOwnerKey.get(ownerKey) ?? [];
      owned.push(constraint);
      constraintsByOwnerKey.set(ownerKey, owned);
    }
    const linkedConstraints = new Set<string>();
    const linkedIdeas = new Set<string>();
    const incomingPrimary = new Map<string, AtlasConstraintIdeaLink>();
    for (const link of decomposition.links) {
      if (!constraintById.has(link.constraintId) || !decompositionIdeaById.has(link.ideaId)) {
        fail(`decomposition.links[${JSON.stringify(link.linkId)}]`, "must connect one included Constraint and Idea");
      }
      if (link.primary && incomingPrimary.has(link.ideaId)) {
        fail(`decomposition.links[${JSON.stringify(link.linkId)}]`, "must not give an Idea two primary links");
      }
      if (link.primary) incomingPrimary.set(link.ideaId, link);
      linkedConstraints.add(link.constraintId);
      linkedIdeas.add(link.ideaId);
      const constraintLinks = linksByConstraintId.get(link.constraintId) ?? [];
      constraintLinks.push(link);
      linksByConstraintId.set(link.constraintId, constraintLinks);
      const ideaLinks = linksByIdeaId.get(link.ideaId) ?? [];
      ideaLinks.push(link);
      linksByIdeaId.set(link.ideaId, ideaLinks);
    }
    if (linkedConstraints.size !== constraintById.size || linkedIdeas.size !== decompositionIdeaById.size) {
      fail("decomposition", "must not contain orphaned Constraints or Ideas");
    }
    assertAcyclic(
      [...decompositionIdeaById.keys()],
      decomposition.links.flatMap((link) => {
        const owner = constraintById.get(link.constraintId)!.owner;
        return owner.kind === "idea" ? [{ from: owner.id, to: link.ideaId }] : [];
      }),
      "decomposition.links",
    );
    const reachable = new Set([...areaById.keys()].map((id) => `area:${id}`));
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of decomposition.links) {
        const owner = constraintById.get(link.constraintId)!.owner;
        if (reachable.has(`${owner.kind}:${owner.id}`) && !reachable.has(`idea:${link.ideaId}`)) {
          reachable.add(`idea:${link.ideaId}`);
          changed = true;
        }
      }
    }
    if ([...decompositionIdeaById.keys()].some((id) => !reachable.has(`idea:${id}`))) {
      fail("decomposition", "must keep every Idea reachable from a Research Area");
    }
    const knownSubjects = new Set([
      ...areaById.keys(), ...constraintById.keys(), ...decompositionIdeaById.keys(),
    ]);
    for (const unresolved of decomposition.unresolved) {
      if (unresolved.subjectIds.length === 0
        || unresolved.subjectIds.some((subjectId) => !knownSubjects.has(subjectId))) {
        fail(`decomposition.unresolved[${JSON.stringify(unresolved.unresolvedId)}]`, "must name included subjects");
      }
    }
    const preferredIncoming = new Map<string, AtlasConstraintIdeaLink>();
    for (const [ideaId, ideaLinks] of linksByIdeaId) {
      preferredIncoming.set(
        ideaId,
        incomingPrimary.get(ideaId) ?? [...ideaLinks].sort((a, b) => a.linkId.localeCompare(b.linkId))[0]!,
      );
    }
    const buildPath = (ideaId: string): string[] => {
      const reverse = [ideaId];
      const visited = new Set([ideaId]);
      let cursor = ideaId;
      while (true) {
        const incoming = preferredIncoming.get(cursor);
        if (incoming === undefined) break;
        reverse.push(incoming.constraintId);
        const owner = constraintById.get(incoming.constraintId)!.owner;
        reverse.push(owner.id);
        if (owner.kind === "area") break;
        if (visited.has(owner.id)) fail("decomposition", "contains a cycle in its preferred paths");
        visited.add(owner.id);
        cursor = owner.id;
      }
      return reverse.reverse();
    };
    for (const ideaId of decompositionIdeaById.keys()) {
      primaryPathByIdeaId.set(ideaId, buildPath(ideaId));
    }
    const sameIds = (actual: readonly string[], expected: readonly string[]): boolean => {
      if (actual.length !== expected.length) return false;
      const expectedSet = new Set(expected);
      return actual.every((id) => expectedSet.has(id));
    };
    const ideaDescendsFrom = (ideaId: string, ancestorIdeaId: string, visited = new Set<string>()): boolean => {
      if (ideaId === ancestorIdeaId) return true;
      if (visited.has(ideaId)) return false;
      visited.add(ideaId);
      return (linksByIdeaId.get(ideaId) ?? []).some((link) => {
        const owner = constraintById.get(link.constraintId)!.owner;
        return owner.kind === "idea" && ideaDescendsFrom(owner.id, ancestorIdeaId, new Set(visited));
      });
    };
    for (const evidence of decomposition.constraintAssessmentEvidence ?? []) {
      constraintAssessmentEvidenceById.set(evidence.evidenceId, evidence);
    }
    for (const assessment of decomposition.constraintAssessments ?? []) {
      if (!constraintById.has(assessment.constraintId)) {
        fail(
          `decomposition.constraintAssessments[${JSON.stringify(assessment.assessmentId)}].constraintId`,
          "must name an included Constraint",
        );
      }
      const comparableKind = assessment.limit.kind === "proven_floor"
        || assessment.limit.kind === "pinned_floor"
        || assessment.limit.kind === "working_bound";
      if (comparableKind
        && assessment.limit.value !== null
        && assessment.baseline.value !== null
        && assessment.frontier.value !== null) {
        const baseline = assessment.baseline.value;
        const frontier = assessment.frontier.value;
        const limit = assessment.limit.value;
        const ordered = assessment.metric.direction === "lower"
          ? limit <= frontier && frontier <= baseline
          : baseline <= frontier && frontier <= limit;
        if (!ordered) {
          fail(
            `decomposition.constraintAssessments[${JSON.stringify(assessment.assessmentId)}]`,
            "must order its baseline, frontier, and limit in the optimization direction",
          );
        }
        const gap = assessment.metric.direction === "lower" ? baseline - limit : limit - baseline;
        const closed = assessment.metric.direction === "lower" ? baseline - frontier : frontier - baseline;
        if (gap === 0) {
          if (assessment.progress !== null) {
            fail(
              `decomposition.constraintAssessments[${JSON.stringify(assessment.assessmentId)}].progress`,
              "must be null when the known gap is zero",
            );
          }
        } else {
          const expected = closed / gap;
          if (assessment.progress === null || Math.abs(assessment.progress - expected) > 1e-9) {
            fail(
              `decomposition.constraintAssessments[${JSON.stringify(assessment.assessmentId)}].progress`,
              "must equal the mechanically derived known-gap progress",
            );
          }
        }
      } else if (assessment.progress !== null) {
        fail(
          `decomposition.constraintAssessments[${JSON.stringify(assessment.assessmentId)}].progress`,
          "requires a numeric comparable limit",
        );
      }
      constraintAssessmentById.set(assessment.constraintId, assessment);
    }
    if (decomposition.mutationWitnesses !== undefined && decomposition.submissionRoutes !== undefined) {
      const expectedWitnessIds = new Set<string>();
      for (const submission of submissions.submissions) {
        for (const change of submission.changes) {
          if (expectedWitnessIds.has(change.id)) {
            fail("submissions.submissions.changes", `contains duplicate mutation witness ${JSON.stringify(change.id)}`);
          }
          expectedWitnessIds.add(change.id);
        }
      }
      for (const witness of decomposition.mutationWitnesses) {
        const submission = submissionById.get(witness.submissionId);
        const change = submission?.changes.find((candidate) => candidate.id === witness.witnessId);
        if (submission === undefined || change === undefined) {
          fail(
            `decomposition.mutationWitnesses[${JSON.stringify(witness.witnessId)}]`,
            "must name one immutable included mutation",
          );
        }
        if (witness.mappingIdeaId !== change.ideaId || witness.relation !== change.relation) {
          fail(
            `decomposition.mutationWitnesses[${JSON.stringify(witness.witnessId)}]`,
            "must preserve the mutation mapping exactly",
          );
        }
        const mappingIdeaId = witness.mappingIdeaId;
        const expectedConceptIdeaIds = mappingIdeaId === null
          || (witness.relation !== "instance_of" && witness.relation !== "variant_of")
          ? []
          : [...decompositionIdeaById.values()].flatMap((idea) => {
              if (idea.ideaId === mappingIdeaId) return [idea.ideaId];
              if (idea.source.kind === "reviewed_intervention") return [];
              const mapped = ideaById.get(mappingIdeaId);
              const canonicalId = mapped?.variationOf ?? mapped?.id;
              return canonicalId === idea.source.id ? [idea.ideaId] : [];
            });
        const routedIdeaId = witness.ideaIds[0];
        const routedIdeaIds = new Set(witness.ideaIds);
        const everyConstraintMatchesAnIdea = witness.constraintIds.every((constraintId) => (
          (linksByConstraintId.get(constraintId) ?? []).some((link) => routedIdeaIds.has(link.ideaId))
        ));
        const expectedBroadIdeaId = expectedConceptIdeaIds.length === 1 ? expectedConceptIdeaIds[0] : undefined;
        const everyConstraintPreservesMappedContext = routedIdeaId === undefined
          ? true
          : expectedBroadIdeaId === undefined
            ? false
            : witness.constraintIds.every((constraintId) => {
              if (routedIdeaId === expectedBroadIdeaId) return true;
              const owner = constraintById.get(constraintId)?.owner;
              return owner?.kind === "idea" && ideaDescendsFrom(owner.id, expectedBroadIdeaId);
            });
        if (witness.ideaIds.some((ideaId) => !decompositionIdeaById.has(ideaId))
          || witness.ideaIds.length > 1
          || expectedConceptIdeaIds.length > 1
          || (routedIdeaId === undefined) !== (witness.constraintIds.length === 0)
          || !everyConstraintMatchesAnIdea
          || !everyConstraintPreservesMappedContext) {
          fail(
            `decomposition.mutationWitnesses[${JSON.stringify(witness.witnessId)}]`,
            "must route to at most one mapped Idea or reviewed descendant through compatible Constraint placements",
          );
        }
        mutationWitnessById.set(witness.witnessId, witness);
        for (const ideaId of witness.ideaIds) {
          const ideaWitnesses = mutationWitnessesByIdeaId.get(ideaId) ?? [];
          ideaWitnesses.push(witness);
          mutationWitnessesByIdeaId.set(ideaId, ideaWitnesses);
        }
      }
      if (mutationWitnessById.size !== expectedWitnessIds.size
        || [...expectedWitnessIds].some((witnessId) => !mutationWitnessById.has(witnessId))) {
        fail("decomposition.mutationWitnesses", "must contain every included mutation exactly once");
      }
      for (const route of decomposition.submissionRoutes) {
        const submission = submissionById.get(route.submissionId);
        if (submission === undefined) {
          fail(
            `decomposition.submissionRoutes[${JSON.stringify(route.submissionId)}]`,
            "must name an included Submission",
          );
        }
        const expectedMutationWitnessIds = submission.changes.map((change) => change.id);
        const routedWitnesses = expectedMutationWitnessIds.map((witnessId) => mutationWitnessById.get(witnessId)!);
        const expectedIdeaIds = [...new Set(routedWitnesses.flatMap((witness) => witness.ideaIds))];
        const expectedConstraintIds = [...new Set(routedWitnesses.flatMap((witness) => witness.constraintIds))];
        const hasUnroutedWitness = routedWitnesses.some((witness) => witness.ideaIds.length === 0);
        const focused = expectedMutationWitnessIds.length === 1
          && expectedIdeaIds.length === 1
          && submission.score !== null
          && submission.directionalGain !== null
          && submission.parentId !== null
          && submission.scoreComparatorId === submission.parentId
          && submission.scoreComparatorHops === 1
          && !route.hasUnresolved;
        const expectedInterpretation = expectedIdeaIds.length === 0
          ? "unmapped"
          : expectedIdeaIds.length > 1
            ? "mixed"
            : focused ? "focused" : "single_idea";
        if (!sameIds(route.mutationWitnessIds, expectedMutationWitnessIds)
          || !sameIds(route.ideaIds, expectedIdeaIds)
          || !sameIds(route.constraintIds, expectedConstraintIds)
          || (route.hasUnresolved && !hasUnroutedWitness)
          || route.interpretation !== expectedInterpretation) {
          fail(
            `decomposition.submissionRoutes[${JSON.stringify(route.submissionId)}]`,
            "must close exactly over its mutations and normalized public routes",
          );
        }
        if ((route.ideaIds.length === 0) !== (route.terminalReason !== null)) {
          fail(
            `decomposition.submissionRoutes[${JSON.stringify(route.submissionId)}].terminalReason`,
            "must explain every unmapped Submission and no mapped Submission",
          );
        }
        submissionRouteById.set(route.submissionId, route);
        ideaIdsBySubmissionId.set(route.submissionId, route.ideaIds);
      }
      if (submissionRouteById.size !== submissionById.size
        || [...submissionById.keys()].some((submissionId) => !submissionRouteById.has(submissionId))) {
        fail("decomposition.submissionRoutes", "must contain every included Submission exactly once");
      }
      const mappedSubmissions = decomposition.submissionRoutes.filter((route) => route.ideaIds.length > 0).length;
      const unresolvedSubmissions = decomposition.submissionRoutes.filter((route) => route.hasUnresolved).length;
      const withoutMappedMutation = decomposition.submissionRoutes.length - mappedSubmissions;
      const multiIdeaSubmissions = decomposition.submissionRoutes.filter((route) => route.ideaIds.length > 1).length;
      if (decomposition.corpus === undefined
        || decomposition.corpus.submissions !== decomposition.submissionRoutes.length
        || decomposition.corpus.mappedSubmissions !== mappedSubmissions
        || decomposition.corpus.unresolvedSubmissions !== unresolvedSubmissions
        || decomposition.corpus.withoutMappedMutation !== withoutMappedMutation
        || decomposition.corpus.multiIdeaSubmissions !== multiIdeaSubmissions) {
        fail("decomposition.corpus", "must be mechanically derived from Submission routes");
      }
    }
    if (decomposition.corpus !== undefined || decomposition.dossiers !== undefined) {
      if (decomposition.corpus === undefined || decomposition.dossiers === undefined) {
        fail("decomposition", "must provide corpus and dossiers together");
      }
      if (decomposition.corpus.submissions !== submissions.submissions.length) {
        fail("decomposition.corpus.submissions", "must match the submission role");
      }
      for (const dossier of decomposition.dossiers) {
        const publicIdea = decompositionIdeaById.get(dossier.ideaId);
        if (publicIdea === undefined || dossierByIdeaId.has(dossier.ideaId)) {
          fail(`decomposition.dossiers[${JSON.stringify(dossier.ideaId)}]`, "must name one included Idea once");
        }
        for (const approach of dossier.approaches) {
          const idea = ideaById.get(approach.ideaId);
          if (idea === undefined || idea.variationOf === null
            || publicIdea.source.kind !== "concept"
            || idea.variationOf !== publicIdea.source.id) {
            fail(
              `decomposition.dossiers[${JSON.stringify(dossier.ideaId)}].approaches`,
              "must name a private reviewed approach owned by the Idea's source Concept",
            );
          }
        }
        for (const witness of dossier.representativeWitnesses) {
          const submission = submissionById.get(witness.submissionId);
          const change = submission?.changes.find((item) => item.id === witness.changeId);
          if (submission === undefined || change === undefined
            || witness.title !== change.title
            || witness.description !== change.description
            || witness.site !== change.site
            || witness.status !== submission.status
            || witness.directionalGain !== submission.directionalGain
            || witness.scoreComparatorId !== submission.scoreComparatorId
            || witness.scoreComparatorHops !== submission.scoreComparatorHops
            || witness.bundledChangeCount !== submission.changes.length
            || witness.detailShard !== submission.detailShard
            || (decomposition.mutationWitnesses !== undefined
              && !(mutationWitnessesByIdeaId.get(dossier.ideaId) ?? [])
                .some((candidate) => candidate.witnessId === witness.changeId
                  && candidate.submissionId === witness.submissionId))) {
            fail(
              `decomposition.dossiers[${JSON.stringify(dossier.ideaId)}].representativeWitnesses`,
              "must copy one included immutable mutation observation exactly",
            );
          }
        }
        if (decomposition.mutationWitnesses !== undefined) {
          const fullWitnesses = mutationWitnessesByIdeaId.get(dossier.ideaId) ?? [];
          const observedSubmissions = [...new Set(fullWitnesses.map((witness) => witness.submissionId))]
            .map((submissionId) => submissionById.get(submissionId)!);
          const expectedCoverage = {
            submissions: observedSubmissions.length,
            witnesses: fullWitnesses.length,
            singleChangeSubmissions: observedSubmissions.filter((submission) => submission.changes.length === 1).length,
            bundledSubmissions: observedSubmissions.filter((submission) => submission.changes.length !== 1).length,
            promoted: observedSubmissions.filter((submission) => submission.status === "promoted").length,
            rejected: observedSubmissions.filter((submission) => submission.status === "rejected").length,
            failed: observedSubmissions.filter((submission) => submission.status === "failed").length,
            promotionFailed: observedSubmissions.filter((submission) => submission.status === "promotion failed").length,
            solvers: new Set(observedSubmissions.map((submission) => submission.solverId)).size,
          };
          if (Object.entries(expectedCoverage).some(([key, value]) => (
            dossier.coverage[key as keyof typeof expectedCoverage] !== value
          ))) {
            fail(
              `decomposition.dossiers[${JSON.stringify(dossier.ideaId)}].coverage`,
              "must be mechanically derived from the complete mutation witness set",
            );
          }
        }
        dossierByIdeaId.set(dossier.ideaId, dossier);
      }
      if (dossierByIdeaId.size !== decompositionIdeaById.size) {
        fail("decomposition.dossiers", "must contain exactly one dossier per Idea");
      }
    }
  }
  const genealogyAnnotationByIdeaId = new Map(
    (genealogy?.ideaAnnotations ?? []).map((annotation) => [annotation.ideaId, annotation]),
  );
  const genealogyChildrenByIdeaId = new Map<string, AtlasIdeaGenealogyEdge[]>();
  const genealogyParentsByIdeaId = new Map<string, AtlasIdeaGenealogyEdge[]>();
  for (const edge of genealogy?.edges ?? []) {
    const children = genealogyChildrenByIdeaId.get(edge.parentIdeaId) ?? [];
    children.push(edge);
    genealogyChildrenByIdeaId.set(edge.parentIdeaId, children);
    const parents = genealogyParentsByIdeaId.get(edge.childIdeaId) ?? [];
    parents.push(edge);
    genealogyParentsByIdeaId.set(edge.childIdeaId, parents);
  }
  const variants = genealogy?.experiments.flatMap((experiment) => experiment.variants) ?? [];
  const variantById = new Map(variants.map((variant) => [variant.variantId, variant]));
  const variantsByExperimentId = new Map(
    (genealogy?.experiments ?? []).map((experiment) => [experiment.experimentId, experiment.variants]),
  );
  const runsByVariantId = new Map(variants.map((variant) => [variant.variantId, variant.runRefs]));
  const ungroupedRunsByExperimentId = new Map(
    (genealogy?.experiments ?? []).map((experiment) => [experiment.experimentId, experiment.ungroupedRunRefs]),
  );
  return {
    pointer,
    manifest,
    ideas,
    solvers,
    submissions,
    experiments,
    genealogy,
    decomposition,
    ideaById,
    solverById,
    submissionById,
    experimentById,
    genealogyAnnotationByIdeaId,
    genealogyChildrenByIdeaId,
    genealogyParentsByIdeaId,
    variantById,
    variantsByExperimentId,
    runsByVariantId,
    ungroupedRunsByExperimentId,
    areaById,
    constraintById,
    decompositionIdeaById,
    constraintsByOwnerKey,
    linksByConstraintId,
    linksByIdeaId,
    primaryPathByIdeaId,
    dossierByIdeaId,
    constraintAssessmentById,
    constraintAssessmentEvidenceById,
    mutationWitnessById,
    mutationWitnessesByIdeaId,
    submissionRouteById,
    ideaIdsBySubmissionId,
    detailDescriptorByPath,
    experimentDetailDescriptorByPath,
  };
}

export function parseAtlasSubmissionDetail(
  value: unknown,
  release: AtlasRelease,
  descriptor: AtlasRoleDescriptor,
): AtlasSubmissionDetailModel {
  const row = roleRoot(value, "submission-detail", ["shard", "excerpts", "submissions"]);
  const match = DETAIL_PATH.exec(descriptor.path);
  if (match === null) fail("submission-detail", "descriptor path is invalid");
  const shard = string(row.shard, "submission-detail.shard");
  if (shard !== match[1]) fail("submission-detail.shard", "must match its descriptor path");
  const excerpts = strings(row.excerpts, "submission-detail.excerpts");
  const submissions = array(row.submissions, "submission-detail.submissions").map((entry, index): AtlasSubmissionDetail => {
    const path = `submission-detail.submissions[${index}]`;
    const item = exactRecord(entry, ["submissionId", "note", "evidence"], path);
    const submissionId = string(item.submissionId, `${path}.submissionId`);
    const submission = release.submissionById.get(submissionId);
    if (submission === undefined || submission.detailShard !== descriptor.path) {
      fail(`${path}.submissionId`, "must name a submission routed to this shard");
    }
    const changeIds = new Set(submission.changes.map((change) => change.id));
    const evidence = array(item.evidence, `${path}.evidence`).map((entryValue, evidenceIndex) => {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      const evidenceRow = exactRecord(entryValue, ["changeId", "excerptIndex"], evidencePath);
      const changeId = string(evidenceRow.changeId, `${evidencePath}.changeId`);
      const excerptIndex = integer(evidenceRow.excerptIndex, `${evidencePath}.excerptIndex`);
      if (!changeIds.has(changeId)) fail(`${evidencePath}.changeId`, "must name a change in the submission index");
      if (excerptIndex >= excerpts.length) fail(`${evidencePath}.excerptIndex`, "must index an included excerpt");
      return { changeId, excerpt: excerpts[excerptIndex]! };
    });
    uniqueBy(evidence, (entryValue) => entryValue.changeId, `${path}.evidence`);
    return {
      submissionId,
      note: nullableString(item.note, `${path}.note`),
      evidence,
    };
  });
  const submissionById = uniqueBy(submissions, (submission) => submission.submissionId, "submission-detail.submissions");
  const expected = release.submissions.submissions.filter((submission) => submission.detailShard === descriptor.path);
  if (submissionById.size !== expected.length || expected.some((submission) => !submissionById.has(submission.id))) {
    fail("submission-detail.submissions", "must cover its routed submissions exactly once");
  }
  return { shard, submissionById };
}

function parseArtifactPin(value: unknown, path: string): { artifactId: string; sha256: string } | null {
  if (value === null) return null;
  const row = exactRecord(value, ["artifactId", "sha256"], path);
  return {
    artifactId: string(row.artifactId, `${path}.artifactId`),
    sha256: sha256(row.sha256, `${path}.sha256`),
  };
}

function traceFingerprint(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!SHA256.test(parsed)) fail(path, "must be a lowercase 64-hex fingerprint");
  return parsed;
}

function parseControlledResult(value: unknown, path: string): AtlasExperimentControlledResult {
  const versionRow = value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(path, "must be an object");
  const schemaVersion = integer(versionRow.schemaVersion, `${path}.schemaVersion`);
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    fail(`${path}.schemaVersion`, "must be 1 or 2");
  }
  const row = exactRecord(
    value,
    schemaVersion === 1
      ? ["schemaVersion", "officialObservation", "pairedScopes"]
      : ["schemaVersion", "officialObservation", "pairedScopes", "packetAdmission", "pooledCorrectness"],
    path,
  );

  const parseQualificationArm = (value: unknown, armPath: string) => {
    const arm = exactRecord(value, ["status", "score"], armPath);
    const status = member(
      arm.status,
      ["passed", "failed", "unavailable"] as const,
      `${armPath}.status`,
    );
    const score = nullableFinite(arm.score, `${armPath}.score`);
    if ((status === "passed") !== (score !== null)) {
      fail(armPath, "must record an absolute score exactly when qualification passed");
    }
    return { status, score };
  };
  const parseConcordanceFacet = (value: unknown, facetPath: string) => {
    const facet = exactRecord(
      value,
      ["status", "method", "controlFingerprint", "treatmentFingerprint"],
      facetPath,
    );
    const status = member(
      facet.status,
      ["identical", "different", "unavailable"] as const,
      `${facetPath}.status`,
    );
    const method = nullableString(facet.method, `${facetPath}.method`);
    const controlFingerprint = facet.controlFingerprint === null
      ? null
      : traceFingerprint(facet.controlFingerprint, `${facetPath}.controlFingerprint`);
    const treatmentFingerprint = facet.treatmentFingerprint === null
      ? null
      : traceFingerprint(facet.treatmentFingerprint, `${facetPath}.treatmentFingerprint`);
    if (status === "unavailable") {
      if (method !== null || controlFingerprint !== null || treatmentFingerprint !== null) {
        fail(facetPath, "unavailable concordance must not fabricate fingerprint evidence");
      }
    } else {
      if (method === null || controlFingerprint === null || treatmentFingerprint === null) {
        fail(facetPath, "recorded concordance requires a method and both fingerprints");
      }
      if ((status === "identical") !== (controlFingerprint === treatmentFingerprint)) {
        fail(facetPath, `${status} must match the exact recorded fingerprints`);
      }
    }
    return { status, method, controlFingerprint, treatmentFingerprint };
  };
  const parseTraceConcordance = (value: unknown, concordancePath: string) => {
    const concordanceRow = exactRecord(
      value,
      ["observed_output", "phase", "ancilla"],
      concordancePath,
    );
    return {
      observed_output: parseConcordanceFacet(
        concordanceRow.observed_output,
        `${concordancePath}.observed_output`,
      ),
      phase: parseConcordanceFacet(concordanceRow.phase, `${concordancePath}.phase`),
      ancilla: parseConcordanceFacet(concordanceRow.ancilla, `${concordancePath}.ancilla`),
    };
  };

  const parseResourceObservations = (value: unknown, resourcePath: string) => {
    const resourceObservations = array(value, resourcePath)
    .map((entry, index) => {
      const observationPath = `${resourcePath}[${index}]`;
      const observation = exactRecord(
        entry,
        ["metric", "unit", "control", "treatment", "treatmentMinusControl"],
        observationPath,
      );
      const control = finite(observation.control, `${observationPath}.control`);
      const treatment = finite(observation.treatment, `${observationPath}.treatment`);
      const treatmentMinusControl = finite(
        observation.treatmentMinusControl,
        `${observationPath}.treatmentMinusControl`,
      );
      if (!approximatelyEqual(treatmentMinusControl, treatment - control)) {
        fail(`${observationPath}.treatmentMinusControl`, "must equal treatment minus control");
      }
      return {
        metric: string(observation.metric, `${observationPath}.metric`),
        unit: string(observation.unit, `${observationPath}.unit`),
        control,
        treatment,
        treatmentMinusControl,
      };
    });
    uniqueBy(
      resourceObservations,
      (observation) => `${observation.metric}\0${observation.unit}`,
      resourcePath,
    );
    return resourceObservations;
  };
  const parseCorrectnessDimensionSummary = (value: unknown, summaryPath: string) => {
    const row = exactRecord(value, [
      "n00NeitherFailed",
      "n01TreatmentOnlyFailed",
      "n10ControlOnlyFailed",
      "n11BothFailed",
      "controlFailures",
      "treatmentFailures",
      "controlRisk",
      "treatmentRisk",
      "riskDifferenceTreatmentMinusControl",
      "discordantShots",
      "exactTwoSidedMcNemarPValue",
    ], summaryPath);
    const n00 = integer(row.n00NeitherFailed, `${summaryPath}.n00NeitherFailed`);
    const n01 = integer(row.n01TreatmentOnlyFailed, `${summaryPath}.n01TreatmentOnlyFailed`);
    const n10 = integer(row.n10ControlOnlyFailed, `${summaryPath}.n10ControlOnlyFailed`);
    const n11 = integer(row.n11BothFailed, `${summaryPath}.n11BothFailed`);
    const controlFailures = integer(row.controlFailures, `${summaryPath}.controlFailures`);
    const treatmentFailures = integer(row.treatmentFailures, `${summaryPath}.treatmentFailures`);
    const controlRisk = finite(row.controlRisk, `${summaryPath}.controlRisk`);
    const treatmentRisk = finite(row.treatmentRisk, `${summaryPath}.treatmentRisk`);
    const riskDifference = finite(
      row.riskDifferenceTreatmentMinusControl,
      `${summaryPath}.riskDifferenceTreatmentMinusControl`,
    );
    const discordantShots = integer(row.discordantShots, `${summaryPath}.discordantShots`);
    const exactP = finite(row.exactTwoSidedMcNemarPValue, `${summaryPath}.exactTwoSidedMcNemarPValue`);
    if (n00 < 0 || n01 < 0 || n10 < 0 || n11 < 0 || controlFailures < 0 || treatmentFailures < 0 || discordantShots < 0) {
      fail(summaryPath, "correctness counts must be non-negative");
    }
    const shotCount = n00 + n01 + n10 + n11;
    if (shotCount === 0) fail(summaryPath, "correctness summary must cover at least one shot");
    if (controlFailures !== n10 + n11) fail(`${summaryPath}.controlFailures`, "must equal n10 + n11");
    if (treatmentFailures !== n01 + n11) fail(`${summaryPath}.treatmentFailures`, "must equal n01 + n11");
    if (discordantShots !== n01 + n10) fail(`${summaryPath}.discordantShots`, "must equal n01 + n10");
    if (!approximatelyEqual(controlRisk, controlFailures / shotCount)) {
      fail(`${summaryPath}.controlRisk`, "must equal controlFailures divided by total shots");
    }
    if (!approximatelyEqual(treatmentRisk, treatmentFailures / shotCount)) {
      fail(`${summaryPath}.treatmentRisk`, "must equal treatmentFailures divided by total shots");
    }
    if (!approximatelyEqual(riskDifference, (n01 - n10) / shotCount)) {
      fail(
        `${summaryPath}.riskDifferenceTreatmentMinusControl`,
        "must equal treatment-only minus control-only failures divided by total shots",
      );
    }
    if (exactP < 0 || exactP > 1) fail(`${summaryPath}.exactTwoSidedMcNemarPValue`, "must lie between 0 and 1");
    return {
      n00NeitherFailed: n00,
      n01TreatmentOnlyFailed: n01,
      n10ControlOnlyFailed: n10,
      n11BothFailed: n11,
      controlFailures,
      treatmentFailures,
      controlRisk,
      treatmentRisk,
      riskDifferenceTreatmentMinusControl: riskDifference,
      discordantShots,
      exactTwoSidedMcNemarPValue: exactP,
    };
  };
  const parseCorrectnessObservation = (value: unknown, observationPath: string) => {
    const row = exactRecord(value, ["shotCount", "dimensions"], observationPath);
    const shotCount = integer(row.shotCount, `${observationPath}.shotCount`);
    if (shotCount <= 0) fail(`${observationPath}.shotCount`, "must be positive");
    const dimensionsRow = exactRecord(
      row.dimensions,
      ["classicalMismatch", "phaseGarbage", "ancillaGarbage", "anyCorrectnessFailure"],
      `${observationPath}.dimensions`,
    );
    const dimensions = {
      classicalMismatch: parseCorrectnessDimensionSummary(
        dimensionsRow.classicalMismatch,
        `${observationPath}.dimensions.classicalMismatch`,
      ),
      phaseGarbage: parseCorrectnessDimensionSummary(
        dimensionsRow.phaseGarbage,
        `${observationPath}.dimensions.phaseGarbage`,
      ),
      ancillaGarbage: parseCorrectnessDimensionSummary(
        dimensionsRow.ancillaGarbage,
        `${observationPath}.dimensions.ancillaGarbage`,
      ),
      anyCorrectnessFailure: parseCorrectnessDimensionSummary(
        dimensionsRow.anyCorrectnessFailure,
        `${observationPath}.dimensions.anyCorrectnessFailure`,
      ),
    };
    for (const [dimension, summary] of Object.entries(dimensions)) {
      const countedShots = summary.n00NeitherFailed
        + summary.n01TreatmentOnlyFailed
        + summary.n10ControlOnlyFailed
        + summary.n11BothFailed;
      if (countedShots !== shotCount) {
        fail(`${observationPath}.dimensions.${dimension}`, "must sum to the recorded shot count");
      }
    }
    return { shotCount, dimensions };
  };
  const parsePacketAdmission = (value: unknown, admissionPath: string) => {
    const row = exactRecord(value, ["admitted", "issues"], admissionPath);
    const admitted = boolean(row.admitted, `${admissionPath}.admitted`);
    const issues = strings(row.issues, `${admissionPath}.issues`);
    if (admitted && issues.length !== 0) fail(`${admissionPath}.issues`, "must be empty when admitted is true");
    if (!admitted && issues.length === 0) fail(`${admissionPath}.issues`, "must explain why admission failed");
    uniqueBy(issues, (issue) => issue, `${admissionPath}.issues`);
    return { admitted, issues };
  };

  const parseUnavailableEffect = (value: unknown, effectPath: string) => {
    const effect = exactRecord(
      value,
      ["status", "reasonCode", "reason"],
      effectPath,
    );
    const reasonCode = string(effect.reasonCode, `${effectPath}.reasonCode`);
    if (!/^[a-z][a-z0-9_]*$/u.test(reasonCode)) {
      fail(`${effectPath}.reasonCode`, "must be a lowercase underscore identifier");
    }
    return {
      status: "unavailable" as const,
      reasonCode,
      reason: string(effect.reason, `${effectPath}.reason`),
    };
  };
  const parseEstimatedEffect = (value: unknown, effectPath: string) => {
    const effectCandidate = value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const effectStatus = effectCandidate === null
      ? null
      : member(effectCandidate.status, ["estimated", "unavailable"] as const, `${effectPath}.status`);
    if (effectStatus === "estimated") {
      const effect = exactRecord(value, ["status", "delta"], effectPath);
      return {
        status: "estimated" as const,
        delta: finite(effect.delta, `${effectPath}.delta`),
      };
    }
    return parseUnavailableEffect(value, effectPath);
  };
  const parseBenchmarkEffect = (value: unknown, effectPath: string) => {
    const effectCandidate = value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const effectStatus = effectCandidate === null
      ? null
      : member(effectCandidate.status, ["admitted", "estimated", "unavailable"] as const, `${effectPath}.status`);
    if (effectStatus === "admitted" || effectStatus === "estimated") {
      const effect = exactRecord(value, ["status", "delta"], effectPath);
      return {
        status: effectStatus,
        delta: finite(effect.delta, `${effectPath}.delta`),
      };
    }
    return parseUnavailableEffect(value, effectPath);
  };

  const officialObservationRow = exactRecord(
    row.officialObservation,
    ["qualification", "resourceObservations", "benchmarkEffect"],
    `${path}.officialObservation`,
  );
  const officialQualificationRow = exactRecord(
    officialObservationRow.qualification,
    ["control", "treatment"],
    `${path}.officialObservation.qualification`,
  );
  const officialObservation = {
    qualification: {
      control: parseQualificationArm(
        officialQualificationRow.control,
        `${path}.officialObservation.qualification.control`,
      ),
      treatment: parseQualificationArm(
        officialQualificationRow.treatment,
        `${path}.officialObservation.qualification.treatment`,
      ),
    },
    resourceObservations: parseResourceObservations(
      officialObservationRow.resourceObservations,
      `${path}.officialObservation.resourceObservations`,
    ),
    benchmarkEffect: parseEstimatedEffect(
      officialObservationRow.benchmarkEffect,
      `${path}.officialObservation.benchmarkEffect`,
    ),
  };
  const bothOfficialPassed = officialObservation.qualification.control.status === "passed"
    && officialObservation.qualification.treatment.status === "passed";
  if (officialObservation.benchmarkEffect.status === "estimated") {
    if (!bothOfficialPassed) {
      fail(`${path}.officialObservation.benchmarkEffect`, "estimated official effects require both official arms to pass");
    }
    const expectedDelta = officialObservation.qualification.treatment.score!
      - officialObservation.qualification.control.score!;
    if (!approximatelyEqual(officialObservation.benchmarkEffect.delta, expectedDelta)) {
      fail(
        `${path}.officialObservation.benchmarkEffect.delta`,
        "must equal treatment minus control official score",
      );
    }
  }

  const pairedScopes = array(row.pairedScopes, `${path}.pairedScopes`).map((entry, index) => {
    const scopePath = `${path}.pairedScopes[${index}]`;
    const scope = exactRecord(
      entry,
      schemaVersion === 1
        ? ["scopeId", "controlStatus", "treatmentStatus", "traceConcordance", "resourceObservations", "benchmarkEffect"]
        : ["scopeId", "controlStatus", "treatmentStatus", "traceConcordance", "resourceObservations", "benchmarkEffect", "correctness"],
      scopePath,
    );
    const controlStatus = member(
      scope.controlStatus,
      ["passed", "failed", "unavailable"] as const,
      `${scopePath}.controlStatus`,
    );
    const treatmentStatus = member(
      scope.treatmentStatus,
      ["passed", "failed", "unavailable"] as const,
      `${scopePath}.treatmentStatus`,
    );
    const traceConcordance = parseTraceConcordance(scope.traceConcordance, `${scopePath}.traceConcordance`);
    const benchmarkEffect = parseBenchmarkEffect(
      scope.benchmarkEffect,
      `${scopePath}.benchmarkEffect`,
    );
    const bothPassed = controlStatus === "passed" && treatmentStatus === "passed";
    if (benchmarkEffect.status !== "unavailable" && !bothPassed) {
      fail(`${scopePath}.benchmarkEffect`, "recorded paired effects require both paired arms to pass");
    }
    if (benchmarkEffect.status === "admitted") {
      const allTracesIdentical = Object.values(traceConcordance).every((facet) => facet.status === "identical");
      if (!allTracesIdentical) {
        fail(`${scopePath}.benchmarkEffect`, "cannot be admitted before the paired trace gates pass");
      }
    }
    return {
      scopeId: string(scope.scopeId, `${scopePath}.scopeId`),
      controlStatus,
      treatmentStatus,
      traceConcordance,
      resourceObservations: parseResourceObservations(scope.resourceObservations, `${scopePath}.resourceObservations`),
      benchmarkEffect,
      correctness: schemaVersion === 1
        ? null
        : parseCorrectnessObservation(scope.correctness, `${scopePath}.correctness`),
    };
  });
  uniqueBy(pairedScopes, (scope) => scope.scopeId, `${path}.pairedScopes`);
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      officialObservation,
      pairedScopes,
    };
  }
  const packetAdmission = parsePacketAdmission(row.packetAdmission, `${path}.packetAdmission`);
  if (!packetAdmission.admitted
    && pairedScopes.some((scope) => scope.benchmarkEffect.status !== "unavailable")) {
    fail(
      `${path}.pairedScopes`,
      "blocked packet admission cannot expose a paired benchmark effect",
    );
  }
  const pooledCorrectness = parseCorrectnessObservation(row.pooledCorrectness, `${path}.pooledCorrectness`);
  const summedShotCount = pairedScopes.reduce((total, scope) => total + (scope.correctness?.shotCount ?? 0), 0);
  if (pooledCorrectness.shotCount !== summedShotCount) {
    fail(`${path}.pooledCorrectness.shotCount`, "must equal the sum of paired-scope shot counts");
  }
  for (const dimension of [
    "classicalMismatch",
    "phaseGarbage",
    "ancillaGarbage",
    "anyCorrectnessFailure",
  ] as const) {
    const totals = pairedScopes.reduce((accumulator, scope) => {
      const summary = scope.correctness!.dimensions[dimension];
      accumulator.n00NeitherFailed += summary.n00NeitherFailed;
      accumulator.n01TreatmentOnlyFailed += summary.n01TreatmentOnlyFailed;
      accumulator.n10ControlOnlyFailed += summary.n10ControlOnlyFailed;
      accumulator.n11BothFailed += summary.n11BothFailed;
      return accumulator;
    }, {
      n00NeitherFailed: 0,
      n01TreatmentOnlyFailed: 0,
      n10ControlOnlyFailed: 0,
      n11BothFailed: 0,
    });
    const pooled = pooledCorrectness.dimensions[dimension];
    if (
      pooled.n00NeitherFailed !== totals.n00NeitherFailed
      || pooled.n01TreatmentOnlyFailed !== totals.n01TreatmentOnlyFailed
      || pooled.n10ControlOnlyFailed !== totals.n10ControlOnlyFailed
      || pooled.n11BothFailed !== totals.n11BothFailed
    ) {
      fail(`${path}.pooledCorrectness.dimensions.${dimension}`, "must equal the sum of the paired-scope summaries");
    }
  }
  return {
    schemaVersion: 2,
    officialObservation,
    pairedScopes,
    packetAdmission,
    pooledCorrectness,
  };
}

const EXPERIMENT_EVIDENCE_RANK: Readonly<Record<AtlasExperimentEvidenceLevel, number>> = {
  historical_observation: 0,
  matched_control: 1,
  one_change_ablation: 2,
  reproduced: 3,
  replicated: 4,
};

const FACTORIAL_CELL_ORDER = ["00", "10", "01", "11"] as const;

function parseFactorialResult(
  value: unknown,
  path: string,
  experiment: AtlasExperiment,
  release: AtlasRelease,
): AtlasExperimentFactorialResultV1 {
  const row = exactRecord(value, [
    "schemaVersion", "sourceSubmissionId", "packetAdmission", "factors", "cellOrder", "cells", "scopes", "limitations",
  ], path);
  if (integer(row.schemaVersion, `${path}.schemaVersion`) !== 1) {
    fail(`${path}.schemaVersion`, "must be 1");
  }
  const sourceSubmissionId = string(row.sourceSubmissionId, `${path}.sourceSubmissionId`);
  if (!release.submissionById.has(sourceSubmissionId)) {
    fail(`${path}.sourceSubmissionId`, "must name an included submission");
  }
  if (!experiment.variationMemberships.some((membership) => (
    membership.variationRef.kind === "submission" && membership.variationRef.id === sourceSubmissionId
  ))) {
    fail(`${path}.sourceSubmissionId`, "must name a submission attached to this experiment");
  }
  const packetAdmissionRow = exactRecord(row.packetAdmission, ["admitted", "issues"], `${path}.packetAdmission`);
  const packetAdmission = {
    admitted: boolean(packetAdmissionRow.admitted, `${path}.packetAdmission.admitted`),
    issues: strings(packetAdmissionRow.issues, `${path}.packetAdmission.issues`),
  };
  uniqueBy(packetAdmission.issues, (issue) => issue, `${path}.packetAdmission.issues`);
  if (packetAdmission.admitted !== (packetAdmission.issues.length === 0)) {
    fail(`${path}.packetAdmission.issues`, "must be empty exactly when the packet is admitted");
  }

  const factors = array(row.factors, `${path}.factors`).map((entry, index) => {
    const factorPath = `${path}.factors[${index}]`;
    const factor = exactRecord(entry, ["factorId", "ideaId", "label", "offLabel", "onLabel"], factorPath);
    return {
      factorId: string(factor.factorId, `${factorPath}.factorId`),
      ideaId: string(factor.ideaId, `${factorPath}.ideaId`),
      label: string(factor.label, `${factorPath}.label`),
      offLabel: string(factor.offLabel, `${factorPath}.offLabel`),
      onLabel: string(factor.onLabel, `${factorPath}.onLabel`),
    };
  });
  if (factors.length !== 2) fail(`${path}.factors`, "must contain exactly two factors");
  uniqueBy(factors, (factor) => factor.factorId, `${path}.factors`);
  uniqueBy(factors, (factor) => factor.ideaId, `${path}.factors`);
  const attachedIdeaIds = new Set([experiment.ideaId, ...(experiment.relatedIdeaIds ?? [])]);
  for (const factor of factors) {
    if (!attachedIdeaIds.has(factor.ideaId)) {
      fail(`${path}.factors`, `factor ${factor.factorId} names Idea ${factor.ideaId} not attached to the experiment`);
    }
  }

  const cellOrder = strings(row.cellOrder, `${path}.cellOrder`);
  if (cellOrder.length !== FACTORIAL_CELL_ORDER.length
    || cellOrder.some((cellId, index) => cellId !== FACTORIAL_CELL_ORDER[index])) {
    fail(`${path}.cellOrder`, "must be exactly 00, 10, 01, 11");
  }
  const cells = array(row.cells, `${path}.cells`).map((entry, index) => {
    const cellPath = `${path}.cells[${index}]`;
    const cell = exactRecord(entry, ["cellId", "artifact", "repeatBuildSha256"], cellPath);
    const artifact = parseArtifactPin(cell.artifact, `${cellPath}.artifact`);
    if (artifact === null) fail(`${cellPath}.artifact`, "must pin the built cell artifact");
    return {
      cellId: member(cell.cellId, FACTORIAL_CELL_ORDER, `${cellPath}.cellId`),
      artifact,
      repeatBuildSha256: sha256(cell.repeatBuildSha256, `${cellPath}.repeatBuildSha256`),
    };
  });
  if (cells.length !== FACTORIAL_CELL_ORDER.length
    || cells.some((cell, index) => cell.cellId !== FACTORIAL_CELL_ORDER[index])) {
    fail(`${path}.cells`, "must contain the cells once in 00, 10, 01, 11 order");
  }
  uniqueBy(cells, (cell) => cell.artifact.artifactId, `${path}.cells`);
  uniqueBy(cells, (cell) => cell.artifact.sha256, `${path}.cells`);
  for (const cell of cells) {
    if (cell.repeatBuildSha256 !== cell.artifact.sha256) {
      fail(`${path}.cells[${JSON.stringify(cell.cellId)}].repeatBuildSha256`, "must equal the independently repeated build hash");
    }
  }

  type CellValues = Record<(typeof FACTORIAL_CELL_ORDER)[number], number>;
  const parseCellValues = (value: unknown, valuesPath: string, counts: boolean): CellValues => {
    const values = exactRecord(value, FACTORIAL_CELL_ORDER, valuesPath);
    return {
      "00": counts ? integer(values["00"], `${valuesPath}.00`) : finite(values["00"], `${valuesPath}.00`),
      "10": counts ? integer(values["10"], `${valuesPath}.10`) : finite(values["10"], `${valuesPath}.10`),
      "01": counts ? integer(values["01"], `${valuesPath}.01`) : finite(values["01"], `${valuesPath}.01`),
      "11": counts ? integer(values["11"], `${valuesPath}.11`) : finite(values["11"], `${valuesPath}.11`),
    };
  };
  const interaction = (values: CellValues) => values["11"] - values["10"] - values["01"] + values["00"];
  const parseSimpleEffects = (value: unknown, effectsPath: string, values: CellValues) => {
    const effects = array(value, effectsPath).map((entry, index) => {
      const effectPath = `${effectsPath}[${index}]`;
      const effect = exactRecord(entry, ["factorId", "heldFactorId", "heldLevel", "delta"], effectPath);
      const heldLevel = integer(effect.heldLevel, `${effectPath}.heldLevel`);
      if (heldLevel !== 0 && heldLevel !== 1) fail(`${effectPath}.heldLevel`, "must be 0 or 1");
      return {
        factorId: string(effect.factorId, `${effectPath}.factorId`),
        heldFactorId: string(effect.heldFactorId, `${effectPath}.heldFactorId`),
        heldLevel: heldLevel as 0 | 1,
        delta: finite(effect.delta, `${effectPath}.delta`),
      };
    });
    if (effects.length !== 4) fail(effectsPath, "must contain all four simple effects exactly once");
    const firstFactor = factors[0]!;
    const secondFactor = factors[1]!;
    const expected = new Map<string, number>([
      [`${firstFactor.factorId}\0${secondFactor.factorId}\0${0}`, values["10"] - values["00"]],
      [`${firstFactor.factorId}\0${secondFactor.factorId}\0${1}`, values["11"] - values["01"]],
      [`${secondFactor.factorId}\0${firstFactor.factorId}\0${0}`, values["01"] - values["00"]],
      [`${secondFactor.factorId}\0${firstFactor.factorId}\0${1}`, values["11"] - values["10"]],
    ]);
    for (const effect of effects) {
      const key = `${effect.factorId}\0${effect.heldFactorId}\0${effect.heldLevel}`;
      const expectedDelta = expected.get(key);
      if (expectedDelta === undefined) fail(effectsPath, "must identify each factor at both levels of the other factor");
      if (!approximatelyEqual(effect.delta, expectedDelta)) {
        fail(`${effectsPath}[${JSON.stringify(key)}].delta`, "must be recomputed from the four cell values");
      }
      expected.delete(key);
    }
    if (expected.size !== 0) fail(effectsPath, "must contain all four simple effects exactly once");
    return effects;
  };
  const parseMechanicalInteraction = (value: unknown, effectPath: string, expectedDelta: number) => {
    const candidate = value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : fail(effectPath, "must be an object");
    const status = member(
      candidate.status,
      ["admitted", "observed_not_admitted", "unavailable"] as const,
      `${effectPath}.status`,
    );
    if (status === "unavailable") {
      const effect = exactRecord(value, ["status", "reason"], effectPath);
      return { status, reason: string(effect.reason, `${effectPath}.reason`) } as const;
    }
    const effect = exactRecord(value, ["status", "delta"], effectPath);
    const delta = finite(effect.delta, `${effectPath}.delta`);
    if (!approximatelyEqual(delta, expectedDelta)) {
      fail(`${effectPath}.delta`, "must equal 11 - 10 - 01 + 00");
    }
    if (!packetAdmission.admitted && status === "admitted") {
      fail(`${effectPath}.status`, "cannot be admitted when the result packet is not admitted");
    }
    return { status, delta } as const;
  };

  const scopes = array(row.scopes, `${path}.scopes`).map((entry, scopeIndex) => {
    const scopePath = `${path}.scopes[${scopeIndex}]`;
    const scope = exactRecord(
      entry,
      ["scopeId", "shotCount", "cells", "correctness", "resourceEffects", "benchmarkInteraction"],
      scopePath,
    );
    const shotCount = integer(scope.shotCount, `${scopePath}.shotCount`);
    if (shotCount === 0) fail(`${scopePath}.shotCount`, "must be positive");
    const scopeCells = array(scope.cells, `${scopePath}.cells`).map((cellEntry, cellIndex) => {
      const scopeCellPath = `${scopePath}.cells[${cellIndex}]`;
      const scopeCell = exactRecord(cellEntry, ["cellId", "status", "resourceScore", "resources"], scopeCellPath);
      const resources = array(scopeCell.resources, `${scopeCellPath}.resources`).map((resourceEntry, resourceIndex) => {
        const resourcePath = `${scopeCellPath}.resources[${resourceIndex}]`;
        const resource = exactRecord(resourceEntry, ["metric", "unit", "value"], resourcePath);
        return {
          metric: string(resource.metric, `${resourcePath}.metric`),
          unit: string(resource.unit, `${resourcePath}.unit`),
          value: finite(resource.value, `${resourcePath}.value`),
        };
      });
      uniqueBy(resources, (resource) => `${resource.metric}\0${resource.unit}`, `${scopeCellPath}.resources`);
      const averageToffoli = resources.find((resource) => resource.metric === "averageToffoli")?.value;
      const maxReferencedQubits = resources.find((resource) => resource.metric === "maxReferencedQubits")?.value;
      if (averageToffoli === undefined || maxReferencedQubits === undefined) {
        fail(`${scopeCellPath}.resources`, "must include averageToffoli and maxReferencedQubits");
      }
      const resourceScore = finite(scopeCell.resourceScore, `${scopeCellPath}.resourceScore`);
      if (!approximatelyEqual(resourceScore, averageToffoli * maxReferencedQubits)) {
        fail(`${scopeCellPath}.resourceScore`, "must equal averageToffoli times maxReferencedQubits");
      }
      return {
        cellId: member(scopeCell.cellId, FACTORIAL_CELL_ORDER, `${scopeCellPath}.cellId`),
        status: member(
          scopeCell.status,
          ["passed", "failed", "unavailable"] as const,
          `${scopeCellPath}.status`,
        ),
        resourceScore,
        resources,
      };
    });
    if (scopeCells.length !== 4 || scopeCells.some((cell, index) => cell.cellId !== FACTORIAL_CELL_ORDER[index])) {
      fail(`${scopePath}.cells`, "must contain the cells once in 00, 10, 01, 11 order");
    }
    const correctness = array(scope.correctness, `${scopePath}.correctness`).map((correctnessEntry, correctnessIndex) => {
      const correctnessPath = `${scopePath}.correctness[${correctnessIndex}]`;
      const correctnessRow = exactRecord(correctnessEntry, [
        "dimension", "cellFailures", "cellRisks", "patternCounts", "simpleRiskDifferences", "interactionRiskDifference",
      ], correctnessPath);
      const cellFailures = parseCellValues(correctnessRow.cellFailures, `${correctnessPath}.cellFailures`, true);
      const cellRisks = parseCellValues(correctnessRow.cellRisks, `${correctnessPath}.cellRisks`, false);
      for (const cellId of FACTORIAL_CELL_ORDER) {
        if (!approximatelyEqual(cellRisks[cellId], cellFailures[cellId] / shotCount)) {
          fail(`${correctnessPath}.cellRisks.${cellId}`, "must equal failures divided by the scope shot count");
        }
      }
      const patternCounts = array(correctnessRow.patternCounts, `${correctnessPath}.patternCounts`).map(
        (patternEntry, patternIndex) => {
          const patternPath = `${correctnessPath}.patternCounts[${patternIndex}]`;
          const patternRow = exactRecord(patternEntry, ["pattern", "shots"], patternPath);
          const pattern = string(patternRow.pattern, `${patternPath}.pattern`);
          if (!/^[01]{4}$/u.test(pattern)) fail(`${patternPath}.pattern`, "must be four binary cell-failure flags");
          return { pattern, shots: integer(patternRow.shots, `${patternPath}.shots`) };
        },
      );
      uniqueBy(patternCounts, (patternCount) => patternCount.pattern, `${correctnessPath}.patternCounts`);
      if (patternCounts.reduce((total, patternCount) => total + patternCount.shots, 0) !== shotCount) {
        fail(`${correctnessPath}.patternCounts`, "must sum to the scope shot count");
      }
      for (let cellIndex = 0; cellIndex < FACTORIAL_CELL_ORDER.length; cellIndex += 1) {
        const expectedFailures = patternCounts.reduce(
          (total, patternCount) => total + (patternCount.pattern[cellIndex] === "1" ? patternCount.shots : 0),
          0,
        );
        const cellId = FACTORIAL_CELL_ORDER[cellIndex]!;
        if (cellFailures[cellId] !== expectedFailures) {
          fail(`${correctnessPath}.cellFailures.${cellId}`, "must match the recorded joint failure patterns");
        }
      }
      const simpleRiskDifferences = parseSimpleEffects(
        correctnessRow.simpleRiskDifferences,
        `${correctnessPath}.simpleRiskDifferences`,
        cellRisks,
      );
      const interactionRiskDifference = finite(
        correctnessRow.interactionRiskDifference,
        `${correctnessPath}.interactionRiskDifference`,
      );
      if (!approximatelyEqual(interactionRiskDifference, interaction(cellRisks))) {
        fail(`${correctnessPath}.interactionRiskDifference`, "must equal 11 - 10 - 01 + 00 risk");
      }
      return {
        dimension: string(correctnessRow.dimension, `${correctnessPath}.dimension`),
        cellFailures,
        cellRisks,
        patternCounts,
        simpleRiskDifferences,
        interactionRiskDifference,
      };
    });
    uniqueBy(correctness, (observation) => observation.dimension, `${scopePath}.correctness`);
    const anyFailure = correctness.find((observation) => observation.dimension === "anyCorrectnessFailure");
    if (anyFailure === undefined) {
      fail(`${scopePath}.correctness`, "must include anyCorrectnessFailure");
    }
    for (const cell of scopeCells) {
      const failures = anyFailure.cellFailures[cell.cellId];
      if ((failures === 0 && cell.status !== "passed") || (failures > 0 && cell.status !== "failed")) {
        fail(`${scopePath}.cells[${JSON.stringify(cell.cellId)}].status`, "must match anyCorrectnessFailure");
      }
    }

    const resourceEffects = array(scope.resourceEffects, `${scopePath}.resourceEffects`).map((effectEntry, effectIndex) => {
      const effectPath = `${scopePath}.resourceEffects[${effectIndex}]`;
      const effect = exactRecord(effectEntry, ["metric", "unit", "cellValues", "simpleEffects", "interaction"], effectPath);
      const metric = string(effect.metric, `${effectPath}.metric`);
      const unit = string(effect.unit, `${effectPath}.unit`);
      const cellValues = parseCellValues(effect.cellValues, `${effectPath}.cellValues`, false);
      for (const cell of scopeCells) {
        const recorded = cell.resources.find((resource) => resource.metric === metric && resource.unit === unit);
        if (recorded === undefined || !approximatelyEqual(recorded.value, cellValues[cell.cellId])) {
          fail(`${effectPath}.cellValues.${cell.cellId}`, "must match the per-cell resource observation");
        }
      }
      return {
        metric,
        unit,
        cellValues,
        simpleEffects: parseSimpleEffects(effect.simpleEffects, `${effectPath}.simpleEffects`, cellValues),
        interaction: parseMechanicalInteraction(effect.interaction, `${effectPath}.interaction`, interaction(cellValues)),
      };
    });
    uniqueBy(resourceEffects, (effect) => `${effect.metric}\0${effect.unit}`, `${scopePath}.resourceEffects`);

    const benchmarkCandidate = scope.benchmarkInteraction !== null
      && typeof scope.benchmarkInteraction === "object"
      && !Array.isArray(scope.benchmarkInteraction)
      ? scope.benchmarkInteraction as Record<string, unknown>
      : fail(`${scopePath}.benchmarkInteraction`, "must be an object");
    const benchmarkStatus = member(
      benchmarkCandidate.status,
      ["admitted", "unavailable"] as const,
      `${scopePath}.benchmarkInteraction.status`,
    );
    const benchmarkInteraction = benchmarkStatus === "admitted"
      ? (() => {
          const benchmark = exactRecord(scope.benchmarkInteraction, ["status", "delta"], `${scopePath}.benchmarkInteraction`);
          const delta = finite(benchmark.delta, `${scopePath}.benchmarkInteraction.delta`);
          const resourceScores: CellValues = {
            "00": scopeCells[0]!.resourceScore,
            "10": scopeCells[1]!.resourceScore,
            "01": scopeCells[2]!.resourceScore,
            "11": scopeCells[3]!.resourceScore,
          };
          if (!approximatelyEqual(delta, interaction(resourceScores))) {
            fail(`${scopePath}.benchmarkInteraction.delta`, "must equal 11 - 10 - 01 + 00 resourceScore");
          }
          if (!packetAdmission.admitted) {
            fail(`${scopePath}.benchmarkInteraction.status`, "cannot be admitted when the result packet is not admitted");
          }
          return { status: "admitted" as const, delta };
        })()
      : (() => {
          const benchmark = exactRecord(scope.benchmarkInteraction, ["status", "reason"], `${scopePath}.benchmarkInteraction`);
          return {
            status: "unavailable" as const,
            reason: string(benchmark.reason, `${scopePath}.benchmarkInteraction.reason`),
          };
        })();
    return {
      scopeId: string(scope.scopeId, `${scopePath}.scopeId`),
      shotCount,
      cells: scopeCells,
      correctness,
      resourceEffects,
      benchmarkInteraction,
    };
  });
  if (scopes.length === 0) fail(`${path}.scopes`, "must not be empty");
  uniqueBy(scopes, (scope) => scope.scopeId, `${path}.scopes`);

  return {
    schemaVersion: 1,
    sourceSubmissionId,
    packetAdmission,
    factors: factors as AtlasExperimentFactorialResultV1["factors"],
    cellOrder: [...FACTORIAL_CELL_ORDER],
    cells: cells as AtlasExperimentFactorialResultV1["cells"],
    scopes,
    limitations: strings(row.limitations, `${path}.limitations`),
  };
}

export function parseAtlasExperimentDetail(
  value: unknown,
  release: AtlasRelease,
  descriptor: AtlasRoleDescriptor,
): AtlasExperimentDetailModel {
  if ((release.manifest.schemaVersion !== 3
    && release.manifest.schemaVersion !== 4
    && release.manifest.schemaVersion !== 5) || release.experiments === null) {
    fail("experiment-detail", "requires an Atlas release with experiment roles");
  }
  const row = exactRecord(
    value,
    ["schema", "schemaVersion", "view", "shard", "experiments"],
    "experiment-detail",
  );
  if (row.schema !== "yukon.atlas"
    || (row.schemaVersion !== 3 && row.schemaVersion !== 4 && row.schemaVersion !== 5)
    || row.view !== "experiment-detail") {
    fail("experiment-detail", "has unsupported identity");
  }
  const detailSchemaVersion = row.schemaVersion;
  const match = EXPERIMENT_DETAIL_PATH.exec(descriptor.path);
  if (match === null) fail("experiment-detail", "descriptor path is invalid");
  const shard = string(row.shard, "experiment-detail.shard");
  if (shard !== match[1]) fail("experiment-detail.shard", "must match its descriptor path");
  const experiments = array(row.experiments, "experiment-detail.experiments")
    .map((entry, index): AtlasExperimentDetail => {
      const path = `experiment-detail.experiments[${index}]`;
      const item = exactRecord(entry, [
        "experimentId", "framing", "variationRule", "literature", "controlledComparisons", "researchRuns",
      ], path);
      const experimentId = string(item.experimentId, `${path}.experimentId`);
      const experiment = release.experimentById.get(experimentId);
      if (experiment === undefined || experiment.detailShard !== descriptor.path) {
        fail(`${path}.experimentId`, "must name an experiment routed to this shard");
      }
      const framingRow = exactRecord(item.framing, ["retrospective", "prospective"], `${path}.framing`);
      const retrospective = framingRow.retrospective === null ? null : (() => {
        const retrospectiveRow = exactRecord(
          framingRow.retrospective,
          ["observedPattern", "limitations"],
          `${path}.framing.retrospective`,
        );
        return {
          observedPattern: string(retrospectiveRow.observedPattern, `${path}.framing.retrospective.observedPattern`),
          limitations: strings(retrospectiveRow.limitations, `${path}.framing.retrospective.limitations`),
        };
      })();
      const prospective = framingRow.prospective === null ? null : (() => {
        const prospectiveRow = exactRecord(
          framingRow.prospective,
          ["hypothesis", "predictedOutcome", "falsificationCriteria"],
          `${path}.framing.prospective`,
        );
        const falsificationCriteria = strings(
          prospectiveRow.falsificationCriteria,
          `${path}.framing.prospective.falsificationCriteria`,
        );
        if (falsificationCriteria.length === 0) {
          fail(`${path}.framing.prospective.falsificationCriteria`, "must not be empty");
        }
        return {
          hypothesis: string(prospectiveRow.hypothesis, `${path}.framing.prospective.hypothesis`),
          predictedOutcome: string(prospectiveRow.predictedOutcome, `${path}.framing.prospective.predictedOutcome`),
          falsificationCriteria,
        };
      })();
      if (experiment.framingProvenance === "retrospective_review") {
        if (retrospective === null || prospective !== null) {
          fail(`${path}.framing`, "must not fabricate prospective framing for a retrospective review");
        }
      } else if (prospective === null || retrospective !== null) {
        fail(`${path}.framing`, "must contain only prospective framing for a prospective experiment");
      }
      const variationRuleRow = exactRecord(
        item.variationRule,
        ["unit", "treatment", "heldConstant", "allowedDifferences", "exclusionCriteria"],
        `${path}.variationRule`,
      );
      const variationRule = {
        unit: member(
          variationRuleRow.unit,
          detailSchemaVersion === 5
            ? ["one_change", "bundle", "factorial"] as const
            : ["one_change", "bundle"] as const,
          `${path}.variationRule.unit`,
        ),
        treatment: string(variationRuleRow.treatment, `${path}.variationRule.treatment`),
        heldConstant: strings(variationRuleRow.heldConstant, `${path}.variationRule.heldConstant`),
        allowedDifferences: strings(variationRuleRow.allowedDifferences, `${path}.variationRule.allowedDifferences`),
        exclusionCriteria: strings(variationRuleRow.exclusionCriteria, `${path}.variationRule.exclusionCriteria`),
      };
      const literature = array(item.literature, `${path}.literature`).map((literatureEntry, literatureIndex) => {
        const literaturePath = `${path}.literature[${literatureIndex}]`;
        const literatureRow = exactRecord(
          literatureEntry,
          ["sourceRef", "citation", "url", "relevance"],
          literaturePath,
        );
        const url = string(literatureRow.url, `${literaturePath}.url`);
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          fail(`${literaturePath}.url`, "must be an absolute URL");
        }
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
          fail(`${literaturePath}.url`, "must use HTTP or HTTPS");
        }
        return {
          sourceRef: string(literatureRow.sourceRef, `${literaturePath}.sourceRef`),
          citation: string(literatureRow.citation, `${literaturePath}.citation`),
          url,
          relevance: string(literatureRow.relevance, `${literaturePath}.relevance`),
        };
      });
      uniqueBy(literature, (reference) => reference.sourceRef, `${path}.literature`);
      const researchRuns = array(item.researchRuns, `${path}.researchRuns`).map((runEntry, runIndex) => {
        const runPath = `${path}.researchRuns[${runIndex}]`;
        const runCandidate = runEntry !== null && typeof runEntry === "object" && !Array.isArray(runEntry)
          ? runEntry as Record<string, unknown>
          : null;
        const hasRunResult = detailSchemaVersion >= 4
          && runCandidate !== null
          && Object.hasOwn(runCandidate, "result");
        const hasFactorialResult = detailSchemaVersion === 5
          && runCandidate !== null
          && Object.hasOwn(runCandidate, "factorialResult");
        const runRow = exactRecord(runEntry, [
          "runId", "kind", "status", "protocol", "runArtifact", "armArtifacts", "executor", "independenceKey", "notes",
          ...(hasRunResult ? ["result"] : []),
          ...(hasFactorialResult ? ["factorialResult"] : []),
        ], runPath);
        const armArtifactsRow = exactRecord(
          runRow.armArtifacts,
          ["control", "treatment"],
          `${runPath}.armArtifacts`,
        );
        const runKind = member(
          runRow.kind,
          detailSchemaVersion === 5
            ? ["ablation", "reproduction", "factorial"] as const
            : ["ablation", "reproduction"] as const,
          `${runPath}.kind`,
        );
        const run = {
          runId: string(runRow.runId, `${runPath}.runId`),
          kind: runKind,
          status: member(
            runRow.status,
            ["planned", "running", "completed", "failed"] as const,
            `${runPath}.status`,
          ),
          protocol: parseArtifactPin(runRow.protocol, `${runPath}.protocol`),
          runArtifact: parseArtifactPin(runRow.runArtifact, `${runPath}.runArtifact`),
          armArtifacts: {
            control: parseArtifactPin(armArtifactsRow.control, `${runPath}.armArtifacts.control`),
            treatment: parseArtifactPin(armArtifactsRow.treatment, `${runPath}.armArtifacts.treatment`),
          },
          executor: nullableString(runRow.executor, `${runPath}.executor`),
          independenceKey: nullableString(runRow.independenceKey, `${runPath}.independenceKey`),
          notes: string(runRow.notes, `${runPath}.notes`),
          result: hasRunResult ? parseControlledResult(runRow.result, `${runPath}.result`) : null,
          factorialResult: hasFactorialResult
            ? parseFactorialResult(runRow.factorialResult, `${runPath}.factorialResult`, experiment, release)
            : null,
        };
        if (run.status === "completed"
          && (run.protocol === null || run.runArtifact === null || run.executor === null || run.independenceKey === null)) {
          fail(runPath, "completed runs require pinned protocol, artifact, executor, and independence key");
        }
        if (run.result !== null && (
          run.status !== "completed"
          || run.result.schemaVersion !== 2
          || run.result.packetAdmission.admitted
        )) {
          fail(runPath, "run results are reserved for completed, non-admitted v2 packets");
        }
        if (run.kind === "factorial") {
          if (run.status !== "completed"
            || run.factorialResult === null
            || run.armArtifacts.control !== null
            || run.armArtifacts.treatment !== null) {
            fail(runPath, "factorial runs must be completed, include factorialResult, and leave pair arms null");
          }
          if (run.runArtifact === null) {
            fail(`${runPath}.runArtifact`, "factorial runs must pin the result packet");
          }
        } else if (run.factorialResult !== null) {
          fail(`${runPath}.factorialResult`, "is reserved for factorial runs");
        }
        return run;
      });
      const runById = uniqueBy(researchRuns, (run) => run.runId, `${path}.researchRuns`);
      const researchArtifactById = new Map<string, { sha256: string; runId: string; role: string }>();
      for (const run of researchRuns) {
        for (const [role, artifact] of [
          ["run", run.runArtifact],
          ["control", run.armArtifacts.control],
          ["treatment", run.armArtifacts.treatment],
        ] as const) {
          if (artifact === null) continue;
          if (researchArtifactById.has(artifact.artifactId)) {
            fail(`${path}.researchRuns`, `repeats research artifact ${artifact.artifactId}`);
          }
          researchArtifactById.set(artifact.artifactId, { sha256: artifact.sha256, runId: run.runId, role });
        }
        for (const cell of run.factorialResult?.cells ?? []) {
          if (researchArtifactById.has(cell.artifact.artifactId)) {
            fail(`${path}.researchRuns`, `repeats research artifact ${cell.artifact.artifactId}`);
          }
          researchArtifactById.set(cell.artifact.artifactId, {
            sha256: cell.artifact.sha256,
            runId: run.runId,
            role: `factorial:${cell.cellId}`,
          });
        }
      }
      const expectedResearchArtifactIds = new Set(experiment.variationMemberships
        .filter((membership) => membership.variationRef.kind === "research_artifact")
        .map((membership) => membership.variationRef.id));
      if (expectedResearchArtifactIds.size !== researchArtifactById.size
        || [...expectedResearchArtifactIds].some((artifactId) => !researchArtifactById.has(artifactId))) {
        fail(`${path}.researchRuns`, "must exactly cover the experiment's research-artifact variations");
      }
      const controlledComparisons = array(item.controlledComparisons, `${path}.controlledComparisons`)
        .map((comparisonEntry, comparisonIndex) => {
          const comparisonPath = `${path}.controlledComparisons[${comparisonIndex}]`;
          const comparisonRow = exactRecord(comparisonEntry, [
            "comparisonId", "treatmentVariationId", "sourceParentArtifactId", "officialComparatorAttemptId",
            "matchedControlArtifactId", "recordedDelta", "officialControlDelta", "pairedDeltas", "evidenceLevel",
            "researchRunIds", "interpretation",
            ...(detailSchemaVersion >= 4 ? ["result"] : []),
          ], comparisonPath);
          const treatmentVariationId = string(
            comparisonRow.treatmentVariationId,
            `${comparisonPath}.treatmentVariationId`,
          );
          const treatmentMembership = experiment.variationMemberships.find(
            (membership) => membership.variationRef.id === treatmentVariationId,
          );
          if (treatmentMembership === undefined) {
            fail(`${comparisonPath}.treatmentVariationId`, "must name a member variation");
          }
          const pairedDeltas = comparisonRow.pairedDeltas === null ? null : array(
            comparisonRow.pairedDeltas,
            `${comparisonPath}.pairedDeltas`,
          ).map((pairedEntry, pairedIndex) => {
            const pairedPath = `${comparisonPath}.pairedDeltas[${pairedIndex}]`;
            const pairedRow = exactRecord(
              pairedEntry,
              ["pairId", "treatmentDelta", "controlDelta"],
              pairedPath,
            );
            return {
              pairId: string(pairedRow.pairId, `${pairedPath}.pairId`),
              treatmentDelta: finite(pairedRow.treatmentDelta, `${pairedPath}.treatmentDelta`),
              controlDelta: finite(pairedRow.controlDelta, `${pairedPath}.controlDelta`),
            };
          });
          if (pairedDeltas !== null) uniqueBy(pairedDeltas, (delta) => delta.pairId, `${comparisonPath}.pairedDeltas`);
          const researchRunIds = strings(comparisonRow.researchRunIds, `${comparisonPath}.researchRunIds`);
          for (const runId of researchRunIds) {
            if (!runById.has(runId)) fail(`${comparisonPath}.researchRunIds`, `names unknown research run ${runId}`);
          }
          const evidenceLevel = member(
            comparisonRow.evidenceLevel,
            EXPERIMENT_EVIDENCE,
            `${comparisonPath}.evidenceLevel`,
          ) as AtlasExperimentEvidenceLevel;
          const sourceParentArtifactId = nullableString(
            comparisonRow.sourceParentArtifactId,
            `${comparisonPath}.sourceParentArtifactId`,
          );
          const matchedControlArtifactId = nullableString(
            comparisonRow.matchedControlArtifactId,
            `${comparisonPath}.matchedControlArtifactId`,
          );
          const officialComparatorAttemptId = nullableString(
            comparisonRow.officialComparatorAttemptId,
            `${comparisonPath}.officialComparatorAttemptId`,
          );
          const recordedDelta = nullableFinite(comparisonRow.recordedDelta, `${comparisonPath}.recordedDelta`);
          const officialControlDelta = nullableFinite(
            comparisonRow.officialControlDelta,
            `${comparisonPath}.officialControlDelta`,
          );
          const result = detailSchemaVersion >= 4
            ? parseControlledResult(comparisonRow.result, `${comparisonPath}.result`)
            : null;
          if (result !== null) {
            const pairedDeltaIds = pairedDeltas?.map((delta) => delta.pairId) ?? [];
            const pairedScopeIds = result.pairedScopes.map((scope) => scope.scopeId);
            if (pairedDeltaIds.length !== pairedScopeIds.length
              || pairedDeltaIds.some((pairId) => !pairedScopeIds.includes(pairId))) {
              fail(
                `${comparisonPath}.result.pairedScopes`,
                "must cover the recorded paired delta scopes exactly once",
              );
            }
          }
          if (officialComparatorAttemptId !== null) {
            if (treatmentMembership.variationRef.kind !== "submission") {
              fail(`${comparisonPath}.officialComparatorAttemptId`, "requires a submission treatment variation");
            }
            const treatment = release.submissionById.get(treatmentVariationId)!;
            const comparator = release.submissionById.get(officialComparatorAttemptId);
            if (comparator === undefined) {
              fail(`${comparisonPath}.officialComparatorAttemptId`, "must name an included submission");
            }
            const expectedRecordedDelta = treatment.score === null || comparator.score === null
              ? null
              : treatment.score - comparator.score;
            if ((expectedRecordedDelta === null) !== (recordedDelta === null)
              || (expectedRecordedDelta !== null
                && recordedDelta !== null
                && !approximatelyEqual(expectedRecordedDelta, recordedDelta))) {
              fail(`${comparisonPath}.recordedDelta`, "must match treatment minus the named official comparator");
            }
          } else if (recordedDelta !== null) {
            fail(`${comparisonPath}.recordedDelta`, "requires a named official comparator");
          }
          if (sourceParentArtifactId !== null
            && !release.submissionById.has(sourceParentArtifactId)
            && !researchArtifactById.has(sourceParentArtifactId)) {
            fail(`${comparisonPath}.sourceParentArtifactId`, "must name an included submission or research artifact");
          }
          if (matchedControlArtifactId !== null
            && !release.submissionById.has(matchedControlArtifactId)
            && !researchArtifactById.has(matchedControlArtifactId)) {
            fail(`${comparisonPath}.matchedControlArtifactId`, "must name an included submission or research artifact");
          }
          if (matchedControlArtifactId !== null && new Set([
            treatmentVariationId,
            sourceParentArtifactId,
            officialComparatorAttemptId,
          ]).has(matchedControlArtifactId)) {
            fail(`${comparisonPath}.matchedControlArtifactId`, "must be distinct from treatment, parent, and comparator");
          }
          if (matchedControlArtifactId === null
            && (officialControlDelta !== null || pairedDeltas !== null)) {
            fail(comparisonPath, "control and paired deltas require a matched experimental control");
          }
          if (evidenceLevel === "historical_observation"
            && (matchedControlArtifactId !== null || officialControlDelta !== null || pairedDeltas !== null)) {
            fail(comparisonPath, "historical observations cannot claim experimental-control deltas");
          }
          if (evidenceLevel === "historical_observation"
            && treatmentMembership.variationRef.kind !== "submission") {
            fail(comparisonPath, "historical comparisons require a canonical Yukon submission");
          }
          const completedRuns = researchRunIds
            .map((runId) => runById.get(runId)!)
            .filter((run) => run.status === "completed");
          const completedAblations = completedRuns.filter((run) => run.kind === "ablation");
          const completedReproductions = completedRuns.filter((run) => run.kind === "reproduction");
          const completedArmRun = completedRuns.find((run) => (
            run.armArtifacts.treatment?.artifactId === treatmentVariationId
            && run.armArtifacts.control?.artifactId === matchedControlArtifactId
            && run.armArtifacts.treatment.sha256 !== run.armArtifacts.control.sha256
          ));
          if (EXPERIMENT_EVIDENCE_RANK[evidenceLevel] >= EXPERIMENT_EVIDENCE_RANK.matched_control
            && (matchedControlArtifactId === null
              || pairedDeltas === null
              || pairedDeltas.length === 0
              || completedArmRun === undefined)) {
            fail(comparisonPath, "matched-control evidence requires distinct pinned run arms and paired deltas");
          }
          if (EXPERIMENT_EVIDENCE_RANK[evidenceLevel] >= EXPERIMENT_EVIDENCE_RANK.one_change_ablation
            && (variationRule.unit !== "one_change" || completedAblations.length === 0)) {
            fail(comparisonPath, "one-change evidence requires a completed ablation run");
          }
          if (EXPERIMENT_EVIDENCE_RANK[evidenceLevel] >= EXPERIMENT_EVIDENCE_RANK.reproduced
            && completedReproductions.length === 0) {
            fail(comparisonPath, "reproduced evidence requires a completed reproduction run");
          }
          if (evidenceLevel === "replicated") {
            const independenceKeys = new Set(completedReproductions.map((run) => run.independenceKey));
            if (completedReproductions.length < 2 || independenceKeys.size < 2) {
              fail(comparisonPath, "replicated evidence requires two independent completed reproductions");
            }
          }
          if (result !== null
            && result.officialObservation.qualification.control.status === "passed"
            && result.officialObservation.qualification.treatment.status === "passed"
            && officialControlDelta !== null) {
            const officialResultDelta = result.officialObservation.qualification.treatment.score!
              - result.officialObservation.qualification.control.score!;
            if (!approximatelyEqual(officialControlDelta, officialResultDelta)) {
              fail(
                `${comparisonPath}.officialControlDelta`,
                "must match the absolute official arm scores",
              );
            }
          }
          if (result !== null
            && result.officialObservation.benchmarkEffect.status === "estimated"
            && officialControlDelta !== null
            && !approximatelyEqual(officialControlDelta, result.officialObservation.benchmarkEffect.delta)) {
            fail(
              `${comparisonPath}.result.officialObservation.benchmarkEffect.delta`,
              "must match the recorded official matched-control delta",
            );
          }
          if (result !== null && pairedDeltas !== null) {
            const pairedDeltaById = uniqueBy(pairedDeltas, (delta) => delta.pairId, `${comparisonPath}.pairedDeltas`);
            for (const scope of result.pairedScopes) {
              const recordedPair = pairedDeltaById.get(scope.scopeId);
              if (recordedPair === undefined) {
                fail(`${comparisonPath}.result.pairedScopes`, "must cover the recorded paired delta scopes exactly once");
              }
              const scopeExpectedDelta = recordedPair.treatmentDelta - recordedPair.controlDelta;
              if (scope.benchmarkEffect.status !== "unavailable"
                && !approximatelyEqual(scope.benchmarkEffect.delta, scopeExpectedDelta)) {
                fail(
                  `${comparisonPath}.result.pairedScopes[${JSON.stringify(scope.scopeId)}].benchmarkEffect.delta`,
                  "must match the recorded paired workload delta",
                );
              }
              if (scope.benchmarkEffect.status === "admitted") {
                if (EXPERIMENT_EVIDENCE_RANK[evidenceLevel] < EXPERIMENT_EVIDENCE_RANK.matched_control
                  || matchedControlArtifactId === null
                  || pairedDeltas.length === 0
                  || completedArmRun === undefined) {
                  fail(
                    `${comparisonPath}.result.pairedScopes[${JSON.stringify(scope.scopeId)}].benchmarkEffect`,
                    "requires the existing matched-control evidence gates",
                  );
                }
                const allScopesPassed = result.pairedScopes.every((pairedScope) => (
                  pairedScope.controlStatus === "passed" && pairedScope.treatmentStatus === "passed"
                ));
                if (!allScopesPassed) {
                  fail(
                    `${comparisonPath}.result.pairedScopes[${JSON.stringify(scope.scopeId)}].benchmarkEffect`,
                    "cannot be admitted unless every paired scope passes",
                  );
                }
              }
            }
          }
          return {
            comparisonId: string(comparisonRow.comparisonId, `${comparisonPath}.comparisonId`),
            treatmentVariationId,
            sourceParentArtifactId,
            officialComparatorAttemptId,
            matchedControlArtifactId,
            recordedDelta,
            officialControlDelta,
            pairedDeltas,
            evidenceLevel,
            researchRunIds,
            interpretation: string(comparisonRow.interpretation, `${comparisonPath}.interpretation`),
            result,
          };
        });
      uniqueBy(controlledComparisons, (comparison) => comparison.comparisonId, `${path}.controlledComparisons`);
      const factorialEvidence = researchRuns.some((run) => (
        run.kind === "factorial"
        && run.status === "completed"
        && run.protocol !== null
        && run.runArtifact !== null
        && run.executor !== null
        && run.independenceKey !== null
        && run.factorialResult !== null
      ))
        ? "matched_control" as const
        : "historical_observation" as const;
      const maximumEvidence = controlledComparisons.reduce<AtlasExperimentEvidenceLevel>(
        (current, comparison) => EXPERIMENT_EVIDENCE_RANK[comparison.evidenceLevel] > EXPERIMENT_EVIDENCE_RANK[current]
          ? comparison.evidenceLevel
          : current,
        factorialEvidence,
      );
      if (maximumEvidence !== experiment.evidenceLevel) {
        fail(`${path}.controlledComparisons`, "must justify the experiment summary evidence level");
      }
      return {
        experimentId,
        framing: { retrospective, prospective },
        variationRule,
        literature,
        controlledComparisons,
        researchRuns,
      };
    });
  const experimentById = uniqueBy(experiments, (experiment) => experiment.experimentId, "experiment-detail.experiments");
  const expected = release.experiments.experiments.filter((experiment) => experiment.detailShard === descriptor.path);
  if (experimentById.size !== expected.length || expected.some((experiment) => !experimentById.has(experiment.id))) {
    fail("experiment-detail.experiments", "must cover its routed experiments exactly once");
  }
  return { shard, experimentById };
}

export type {
  AtlasDirection,
  AtlasRelease,
  AtlasReleaseManifest,
  AtlasReleasePointer,
  AtlasRoleDescriptor,
  AtlasSubmissionDetailRole,
};
