import { observedMutationsForIdea } from "./decomposition-evidence";
import type {
  AtlasConstraintAssessment,
  AtlasConstraintAssessmentEvidence,
  AtlasDecompositionRole,
  AtlasDecompositionReviewStatus,
  AtlasChangePhase,
  AtlasExperimentEvidenceLevel,
  AtlasExperimentDetail,
  AtlasExperimentEvaluationStatus,
  AtlasExperimentFramingProvenance,
  AtlasExperimentFactorialCellValues,
  AtlasExperimentFactorialEffect,
  AtlasExperimentFactorialResultV1,
  AtlasExperimentFactorialSimpleEffect,
  AtlasExperimentBenchmarkEffect,
  AtlasExperimentEstimatedEffect,
  AtlasExperimentStatus,
  AtlasIdeaDossierCoverage,
  AtlasIdeaVariationGroup,
  AtlasMutationRelation,
  AtlasMutationWitnessReviewDisposition,
  AtlasRelease,
  AtlasReleaseManifestV5,
  AtlasResearchArea,
  AtlasResearchConstraint,
  AtlasResearchIdea,
  AtlasRoleDescriptor,
  AtlasSubmissionClassification,
  AtlasSubmissionInterpretation,
  AtlasSubmissionStatus,
  AtlasSubmissionTerminalReason,
} from "./types";

const ATTEMPT_STATUSES = ["promoted", "rejected", "failed", "promotion failed"] as const;
const ATTEMPT_STATUS_FILTERS = ["all", "promoted", "rejected", "failed", "promotion_failed"] as const;
const DEFAULT_ATTEMPT_LIMIT = 25;
const MAX_ATTEMPT_LIMIT = 100;

export type AtlasIdeaAttemptStatusFilter =
  | "all"
  | "promoted"
  | "rejected"
  | "failed"
  | "promotion_failed";

export interface AtlasIdeaAttemptListOptions {
  status?: AtlasIdeaAttemptStatusFilter;
  limit?: number;
  cursor?: string;
}

export interface AtlasIdeaEvidenceReleaseV1 {
  pointerId: string;
  releaseId: string;
  manifestSha256: string;
  benchmarkId: string | null;
  source: {
    exportId: string | null;
    researchMapSha256: string;
    researchDecompositionRegistrySha256: string;
    constraintAssessmentRegistrySha256: string | null;
  };
  roles: {
    ideas: AtlasRoleDescriptor;
    submissions: AtlasRoleDescriptor;
    decomposition: AtlasRoleDescriptor;
    experiments?: AtlasRoleDescriptor;
  };
}

export interface AtlasIdeaEvidencePathItemV1 {
  kind: "area" | "constraint" | "idea";
  id: string;
  label: string;
  summary: string;
}

export interface AtlasIdeaEvidencePlacementV1 {
  linkId: string;
  constraintId: string;
  constraintLabel: string;
  constraintSummary: string;
  owner: { kind: "area" | "idea"; id: string; label: string };
  primary: boolean;
  reviewStatus: AtlasDecompositionReviewStatus;
  evidenceRefs: string[];
}

export interface AtlasIdeaEvidenceOutcomeCountsV1 {
  submissions: number;
  promoted: number;
  rejected: number;
  failed: number;
  promotionFailed: number;
}

export interface AtlasIdeaEvidenceApproachV1 {
  ideaId: string;
  title: string;
  summary: string;
  dossierCounts: { submissions: number; promoted: number; solvers: number };
  recordedSubmissionOutcomes: AtlasIdeaEvidenceOutcomeCountsV1;
}

export type AtlasIdeaEvidenceQualificationCode =
  | AtlasSubmissionInterpretation
  | "bundled_changes"
  | "policy_coupled"
  | "unresolved_mapping";

export interface AtlasIdeaAttemptV1 {
  submissionId: string;
  changeId: string;
  createdAt: string | null;
  solverId: string;
  result: {
    status: AtlasSubmissionStatus;
    classification: AtlasSubmissionClassification | null;
    score: number | null;
    scoreComparatorScore: number | null;
    rawDelta: number | null;
    directionalGain: number | null;
    scoreComparatorId: string | null;
    scoreComparatorHops: number | null;
  };
  change: {
    title: string;
    description: string;
    phase: AtlasChangePhase;
    site: string;
    relation: AtlasMutationRelation;
    mappingIdeaId: string | null;
  };
  witness: {
    ideaIds: string[];
    constraintIds: string[];
    reviewDisposition: AtlasMutationWitnessReviewDisposition | null;
    reviewNote: string | null;
  };
  route: {
    mutationWitnessIds: string[];
    ideaIds: string[];
    constraintIds: string[];
    interpretation: AtlasSubmissionInterpretation;
    policyCoupled: boolean;
    hasUnresolved: boolean;
    terminalReason: AtlasSubmissionTerminalReason | null;
  };
  qualification: {
    codes: AtlasIdeaEvidenceQualificationCode[];
    bundledChangeCount: number;
    coIdeaIds: string[];
  };
  evidence: {
    detailShard: string;
    descriptor: AtlasRoleDescriptor;
  };
}

export interface AtlasIdeaEvidenceChildConstraintV1 {
  constraintId: string;
  label: string;
  summary: string;
  reviewStatus: AtlasDecompositionReviewStatus;
  evidenceRefs: string[];
  assessment: AtlasConstraintAssessment | null;
  assessmentEvidence: AtlasConstraintAssessmentEvidence[];
  linkedIdeas: Array<{
    linkId: string;
    ideaId: string;
    title: string;
    summary: string;
    primary: boolean;
    reviewStatus: AtlasDecompositionReviewStatus;
    evidenceRefs: string[];
  }>;
}

export interface AtlasIdeaVerificationStudyV1 {
  experimentId: string;
  appliesToIdeaIds: string[];
  title: string;
  question: string;
  intervention: string;
  status: AtlasExperimentStatus;
  evidenceLevel: AtlasExperimentEvidenceLevel;
  framingProvenance: AtlasExperimentFramingProvenance;
  aggregate: {
    variations: number;
    focused: number;
    bundled: number;
    solvers: number;
    promoted: number;
    failed: number;
  };
  detailRef: {
    path: string;
    sha256: string;
  };
  runs: AtlasIdeaVerificationRunV1[];
}

export interface AtlasIdeaVerificationCorrectnessV1 {
  shotCount: number;
  controlFailures: number;
  treatmentFailures: number;
  riskDifferenceTreatmentMinusControl: number;
  exactTwoSidedMcNemarPValue: number;
}

export interface AtlasIdeaVerificationRunV1 {
  runId: string;
  kind: "ablation" | "reproduction" | "factorial";
  status: "planned" | "running" | "completed" | "failed";
  executor: string | null;
  independenceKey: string | null;
  recordedCausalQualification: string | null;
  packetAdmission: { admitted: boolean; issues: string[] } | null;
  officialObservation: {
    control: { status: AtlasExperimentEvaluationStatus; score: number | null };
    treatment: { status: AtlasExperimentEvaluationStatus; score: number | null };
    effect: AtlasExperimentEstimatedEffect;
  } | null;
  pairedScopes: Array<{
    scopeId: string;
    controlStatus: AtlasExperimentEvaluationStatus;
    treatmentStatus: AtlasExperimentEvaluationStatus;
    effect: AtlasExperimentBenchmarkEffect;
    correctness: AtlasIdeaVerificationCorrectnessV1 | null;
  }>;
  pooledCorrectness: AtlasIdeaVerificationCorrectnessV1 | null;
  factorial: AtlasIdeaVerificationFactorialV1 | null;
}

export interface AtlasIdeaVerificationFactorialV1 {
  sourceSubmissionId: string;
  selectedFactorIds: string[];
  packetAdmission: { admitted: boolean; issues: string[] };
  omittedAdmissionIssues: number;
  factors: Array<{
    factorId: string;
    ideaId: string;
    label: string;
    offLabel: string;
    onLabel: string;
  }>;
  scopes: Array<{
    scopeId: string;
    shotCount: number;
    cellStatuses: Array<{ cellId: string; status: AtlasExperimentEvaluationStatus }>;
    correctness: Array<{
      dimension: string;
      cellFailures: AtlasExperimentFactorialCellValues;
      conditionalEffects: AtlasExperimentFactorialSimpleEffect[];
      interactionRiskDifference: number;
    }>;
    resources: Array<{
      metric: string;
      unit: string;
      conditionalEffects: AtlasExperimentFactorialSimpleEffect[];
      interaction: AtlasExperimentFactorialEffect;
    }>;
    benchmarkInteraction: { status: "admitted"; delta: number } | { status: "unavailable"; reason: string };
    omittedCorrectnessDimensions: number;
    omittedResourceMetrics: number;
  }>;
  limitations: string[];
  omittedScopes: number;
  omittedLimitations: number;
}

export interface AtlasIdeaEvidenceBriefV1 {
  schema: "yukon.atlas-idea-evidence-brief";
  schemaVersion: 1;
  release: AtlasIdeaEvidenceReleaseV1;
  idea: {
    ideaId: string;
    title: string;
    summary: string;
    source: AtlasResearchIdea["source"];
    reviewStatus: AtlasDecompositionReviewStatus;
    evidenceRefs: string[];
  };
  primaryPath: AtlasIdeaEvidencePathItemV1[];
  placements: AtlasIdeaEvidencePlacementV1[];
  coverage: AtlasIdeaDossierCoverage;
  approaches: AtlasIdeaEvidenceApproachV1[];
  variationGroups: AtlasIdeaVariationGroup[];
  outcomeExamples: AtlasIdeaAttemptV1[];
  verificationStudies: AtlasIdeaVerificationStudyV1[];
  childConstraints: AtlasIdeaEvidenceChildConstraintV1[];
  verification: "requires_verification";
  caveats: string[];
}

export interface AtlasIdeaAttemptPageV1 {
  schema: "yukon.atlas-idea-attempt-page";
  schemaVersion: 1;
  release: AtlasIdeaEvidenceReleaseV1;
  idea: { ideaId: string; title: string };
  filter: { status: AtlasIdeaAttemptStatusFilter };
  items: AtlasIdeaAttemptV1[];
  page: { limit: number; nextCursor: string | null; total: number };
}

export interface AtlasAttemptSearchOptions {
  limit?: number;
}

export interface AtlasAttemptSearchMappedNodeV1 {
  id: string;
  label: string;
  summary: string;
}

export interface AtlasAttemptSearchHitV1 extends AtlasIdeaAttemptV1 {
  rank: number;
  mappedIdeas: AtlasAttemptSearchMappedNodeV1[];
  mappedConstraints: AtlasAttemptSearchMappedNodeV1[];
}

export interface AtlasAttemptSearchV1 {
  schema: "yukon.atlas-attempt-search";
  schemaVersion: 1;
  release: AtlasIdeaEvidenceReleaseV1;
  query: { text: string; tokens: string[] };
  items: AtlasAttemptSearchHitV1[];
  coverage: {
    searchedChanges: number;
    matchedChanges: number;
  };
  page: {
    limit: number;
    total: number;
  };
}

export type AtlasIdeaEvidenceBriefErrorCode =
  | "unsupported_release"
  | "missing_overlay"
  | "invalid_reference"
  | "invalid_query"
  | "idea_not_found"
  | "ambiguous_idea"
  | "invalid_cursor"
  | "invalid_limit";

export class AtlasIdeaEvidenceBriefError extends Error {
  readonly code: AtlasIdeaEvidenceBriefErrorCode;
  readonly candidates: Array<{ ideaId: string; title: string }>;

  constructor(
    code: AtlasIdeaEvidenceBriefErrorCode,
    message: string,
    candidates: Array<{ ideaId: string; title: string }> = [],
  ) {
    super(message);
    this.name = "AtlasIdeaEvidenceBriefError";
    this.code = code;
    this.candidates = candidates;
  }
}

type RequiredAtlasV5Release = AtlasRelease & {
  manifest: AtlasReleaseManifestV5;
  decomposition: AtlasDecompositionRole;
  areaById: ReadonlyMap<string, AtlasResearchArea>;
  constraintById: ReadonlyMap<string, AtlasResearchConstraint>;
  decompositionIdeaById: ReadonlyMap<string, AtlasResearchIdea>;
  constraintsByOwnerKey: ReadonlyMap<string, readonly AtlasResearchConstraint[]>;
  linksByConstraintId: NonNullable<AtlasRelease["linksByConstraintId"]>;
  linksByIdeaId: NonNullable<AtlasRelease["linksByIdeaId"]>;
  primaryPathByIdeaId: NonNullable<AtlasRelease["primaryPathByIdeaId"]>;
  dossierByIdeaId: NonNullable<AtlasRelease["dossierByIdeaId"]>;
  constraintAssessmentById: NonNullable<AtlasRelease["constraintAssessmentById"]>;
  constraintAssessmentEvidenceById: NonNullable<AtlasRelease["constraintAssessmentEvidenceById"]>;
  mutationWitnessesByIdeaId: NonNullable<AtlasRelease["mutationWitnessesByIdeaId"]>;
  submissionRouteById: NonNullable<AtlasRelease["submissionRouteById"]>;
};

type RequiredAtlasAttemptSearchRelease = RequiredAtlasV5Release & {
  mutationWitnessById: NonNullable<AtlasRelease["mutationWitnessById"]>;
};

function requireV5Release(release: AtlasRelease): asserts release is RequiredAtlasV5Release {
  if (release.manifest.schemaVersion !== 5 || release.decomposition?.schemaVersion !== 5) {
    throw new AtlasIdeaEvidenceBriefError(
      "unsupported_release",
      "Atlas idea summaries require an Atlas v5 release.",
    );
  }
  const missing = [
    ["corpus coverage", release.decomposition.corpus],
    ["Idea dossier overlay", release.decomposition.dossiers],
    ["mutation witness overlay", release.decomposition.mutationWitnesses],
    ["submission route overlay", release.decomposition.submissionRoutes],
    ["area index", release.areaById],
    ["constraint index", release.constraintById],
    ["Idea index", release.decompositionIdeaById],
    ["owner-to-constraint index", release.constraintsByOwnerKey],
    ["constraint-to-Idea links", release.linksByConstraintId],
    ["Idea-to-constraint links", release.linksByIdeaId],
    ["primary paths", release.primaryPathByIdeaId],
    ["Idea dossiers", release.dossierByIdeaId],
    ["constraint assessments", release.constraintAssessmentById],
    ["constraint assessment evidence", release.constraintAssessmentEvidenceById],
    ["mutation witnesses", release.mutationWitnessesByIdeaId],
    ["submission routes", release.submissionRouteById],
  ].filter(([, value]) => value === undefined).map(([label]) => label);
  if (missing.length > 0) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Atlas v5 idea summaries require this loaded data: ${missing.join(", ")}.`,
    );
  }
}

function requireAttemptSearchRelease(
  release: AtlasRelease,
): asserts release is RequiredAtlasAttemptSearchRelease {
  requireV5Release(release);
  if (release.mutationWitnessById === undefined) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      "Atlas attempt search requires the loaded mutation witness index.",
    );
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedCandidates(ideas: readonly AtlasResearchIdea[]): Array<{ ideaId: string; title: string }> {
  return ideas.map(({ ideaId, title }) => ({ ideaId, title }))
    .sort((left, right) => compareText(left.title, right.title) || compareText(left.ideaId, right.ideaId));
}

export function resolveAtlasIdea(release: AtlasRelease, reference: string): AtlasResearchIdea {
  requireV5Release(release);
  const value = reference.trim();
  if (value.length === 0) {
    throw new AtlasIdeaEvidenceBriefError("invalid_reference", "Idea reference cannot be empty.");
  }
  const exact = release.decompositionIdeaById.get(value);
  if (exact !== undefined) return exact;
  const normalized = value.toLowerCase();
  const exactTextMatches = [...release.decompositionIdeaById.values()].filter((idea) => (
    idea.ideaId.toLowerCase() === normalized || idea.title.toLowerCase() === normalized
  ));
  if (exactTextMatches.length === 1) return exactTextMatches[0]!;
  if (exactTextMatches.length > 1) {
    const candidates = sortedCandidates(exactTextMatches);
    throw new AtlasIdeaEvidenceBriefError(
      "ambiguous_idea",
      `Idea reference ${JSON.stringify(reference)} is ambiguous: ${candidates.map(({ ideaId }) => ideaId).join(", ")}.`,
      candidates,
    );
  }
  const prefixMatches = [...release.decompositionIdeaById.values()].filter((idea) => (
    idea.ideaId.toLowerCase().startsWith(normalized)
  ));
  if (prefixMatches.length === 1) return prefixMatches[0]!;
  if (prefixMatches.length > 1) {
    const candidates = sortedCandidates(prefixMatches);
    throw new AtlasIdeaEvidenceBriefError(
      "ambiguous_idea",
      `Idea prefix ${JSON.stringify(reference)} is ambiguous: ${candidates.map(({ ideaId }) => ideaId).join(", ")}.`,
      candidates,
    );
  }
  throw new AtlasIdeaEvidenceBriefError(
    "idea_not_found",
    `No Atlas Idea matches ${JSON.stringify(reference)}.`,
  );
}

function releaseProvenance(release: RequiredAtlasV5Release): AtlasIdeaEvidenceReleaseV1 {
  return {
    pointerId: release.pointer.id,
    releaseId: release.manifest.releaseId,
    manifestSha256: release.pointer.manifestSha256,
    benchmarkId: release.manifest.benchmark.id,
    source: {
      exportId: release.manifest.source.exportId,
      researchMapSha256: release.manifest.source.researchMapSha256,
      researchDecompositionRegistrySha256: release.manifest.source.researchDecompositionRegistrySha256,
      constraintAssessmentRegistrySha256:
        release.manifest.source.constraintAssessmentRegistrySha256 ?? null,
    },
    roles: {
      ideas: release.manifest.roles.ideas,
      submissions: release.manifest.roles.submissions,
      decomposition: release.manifest.roles.decomposition,
      ...(release.manifest.roles.experiments === undefined ? {} : { experiments: release.manifest.roles.experiments }),
    },
  };
}

function pathItem(release: RequiredAtlasV5Release, id: string): AtlasIdeaEvidencePathItemV1 {
  const area = release.areaById.get(id);
  if (area !== undefined) return { kind: "area", id, label: area.title, summary: area.summary };
  const constraint = release.constraintById.get(id);
  if (constraint !== undefined) {
    return { kind: "constraint", id, label: constraint.label, summary: constraint.summary };
  }
  const idea = release.decompositionIdeaById.get(id);
  if (idea !== undefined) return { kind: "idea", id, label: idea.title, summary: idea.summary };
  throw new AtlasIdeaEvidenceBriefError(
    "missing_overlay",
    `Primary path for an Atlas Idea references missing node ${JSON.stringify(id)}.`,
  );
}

function ownerLabel(
  release: RequiredAtlasV5Release,
  owner: AtlasResearchConstraint["owner"],
): string {
  const node = owner.kind === "area"
    ? release.areaById.get(owner.id)
    : release.decompositionIdeaById.get(owner.id);
  if (node === undefined) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Constraint owner ${JSON.stringify(owner.id)} is missing from the Atlas v5 indexes.`,
    );
  }
  return node.title;
}

function statusForFilter(filter: AtlasIdeaAttemptStatusFilter): AtlasSubmissionStatus | null {
  if (filter === "all") return null;
  return filter === "promotion_failed" ? "promotion failed" : filter;
}

function qualificationCodes(
  interpretation: AtlasSubmissionInterpretation,
  bundledChangeCount: number,
  policyCoupled: boolean,
  hasUnresolved: boolean,
): AtlasIdeaEvidenceQualificationCode[] {
  return [
    interpretation,
    ...(bundledChangeCount > 1 ? ["bundled_changes" as const] : []),
    ...(policyCoupled ? ["policy_coupled" as const] : []),
    ...(hasUnresolved ? ["unresolved_mapping" as const] : []),
  ];
}

function attemptDescriptor(
  release: RequiredAtlasV5Release,
  submissionId: string,
  detailShard: string,
): AtlasRoleDescriptor {
  const descriptor = release.detailDescriptorByPath.get(detailShard);
  if (descriptor === undefined) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Submission ${JSON.stringify(submissionId)} references missing detail shard ${JSON.stringify(detailShard)}.`,
    );
  }
  return descriptor;
}

function mappedIdeasForWitness(
  release: RequiredAtlasV5Release,
  ideaIds: readonly string[],
): AtlasAttemptSearchMappedNodeV1[] {
  return ideaIds.map((ideaId) => {
    const idea = release.decompositionIdeaById.get(ideaId);
    if (idea === undefined) {
      throw new AtlasIdeaEvidenceBriefError(
        "missing_overlay",
        `Recorded witness references missing Idea ${JSON.stringify(ideaId)}.`,
      );
    }
    return { id: idea.ideaId, label: idea.title, summary: idea.summary };
  }).sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
}

function mappedConstraintsForWitness(
  release: RequiredAtlasV5Release,
  constraintIds: readonly string[],
): AtlasAttemptSearchMappedNodeV1[] {
  return constraintIds.map((constraintId) => {
    const constraint = release.constraintById.get(constraintId);
    if (constraint === undefined) {
      throw new AtlasIdeaEvidenceBriefError(
        "missing_overlay",
        `Recorded witness references missing Constraint ${JSON.stringify(constraintId)}.`,
      );
    }
    return { id: constraint.constraintId, label: constraint.label, summary: constraint.summary };
  }).sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
}

function buildAttemptRecord(
  release: RequiredAtlasV5Release,
  submission: RequiredAtlasV5Release["submissions"]["submissions"][number],
  change: RequiredAtlasV5Release["submissions"]["submissions"][number]["changes"][number],
  witness: NonNullable<AtlasRelease["mutationWitnessById"]> extends ReadonlyMap<string, infer T> ? T : never,
  route: NonNullable<AtlasRelease["submissionRouteById"]> extends ReadonlyMap<string, infer T> ? T : never,
  coIdeaIds: string[],
): AtlasIdeaAttemptV1 {
  return {
    submissionId: submission.id,
    changeId: change.id,
    createdAt: submission.createdAt,
    solverId: submission.solverId,
    result: {
      status: submission.status,
      classification: submission.classification,
      score: submission.score,
      scoreComparatorScore: submission.scoreComparatorScore,
      rawDelta: submission.rawDelta,
      directionalGain: submission.directionalGain,
      scoreComparatorId: submission.scoreComparatorId,
      scoreComparatorHops: submission.scoreComparatorHops,
    },
    change: {
      title: change.title,
      description: change.description,
      phase: change.phase,
      site: change.site,
      relation: change.relation,
      mappingIdeaId: change.ideaId,
    },
    witness: {
      ideaIds: [...witness.ideaIds],
      constraintIds: [...witness.constraintIds],
      reviewDisposition: witness.reviewDisposition,
      reviewNote: witness.reviewNote,
    },
    route: {
      mutationWitnessIds: [...route.mutationWitnessIds],
      ideaIds: [...route.ideaIds],
      constraintIds: [...route.constraintIds],
      interpretation: route.interpretation,
      policyCoupled: route.policyCoupled,
      hasUnresolved: route.hasUnresolved,
      terminalReason: route.terminalReason,
    },
    qualification: {
      codes: qualificationCodes(
        route.interpretation,
        submission.changes.length,
        route.policyCoupled,
        route.hasUnresolved,
      ),
      bundledChangeCount: submission.changes.length,
      coIdeaIds,
    },
    evidence: {
      detailShard: submission.detailShard,
      descriptor: attemptDescriptor(release, submission.id, submission.detailShard),
    },
  };
}

function attemptsForIdea(
  release: RequiredAtlasV5Release,
  ideaId: string,
): AtlasIdeaAttemptV1[] {
  const expectedWitnesses = release.mutationWitnessesByIdeaId.get(ideaId) ?? [];
  const observations = observedMutationsForIdea(release, ideaId);
  if (observations.length !== expectedWitnesses.length) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Atlas Idea ${JSON.stringify(ideaId)} has mutation witnesses that do not resolve to immutable submissions, changes, and routes.`,
    );
  }
  return observations.map(({ witness, submission, change, route }) => {
    return buildAttemptRecord(
      release,
      submission,
      change,
      witness,
      route,
      route.ideaIds.filter((candidate) => candidate !== ideaId),
    );
  }).sort((left, right) => {
    const leftTime = left.createdAt ?? "";
    const rightTime = right.createdAt ?? "";
    return compareText(rightTime, leftTime)
      || compareText(left.submissionId, right.submissionId)
      || compareText(left.changeId, right.changeId);
  });
}

const SEARCH_TOKEN_REGEX = /[\p{L}\p{N}]+/gu;
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 25;
const SEARCH_BM25_K1 = 1.2;
const SEARCH_BM25_B = 0.75;

type AttemptSearchDocument = {
  hit: AtlasAttemptSearchHitV1;
  tokenCounts: Map<string, number>;
  docLength: number;
  searchText: string;
};

function searchTokens(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().match(SEARCH_TOKEN_REGEX) ?? [];
}

function boostedTokenCounts(fields: readonly [string, number][]): { tokenCounts: Map<string, number>; docLength: number; searchText: string } {
  const tokenCounts = new Map<string, number>();
  let docLength = 0;
  const searchParts: string[] = [];
  for (const [value, weight] of fields) {
    searchParts.push(value);
    for (const token of searchTokens(value)) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + weight);
      docLength += weight;
    }
  }
  return { tokenCounts, docLength: Math.max(docLength, 1), searchText: searchTokens(searchParts.join("\n")).join(" ") };
}

function buildSearchDocuments(release: RequiredAtlasAttemptSearchRelease): AttemptSearchDocument[] {
  return release.submissions.submissions.flatMap((submission) => {
    const route = release.submissionRouteById.get(submission.id);
    if (route === undefined) {
      throw new AtlasIdeaEvidenceBriefError(
        "missing_overlay",
        `Submission ${JSON.stringify(submission.id)} is missing its submission route overlay.`,
      );
    }
    return submission.changes.map((change) => {
      const witness = release.mutationWitnessById.get(change.id);
      if (witness === undefined || witness.submissionId !== submission.id) {
        throw new AtlasIdeaEvidenceBriefError(
          "missing_overlay",
          `Recorded change ${JSON.stringify(change.id)} does not resolve to exactly one immutable mutation witness for submission ${JSON.stringify(submission.id)}.`,
        );
      }
      const mappedIdeas = mappedIdeasForWitness(release, witness.ideaIds);
      const mappedConstraints = mappedConstraintsForWitness(release, witness.constraintIds);
      const hit: AtlasAttemptSearchHitV1 = {
        ...buildAttemptRecord(
          release,
          submission,
          change,
          witness,
          route,
          route.ideaIds.filter((ideaId) => !witness.ideaIds.includes(ideaId)),
        ),
        rank: 0,
        mappedIdeas,
        mappedConstraints,
      };
      const { tokenCounts, docLength, searchText } = boostedTokenCounts([
        [submission.id, 8],
        [change.id, 8],
        [submission.label ?? "", 2],
        [submission.solverId, 1],
        [release.solverById.get(submission.solverId)?.name ?? "", 1],
        [submission.status, 1],
        [submission.classification ?? "", 1],
        [submission.scoreComparatorId ?? "", 1],
        [change.title, 6],
        [change.description, 3],
        [change.site, 2],
        [change.phase, 1],
        [change.relation, 1],
        [change.ideaId ?? "", 2],
        [witness.reviewDisposition ?? "", 1],
        [witness.reviewNote ?? "", 1],
        [route.interpretation, 1],
        [route.policyCoupled ? "policy coupled" : "", 1],
        [route.hasUnresolved ? "unresolved mapping" : "", 1],
        [route.terminalReason ?? "", 1],
        [mappedIdeas.map(({ id, label, summary }) => `${id}\n${label}\n${summary}`).join("\n"), 4],
        [mappedConstraints.map(({ id, label, summary }) => `${id}\n${label}\n${summary}`).join("\n"), 4],
      ]);
      return { hit, tokenCounts, docLength, searchText };
    });
  }).sort((left, right) => {
    const leftTime = left.hit.createdAt ?? "";
    const rightTime = right.hit.createdAt ?? "";
    return compareText(rightTime, leftTime)
      || compareText(left.hit.submissionId, right.hit.submissionId)
      || compareText(left.hit.changeId, right.hit.changeId);
  });
}

function scoreAttemptDocument(
  document: AttemptSearchDocument,
  queryTokens: readonly string[],
  rawQuery: string,
  documentFrequencies: ReadonlyMap<string, number>,
  documentCount: number,
  averageDocLength: number,
): number {
  let score = 0;
  for (const token of queryTokens) {
    const tf = document.tokenCounts.get(token) ?? 0;
    if (tf === 0) continue;
    const df = documentFrequencies.get(token) ?? 0;
    const idf = Math.log(1 + ((documentCount - df + 0.5) / (df + 0.5)));
    const denominator = tf + SEARCH_BM25_K1 * (1 - SEARCH_BM25_B + SEARCH_BM25_B * (document.docLength / averageDocLength));
    score += idf * ((tf * (SEARCH_BM25_K1 + 1)) / denominator);
  }
  const normalizedQuery = searchTokens(rawQuery).join(" ");
  const lowerQuery = rawQuery.trim().toLowerCase();
  if (normalizedQuery.length > 0 && document.searchText.includes(normalizedQuery)) score += 8;
  if (lowerQuery.length > 0) {
    if (document.hit.changeId.toLowerCase() === lowerQuery || document.hit.submissionId.toLowerCase() === lowerQuery) score += 40;
    else if (document.hit.changeId.toLowerCase().startsWith(lowerQuery) || document.hit.submissionId.toLowerCase().startsWith(lowerQuery)) score += 20;
    else if (document.hit.changeId.toLowerCase().includes(lowerQuery) || document.hit.submissionId.toLowerCase().includes(lowerQuery)) score += 10;
  }
  return score;
}

export function searchAtlasAttempts(
  release: AtlasRelease,
  query: string,
  options: AtlasAttemptSearchOptions = {},
): AtlasAttemptSearchV1 {
  requireAttemptSearchRelease(release);
  const trimmedQuery = query.trim();
  const tokens = searchTokens(trimmedQuery);
  if (trimmedQuery.length === 0 || tokens.length === 0) {
    throw new AtlasIdeaEvidenceBriefError("invalid_query", "Atlas attempt search query must include at least one letter or number.");
  }
  const limit = options.limit ?? SEARCH_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw new AtlasIdeaEvidenceBriefError(
      "invalid_limit",
      `Atlas attempt search limit must be an integer from 1 through ${SEARCH_MAX_LIMIT}.`,
    );
  }
  const documents = buildSearchDocuments(release);
  const documentFrequencies = new Map<string, number>();
  let totalDocLength = 0;
  for (const document of documents) {
    totalDocLength += document.docLength;
    for (const token of new Set(document.tokenCounts.keys())) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
    }
  }
  const averageDocLength = documents.length === 0 ? 1 : totalDocLength / documents.length;
  const matches = documents.map((document) => ({
    document,
    score: scoreAttemptDocument(
      document,
      tokens,
      trimmedQuery,
      documentFrequencies,
      documents.length,
      averageDocLength,
    ),
  })).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score
      || compareText(left.document.hit.submissionId, right.document.hit.submissionId)
      || compareText(left.document.hit.changeId, right.document.hit.changeId));
  return {
    schema: "yukon.atlas-attempt-search",
    schemaVersion: 1,
    release: releaseProvenance(release),
    query: { text: trimmedQuery, tokens },
    items: matches.slice(0, limit).map(({ document }, index) => ({ ...document.hit, rank: index + 1 })),
    coverage: {
      searchedChanges: documents.length,
      matchedChanges: matches.length,
    },
    page: {
      limit,
      total: matches.length,
    },
  };
}

function outcomeCounts(attempts: readonly AtlasIdeaAttemptV1[]): AtlasIdeaEvidenceOutcomeCountsV1 {
  const submissionById = new Map<string, AtlasSubmissionStatus>();
  for (const attempt of attempts) submissionById.set(attempt.submissionId, attempt.result.status);
  const statuses = [...submissionById.values()];
  return {
    submissions: submissionById.size,
    promoted: statuses.filter((status) => status === "promoted").length,
    rejected: statuses.filter((status) => status === "rejected").length,
    failed: statuses.filter((status) => status === "failed").length,
    promotionFailed: statuses.filter((status) => status === "promotion failed").length,
  };
}

function mechanicalCoverage(attempts: readonly AtlasIdeaAttemptV1[]): AtlasIdeaDossierCoverage {
  const submissionById = new Map<string, AtlasIdeaAttemptV1>();
  for (const attempt of attempts) submissionById.set(attempt.submissionId, attempt);
  const submissions = [...submissionById.values()];
  return {
    submissions: submissions.length,
    witnesses: attempts.length,
    singleChangeSubmissions: submissions.filter(({ qualification }) => (
      qualification.bundledChangeCount === 1
    )).length,
    bundledSubmissions: submissions.filter(({ qualification }) => (
      qualification.bundledChangeCount !== 1
    )).length,
    promoted: submissions.filter(({ result }) => result.status === "promoted").length,
    rejected: submissions.filter(({ result }) => result.status === "rejected").length,
    failed: submissions.filter(({ result }) => result.status === "failed").length,
    promotionFailed: submissions.filter(({ result }) => result.status === "promotion failed").length,
    solvers: new Set(submissions.map(({ solverId }) => solverId)).size,
  };
}

const EXPERIMENT_EVIDENCE_RANK: Readonly<Record<AtlasExperimentEvidenceLevel, number>> = {
  historical_observation: 0,
  matched_control: 1,
  one_change_ablation: 2,
  reproduced: 3,
  replicated: 4,
};

function correctnessSummary(
  observation: NonNullable<NonNullable<AtlasExperimentDetail["researchRuns"][number]["result"]>["pairedScopes"][number]["correctness"]>,
): AtlasIdeaVerificationCorrectnessV1 {
  const anyFailure = observation.dimensions.anyCorrectnessFailure;
  return {
    shotCount: observation.shotCount,
    controlFailures: anyFailure.controlFailures,
    treatmentFailures: anyFailure.treatmentFailures,
    riskDifferenceTreatmentMinusControl: anyFailure.riskDifferenceTreatmentMinusControl,
    exactTwoSidedMcNemarPValue: anyFailure.exactTwoSidedMcNemarPValue,
  };
}

function recordedCausalQualification(notes: string): string | null {
  // Only explicit source markers become brief evidence; unmarked notes cannot create a causal scope.
  const scopeStart = notes.indexOf("Causal scope:");
  if (scopeStart < 0) return null;
  const classificationStart = notes.lastIndexOf("Reference-replay classification:", scopeStart);
  const start = classificationStart < 0 ? scopeStart : classificationStart;
  const endMarkers = ["; mappedIdeaIds=", "Run-manifest source:", "Effect-vector source:"]
    .map((marker) => notes.indexOf(marker, scopeStart))
    .filter((index) => index >= 0);
  const end = endMarkers.length === 0 ? notes.length : Math.min(...endMarkers);
  const recordedText = notes.slice(start, end).trim();
  return recordedText.length === 0 ? null : recordedText;
}

const MAX_FACTORIAL_SCOPES = 3;
const MAX_FACTORIAL_CORRECTNESS_DIMENSIONS = 1;
const MAX_FACTORIAL_RESOURCE_METRICS = 3;
const MAX_FACTORIAL_ADMISSION_ISSUES = 6;
const MAX_FACTORIAL_LIMITATIONS = 4;

function factorialSummary(
  result: AtlasExperimentFactorialResultV1,
  selectedIdeaId: string,
): AtlasIdeaVerificationFactorialV1 {
  const scopes = result.scopes.slice(0, MAX_FACTORIAL_SCOPES).map((scope) => ({
    scopeId: scope.scopeId,
    shotCount: scope.shotCount,
    cellStatuses: scope.cells.map(({ cellId, status }) => ({ cellId, status })),
    correctness: scope.correctness.slice(0, MAX_FACTORIAL_CORRECTNESS_DIMENSIONS).map((dimension) => ({
      dimension: dimension.dimension,
      cellFailures: { ...dimension.cellFailures },
      conditionalEffects: dimension.simpleRiskDifferences.map((effect) => ({ ...effect })),
      interactionRiskDifference: dimension.interactionRiskDifference,
    })),
    resources: scope.resourceEffects.slice(0, MAX_FACTORIAL_RESOURCE_METRICS).map((resource) => ({
      metric: resource.metric,
      unit: resource.unit,
      conditionalEffects: resource.simpleEffects.map((effect) => ({ ...effect })),
      interaction: { ...resource.interaction },
    })),
    benchmarkInteraction: { ...scope.benchmarkInteraction },
    omittedCorrectnessDimensions: Math.max(
      0,
      scope.correctness.length - MAX_FACTORIAL_CORRECTNESS_DIMENSIONS,
    ),
    omittedResourceMetrics: Math.max(0, scope.resourceEffects.length - MAX_FACTORIAL_RESOURCE_METRICS),
  }));
  return {
    sourceSubmissionId: result.sourceSubmissionId,
    selectedFactorIds: result.factors
      .filter((factor) => factor.ideaId === selectedIdeaId)
      .map((factor) => factor.factorId),
    packetAdmission: {
      admitted: result.packetAdmission.admitted,
      issues: result.packetAdmission.issues.slice(0, MAX_FACTORIAL_ADMISSION_ISSUES),
    },
    omittedAdmissionIssues: Math.max(0, result.packetAdmission.issues.length - MAX_FACTORIAL_ADMISSION_ISSUES),
    factors: result.factors.map((factor) => ({ ...factor })),
    scopes,
    limitations: result.limitations.slice(0, MAX_FACTORIAL_LIMITATIONS),
    omittedScopes: Math.max(0, result.scopes.length - MAX_FACTORIAL_SCOPES),
    omittedLimitations: Math.max(0, result.limitations.length - MAX_FACTORIAL_LIMITATIONS),
  };
}

function verificationRunSummaries(
  detail: AtlasExperimentDetail | undefined,
  selectedIdeaId: string,
): AtlasIdeaVerificationRunV1[] {
  if (detail === undefined) return [];
  return detail.researchRuns.map((run) => {
    const result = run.result ?? null;
    return {
      runId: run.runId,
      kind: run.kind,
      status: run.status,
      executor: run.executor,
      independenceKey: run.independenceKey,
      recordedCausalQualification: recordedCausalQualification(run.notes),
      packetAdmission: result !== null && "packetAdmission" in result
        ? { admitted: result.packetAdmission.admitted, issues: [...result.packetAdmission.issues] }
        : null,
      officialObservation: result === null ? null : {
        control: { ...result.officialObservation.qualification.control },
        treatment: { ...result.officialObservation.qualification.treatment },
        effect: { ...result.officialObservation.benchmarkEffect },
      },
      pairedScopes: result === null ? [] : result.pairedScopes.map((scope) => ({
        scopeId: scope.scopeId,
        controlStatus: scope.controlStatus,
        treatmentStatus: scope.treatmentStatus,
        effect: { ...scope.benchmarkEffect },
        correctness: scope.correctness == null ? null : correctnessSummary(scope.correctness),
      })),
      pooledCorrectness: result !== null && "pooledCorrectness" in result
        ? correctnessSummary(result.pooledCorrectness)
        : null,
      factorial: run.factorialResult == null
        ? null
        : factorialSummary(run.factorialResult, selectedIdeaId),
    };
  }).sort((left, right) => compareText(left.runId, right.runId));
}

function verificationStudies(
  release: RequiredAtlasV5Release,
  ideaId: string,
  experimentDetailById: ReadonlyMap<string, AtlasExperimentDetail>,
): AtlasIdeaVerificationStudyV1[] {
  if (release.experiments === null) return [];
  return release.experiments.experiments
    .filter((experiment) => experiment.ideaId === ideaId || experiment.relatedIdeaIds?.includes(ideaId))
    .map((experiment) => {
      const descriptor = release.experimentDetailDescriptorByPath.get(experiment.detailShard);
      if (descriptor === undefined) {
        throw new AtlasIdeaEvidenceBriefError(
          "missing_overlay",
          `Experiment ${JSON.stringify(experiment.id)} references missing detail shard ${JSON.stringify(experiment.detailShard)}.`,
        );
      }
      return {
        experimentId: experiment.id,
        appliesToIdeaIds: [...new Set([experiment.ideaId, ...(experiment.relatedIdeaIds ?? [])])],
        title: experiment.title,
        question: experiment.question,
        intervention: experiment.intervention,
        status: experiment.status,
        evidenceLevel: experiment.evidenceLevel,
        framingProvenance: experiment.framingProvenance,
        aggregate: { ...experiment.aggregate },
        detailRef: { path: descriptor.path, sha256: descriptor.sha256 },
        runs: verificationRunSummaries(experimentDetailById.get(experiment.id), ideaId),
      };
    })
    .sort((left, right) => (
      EXPERIMENT_EVIDENCE_RANK[right.evidenceLevel] - EXPERIMENT_EVIDENCE_RANK[left.evidenceLevel]
        || compareText(left.title, right.title)
        || compareText(left.experimentId, right.experimentId)
    ));
}

function encodeCursor(
  releaseId: string,
  ideaId: string,
  status: AtlasIdeaAttemptStatusFilter,
  offset: number,
): string {
  return ["v1", encodeURIComponent(releaseId), encodeURIComponent(ideaId), status, String(offset)].join("|");
}

function decodeCursor(
  cursor: string,
  releaseId: string,
  ideaId: string,
  status: AtlasIdeaAttemptStatusFilter,
  total: number,
): number {
  const parts = cursor.split("|");
  let cursorReleaseId: string;
  let cursorIdeaId: string;
  try {
    cursorReleaseId = decodeURIComponent(parts[1] ?? "");
    cursorIdeaId = decodeURIComponent(parts[2] ?? "");
  } catch {
    throw new AtlasIdeaEvidenceBriefError("invalid_cursor", "Atlas attempt cursor is malformed.");
  }
  const offset = Number(parts[4]);
  if (parts.length !== 5
    || parts[0] !== "v1"
    || cursorReleaseId !== releaseId
    || cursorIdeaId !== ideaId
    || parts[3] !== status
    || !Number.isSafeInteger(offset)
    || offset <= 0
    || offset >= total) {
    throw new AtlasIdeaEvidenceBriefError(
      "invalid_cursor",
      "Atlas attempt cursor does not belong to this release, Idea, status filter, or page range.",
    );
  }
  return offset;
}

export function listAtlasIdeaAttempts(
  release: AtlasRelease,
  ideaId: string,
  options: AtlasIdeaAttemptListOptions = {},
): AtlasIdeaAttemptPageV1 {
  requireV5Release(release);
  const idea = release.decompositionIdeaById.get(ideaId);
  if (idea === undefined) {
    throw new AtlasIdeaEvidenceBriefError("idea_not_found", `No Atlas Idea has ID ${JSON.stringify(ideaId)}.`);
  }
  const status = options.status ?? "all";
  if (!ATTEMPT_STATUS_FILTERS.includes(status)) {
    throw new AtlasIdeaEvidenceBriefError("invalid_reference", `Unknown Atlas attempt status ${JSON.stringify(status)}.`);
  }
  const limit = options.limit ?? DEFAULT_ATTEMPT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ATTEMPT_LIMIT) {
    throw new AtlasIdeaEvidenceBriefError(
      "invalid_limit",
      `Atlas attempt limit must be an integer from 1 through ${MAX_ATTEMPT_LIMIT}.`,
    );
  }
  const recordedStatus = statusForFilter(status);
  const allAttempts = attemptsForIdea(release, ideaId).filter((attempt) => (
    recordedStatus === null || attempt.result.status === recordedStatus
  ));
  const offset = options.cursor === undefined
    ? 0
    : decodeCursor(options.cursor, release.manifest.releaseId, ideaId, status, allAttempts.length);
  const items = allAttempts.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    schema: "yukon.atlas-idea-attempt-page",
    schemaVersion: 1,
    release: releaseProvenance(release),
    idea: { ideaId: idea.ideaId, title: idea.title },
    filter: { status },
    items,
    page: {
      limit,
      nextCursor: nextOffset < allAttempts.length
        ? encodeCursor(release.manifest.releaseId, ideaId, status, nextOffset)
        : null,
      total: allAttempts.length,
    },
  };
}

function assessmentEvidence(
  release: RequiredAtlasV5Release,
  assessment: AtlasConstraintAssessment | undefined,
): AtlasConstraintAssessmentEvidence[] {
  if (assessment === undefined) return [];
  const evidenceIds = new Set([
    ...assessment.baseline.evidenceRefs,
    ...assessment.frontier.evidenceRefs,
    ...assessment.limit.evidenceRefs,
  ]);
  return [...evidenceIds].flatMap((evidenceId) => {
    const evidence = release.constraintAssessmentEvidenceById.get(evidenceId);
    return evidence === undefined ? [] : [evidence];
  }).sort((left, right) => compareText(left.evidenceId, right.evidenceId));
}

export function buildAtlasIdeaEvidenceBrief(
  release: AtlasRelease,
  ideaId: string,
  experimentDetailById: ReadonlyMap<string, AtlasExperimentDetail> = new Map(),
): AtlasIdeaEvidenceBriefV1 {
  requireV5Release(release);
  const idea = release.decompositionIdeaById.get(ideaId);
  if (idea === undefined) {
    throw new AtlasIdeaEvidenceBriefError("idea_not_found", `No Atlas Idea has ID ${JSON.stringify(ideaId)}.`);
  }
  const dossier = release.dossierByIdeaId.get(ideaId);
  const primaryPathIds = release.primaryPathByIdeaId.get(ideaId);
  if (dossier === undefined || primaryPathIds === undefined) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Atlas Idea ${JSON.stringify(ideaId)} is missing its dossier or primary path.`,
    );
  }
  const attempts = attemptsForIdea(release, ideaId);
  const coverage = mechanicalCoverage(attempts);
  if (Object.entries(coverage).some(([key, value]) => (
    dossier.coverage[key as keyof AtlasIdeaDossierCoverage] !== value
  ))) {
    throw new AtlasIdeaEvidenceBriefError(
      "missing_overlay",
      `Atlas Idea ${JSON.stringify(ideaId)} has dossier totals that do not match its immutable mutation witnesses.`,
    );
  }
  const placements = [...(release.linksByIdeaId.get(ideaId) ?? [])].map((link) => {
    const constraint = release.constraintById.get(link.constraintId);
    if (constraint === undefined) {
      throw new AtlasIdeaEvidenceBriefError(
        "missing_overlay",
        `Atlas placement ${JSON.stringify(link.linkId)} references a missing Constraint.`,
      );
    }
    return {
      linkId: link.linkId,
      constraintId: constraint.constraintId,
      constraintLabel: constraint.label,
      constraintSummary: constraint.summary,
      owner: {
        kind: constraint.owner.kind,
        id: constraint.owner.id,
        label: ownerLabel(release, constraint.owner),
      },
      primary: link.primary,
      reviewStatus: link.status,
      evidenceRefs: [...link.evidenceRefs],
    } satisfies AtlasIdeaEvidencePlacementV1;
  }).sort((left, right) => Number(right.primary) - Number(left.primary)
    || compareText(left.constraintLabel, right.constraintLabel)
    || compareText(left.constraintId, right.constraintId)
    || compareText(left.linkId, right.linkId));
  const approaches = dossier.approaches.map((approach) => ({
    ideaId: approach.ideaId,
    title: approach.title,
    summary: approach.summary,
    dossierCounts: {
      submissions: approach.submissions,
      promoted: approach.promoted,
      solvers: approach.solvers,
    },
    recordedSubmissionOutcomes: outcomeCounts(attempts.filter((attempt) => (
      attempt.change.mappingIdeaId === approach.ideaId
    ))),
  })).sort((left, right) => compareText(left.title, right.title) || compareText(left.ideaId, right.ideaId));
  const outcomeExamples = ATTEMPT_STATUSES.flatMap((status) => {
    const example = attempts.find((attempt) => attempt.result.status === status);
    return example === undefined ? [] : [example];
  });
  const childConstraints = [...(release.constraintsByOwnerKey.get(`idea:${ideaId}`) ?? [])]
    .map((constraint): AtlasIdeaEvidenceChildConstraintV1 => {
      const assessment = release.constraintAssessmentById.get(constraint.constraintId);
      const linkedIdeas = [...(release.linksByConstraintId.get(constraint.constraintId) ?? [])]
        .map((link) => {
          const linkedIdea = release.decompositionIdeaById.get(link.ideaId);
          if (linkedIdea === undefined) {
            throw new AtlasIdeaEvidenceBriefError(
              "missing_overlay",
              `Atlas link ${JSON.stringify(link.linkId)} references a missing Idea.`,
            );
          }
          return {
            linkId: link.linkId,
            ideaId: linkedIdea.ideaId,
            title: linkedIdea.title,
            summary: linkedIdea.summary,
            primary: link.primary,
            reviewStatus: link.status,
            evidenceRefs: [...link.evidenceRefs],
          };
        }).sort((left, right) => Number(right.primary) - Number(left.primary)
          || compareText(left.title, right.title)
          || compareText(left.ideaId, right.ideaId));
      return {
        constraintId: constraint.constraintId,
        label: constraint.label,
        summary: constraint.summary,
        reviewStatus: constraint.status,
        evidenceRefs: [...constraint.evidenceRefs],
        assessment: assessment ?? null,
        assessmentEvidence: assessmentEvidence(release, assessment),
        linkedIdeas,
      };
    }).sort((left, right) => compareText(left.label, right.label)
      || compareText(left.constraintId, right.constraintId));
  const studies = verificationStudies(release, ideaId, experimentDetailById);
  const caveats = [
    "Submission scores apply to the whole submission, not this idea by itself.",
    "This is a saved Atlas release and may differ from the current benchmark.",
    ...(approaches.length > 0
      ? ["Approach counts group related changes. They do not show how much an approach helped."]
      : []),
    ...(studies.length > 0
      ? ["Experiment results apply only to the recorded workload, comparison, and test setup."]
      : []),
    ...(studies.some((study) => study.evidenceLevel === "historical_observation"
      && study.framingProvenance === "prospective"
      && study.status === "inconclusive")
      ? ["An experiment was planned before testing but did not establish that the idea caused a score change."]
      : []),
    ...(attempts.some((attempt) => attempt.route.interpretation === "mixed"
      || attempt.qualification.bundledChangeCount > 1)
      ? ["Some submissions combine this idea with other changes or ideas."]
      : []),
    ...(attempts.some((attempt) => attempt.route.policyCoupled)
      ? ["Some results depend on benchmark rules or how the score was measured."]
      : []),
    ...(attempts.some((attempt) => attempt.route.hasUnresolved)
      ? ["Some submissions could not be mapped completely."]
      : []),
  ];
  return {
    schema: "yukon.atlas-idea-evidence-brief",
    schemaVersion: 1,
    release: releaseProvenance(release),
    idea: {
      ideaId: idea.ideaId,
      title: idea.title,
      summary: idea.summary,
      source: idea.source,
      reviewStatus: idea.status,
      evidenceRefs: [...idea.evidenceRefs],
    },
    primaryPath: primaryPathIds.map((id) => pathItem(release, id)),
    placements,
    coverage,
    approaches,
    variationGroups: [...(dossier.variationGroups ?? [])]
      .sort((left, right) => compareText(left.label, right.label)
        || compareText(left.variationId, right.variationId)),
    outcomeExamples,
    verificationStudies: studies,
    childConstraints,
    verification: dossier.verification,
    caveats,
  };
}
