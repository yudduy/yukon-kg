export type AtlasDirection = "+" | "-";
export type AtlasSchemaVersion = 2 | 3 | 4 | 5;
export type AtlasRoleSchemaVersion = 2 | 3;
export type AtlasSubmissionStatus = "promoted" | "rejected" | "failed" | "promotion failed";
export type AtlasSubmissionClassification =
  | "artifact"
  | "measurement"
  | "artifact_and_measurement"
  | "no_op"
  | "unsupported";
export type AtlasChangePhase = "decode" | "prefill" | "both" | "unknown";
export type AtlasMutationRelation = "instance_of" | "variant_of" | "analogous_to" | "unresolved";
export type AtlasConceptRelation = "specializes" | "extends" | "uses" | "influenced_by";

export interface AtlasReleasePointer {
  id: string;
  baseUrl: string;
  manifestSha256: string;
}

export interface AtlasRoleDescriptor {
  path: string;
  sha256: string;
  bytes: number;
  gzipBytes: number;
}

interface AtlasReleaseManifestBase {
  schema: "yukon.atlas-release";
  releaseId: string;
  benchmark: {
    id: string | null;
    name: string;
    description: string;
    direction: AtlasDirection;
    unit: string | null;
    baselineScore: number | null;
  };
}

export interface AtlasReleaseManifestV2 extends AtlasReleaseManifestBase {
  schemaVersion: 2;
  source: {
    exportId: string | null;
    researchMapSha256: string;
  };
  counts: {
    ideas: number;
    solvers: number;
    submissions: number;
    detailShards: number;
  };
  roles: {
    ideas: AtlasRoleDescriptor;
    solvers: AtlasRoleDescriptor;
    submissions: AtlasRoleDescriptor;
    details: AtlasRoleDescriptor[];
  };
}

export interface AtlasReleaseManifestV3 extends AtlasReleaseManifestBase {
  schemaVersion: 3;
  source: {
    exportId: string | null;
    researchMapSha256: string;
    experimentRegistrySha256: string;
  };
  counts: {
    ideas: number;
    solvers: number;
    submissions: number;
    detailShards: number;
    experiments: number;
    experimentDetailShards: number;
  };
  roles: {
    ideas: AtlasRoleDescriptor;
    solvers: AtlasRoleDescriptor;
    submissions: AtlasRoleDescriptor;
    details: AtlasRoleDescriptor[];
    experiments: AtlasRoleDescriptor;
    experimentDetails: AtlasRoleDescriptor[];
  };
}

export interface AtlasReleaseManifestV4 extends AtlasReleaseManifestBase {
  schemaVersion: 4;
  source: {
    exportId: string | null;
    researchMapSha256: string;
    experimentRegistrySha256: string;
    ideaGenealogyRegistrySha256: string;
  };
  counts: {
    ideas: number;
    solvers: number;
    submissions: number;
    detailShards: number;
    experiments: number;
    experimentDetailShards: number;
    genealogyEdges: number;
    genealogyEvents: number;
    variants: number;
    ungroupedRuns: number;
  };
  roles: {
    ideas: AtlasRoleDescriptor;
    solvers: AtlasRoleDescriptor;
    submissions: AtlasRoleDescriptor;
    details: AtlasRoleDescriptor[];
    experiments: AtlasRoleDescriptor;
    experimentDetails: AtlasRoleDescriptor[];
    genealogy: AtlasRoleDescriptor;
  };
}

export interface AtlasReleaseManifestV5 extends AtlasReleaseManifestBase {
  schemaVersion: 5;
  source: {
    exportId: string | null;
    researchMapSha256: string;
    researchDecompositionRegistrySha256: string;
    experimentRegistrySha256?: string;
    constraintAssessmentRegistrySha256?: string;
  };
  counts: {
    ideas: number;
    solvers: number;
    submissions: number;
    detailShards: number;
    experiments?: number;
    experimentDetailShards?: number;
    areas: number;
    constraints: number;
    decompositionIdeas: number;
    constraintIdeaLinks: number;
    constraintAssessments?: number;
  };
  roles: {
    ideas: AtlasRoleDescriptor;
    solvers: AtlasRoleDescriptor;
    submissions: AtlasRoleDescriptor;
    details: AtlasRoleDescriptor[];
    experiments?: AtlasRoleDescriptor;
    experimentDetails?: AtlasRoleDescriptor[];
    decomposition: AtlasRoleDescriptor;
  };
}

export type AtlasReleaseManifest =
  | AtlasReleaseManifestV2
  | AtlasReleaseManifestV3
  | AtlasReleaseManifestV4
  | AtlasReleaseManifestV5;

export interface AtlasIdeaAggregate {
  attempts: number;
  promoted: number;
  solvers: number;
}

export interface AtlasIdea {
  id: string;
  name: string;
  summary: string;
  family: string;
  searchTerms: string[];
  variationOf: string | null;
  coined: boolean;
  status: string;
  aggregate: AtlasIdeaAggregate;
}

export interface AtlasIdeaRelation {
  id: string;
  subjectIdeaId: string;
  relation: AtlasConceptRelation;
  objectIdeaId: string;
  description: string;
}

export interface AtlasIdeasRole {
  schema: "yukon.atlas";
  schemaVersion: AtlasRoleSchemaVersion;
  view: "ideas";
  ideas: AtlasIdea[];
  relations: AtlasIdeaRelation[];
}

export interface AtlasSolverAggregate {
  attempts: number;
  promoted: number;
  ideas: number;
  roots: number;
}

export interface AtlasSolver {
  id: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  identityStatus: "verified_account" | "solver_lineage";
  aggregate: AtlasSolverAggregate;
}

export interface AtlasSolverHandoff {
  fromSolverId: string;
  toSolverId: string;
  commits: number;
}

export interface AtlasSolversRole {
  schema: "yukon.atlas";
  schemaVersion: AtlasRoleSchemaVersion;
  view: "solvers";
  solvers: AtlasSolver[];
  handoffs: AtlasSolverHandoff[];
}

export interface AtlasSubmissionChange {
  id: string;
  title: string;
  description: string;
  phase: AtlasChangePhase;
  site: string;
  relation: AtlasMutationRelation;
  ideaId: string | null;
}

export interface AtlasSubmission {
  id: string;
  parentId: string | null;
  scoreComparatorId: string | null;
  scoreComparatorHops: number | null;
  solverId: string;
  createdAt: string | null;
  status: AtlasSubmissionStatus;
  classification: AtlasSubmissionClassification | null;
  score: number | null;
  scoreComparatorScore: number | null;
  rawDelta: number | null;
  directionalGain: number | null;
  commitSha: string | null;
  label: string | null;
  changes: AtlasSubmissionChange[];
  detailShard: string;
}

export interface AtlasSubmissionsRole {
  schema: "yukon.atlas";
  schemaVersion: AtlasRoleSchemaVersion;
  view: "submissions";
  direction: AtlasDirection;
  submissions: AtlasSubmission[];
}

export interface AtlasSubmissionEvidence {
  changeId: string;
  excerpt: string;
}

export interface AtlasSubmissionDetail {
  submissionId: string;
  note: string | null;
  evidence: AtlasSubmissionEvidence[];
}

export interface AtlasSubmissionDetailRole {
  schema: "yukon.atlas";
  schemaVersion: AtlasRoleSchemaVersion;
  view: "submission-detail";
  shard: string;
  excerpts: string[];
  submissions: Array<{
    submissionId: string;
    note: string | null;
    evidence: Array<{ changeId: string; excerptIndex: number }>;
  }>;
}

export type AtlasExperimentFramingProvenance = "retrospective_review" | "prospective";
export type AtlasExperimentStatus = "candidate" | "pilot_ready" | "running" | "completed" | "inconclusive";
export type AtlasExperimentEvidenceLevel =
  | "historical_observation"
  | "matched_control"
  | "one_change_ablation"
  | "reproduced"
  | "replicated";
export type AtlasExperimentMembershipEvidence = "focused" | "bundled_observation";

export interface AtlasExperimentVariationRef {
  kind: "submission" | "research_artifact";
  id: string;
}

export interface AtlasExperimentVariationMembership {
  variationRef: AtlasExperimentVariationRef;
  evidenceRole: AtlasExperimentMembershipEvidence;
}

export interface AtlasExperimentAggregate {
  variations: number;
  focused: number;
  bundled: number;
  solvers: number;
  promoted: number;
  failed: number;
}

export interface AtlasExperiment {
  id: string;
  ideaId: string;
  relatedIdeaIds?: string[];
  title: string;
  question: string;
  intervention: string;
  framingProvenance: AtlasExperimentFramingProvenance;
  status: AtlasExperimentStatus;
  evidenceLevel: AtlasExperimentEvidenceLevel;
  recordedFinding?: string | null;
  representativeVariationId: string;
  variationMemberships: AtlasExperimentVariationMembership[];
  aggregate: AtlasExperimentAggregate;
  detailShard: string;
}

export interface AtlasExperimentEdge {
  id: string;
  parentExperimentId: string;
  childExperimentId: string;
  witnessParentSubmissionId: string;
  witnessChildSubmissionId: string;
}

export interface AtlasExperimentRelation {
  id: string;
  subjectExperimentId: string;
  relation: "replication_candidate";
  objectExperimentId: string;
  description: string;
}

export interface AtlasExperimentsRole {
  schema: "yukon.atlas";
  schemaVersion: 3;
  view: "experiments";
  experiments: AtlasExperiment[];
  edges: AtlasExperimentEdge[];
  relations: AtlasExperimentRelation[];
}

export type AtlasGenealogyBasis = "documented" | "conceptual_reconstruction";
export type AtlasGenealogyStatus = "machine_admitted" | "human_reviewed";
export type AtlasGenealogyEventKind = "synthesis" | "convergence" | "split";

export interface AtlasIdeaGenealogyAnnotation {
  ideaId: string;
  claimedAt: string | null;
  firstEvidencedAt: string | null;
  lastEvidencedAt: string | null;
  reconstructedAt: string;
  primaryIncomingEdgeId: string | null;
  aliasRefs: string[];
  replacementIdeaIds: string[];
}

export interface AtlasIdeaGenealogyEdge {
  edgeId: string;
  parentIdeaId: string;
  childIdeaId: string;
  assertionId: string;
  basis: AtlasGenealogyBasis;
  primary: boolean;
  evidenceRefs: string[];
  status: AtlasGenealogyStatus;
}

export interface AtlasIdeaGenealogyEvent {
  eventId: string;
  kind: AtlasGenealogyEventKind;
  inputIdeaIds: string[];
  outputIdeaIds: string[];
  claimedAt: string | null;
  firstEvidencedAt: string | null;
  lastEvidencedAt: string | null;
  reconstructedAt: string;
  evidenceRefs: string[];
  status: AtlasGenealogyStatus;
}

export interface AtlasExperimentVariant {
  variantId: string;
  experimentId: string;
  title: string;
  condition: string;
  heldConstant: string[];
  representativeRun: AtlasExperimentVariationRef;
  runRefs: AtlasExperimentVariationRef[];
  witnessRefs: string[];
  membershipEvidence: AtlasExperimentMembershipEvidence;
  parentVariantIds: string[];
}

export interface AtlasExperimentGenealogy {
  experimentId: string;
  variants: AtlasExperimentVariant[];
  ungroupedRunRefs: AtlasExperimentVariationRef[];
}

export interface AtlasGenealogyUnresolved {
  unresolvedId: string;
  kind: "genealogy_edge" | "variant_membership" | "chronology";
  subjectIds: string[];
  reason: string;
  evidenceRefs: string[];
}

export interface AtlasGenealogyRole {
  schema: "yukon.atlas";
  schemaVersion: 4;
  view: "genealogy";
  ideaAnnotations: AtlasIdeaGenealogyAnnotation[];
  edges: AtlasIdeaGenealogyEdge[];
  events: AtlasIdeaGenealogyEvent[];
  experiments: AtlasExperimentGenealogy[];
  unresolved: AtlasGenealogyUnresolved[];
}

export type AtlasDecompositionReviewStatus = "machine_admitted" | "human_reviewed";

export interface AtlasResearchArea {
  areaId: string;
  title: string;
  summary: string;
}

export interface AtlasResearchConstraint {
  constraintId: string;
  owner: { kind: "area" | "idea"; id: string };
  label: string;
  summary: string;
  status: AtlasDecompositionReviewStatus;
  evidenceRefs: string[];
}

export interface AtlasResearchIdea {
  ideaId: string;
  title: string;
  summary: string;
  source: { kind: "concept" | "reviewed_intervention"; id: string };
  status: AtlasDecompositionReviewStatus;
  evidenceRefs: string[];
}

export interface AtlasConstraintIdeaLink {
  linkId: string;
  constraintId: string;
  ideaId: string;
  primary: boolean;
  status: AtlasDecompositionReviewStatus;
  evidenceRefs: string[];
}

export interface AtlasDecompositionUnresolved {
  unresolvedId: string;
  kind: "constraint" | "idea_identity" | "placement";
  subjectIds: string[];
  reason: string;
  evidenceRefs: string[];
}

export interface AtlasDecompositionCorpusCoverage {
  submissions: number;
  mappedSubmissions: number;
  unresolvedSubmissions: number;
  withoutMappedMutation: number;
  multiIdeaSubmissions: number;
}

export type AtlasConstraintLimitKind =
  | "proven_floor"
  | "pinned_floor"
  | "working_bound"
  | "best_known_construction"
  | "unknown";

export interface AtlasConstraintAssessment {
  assessmentId: string;
  constraintId: string;
  metric: {
    label: string;
    unit: string;
    direction: "lower" | "higher";
    regime: string;
  };
  baseline: { value: number | null; evidenceRefs: string[] };
  frontier: { value: number | null; evidenceRefs: string[] };
  limit: {
    kind: AtlasConstraintLimitKind;
    value: number | null;
    statement: string;
    evidenceRefs: string[];
  };
  progress: number | null;
  status: AtlasDecompositionReviewStatus;
}

export interface AtlasConstraintAssessmentEvidence {
  evidenceId: string;
  kind: "formal_proof" | "benchmark_definition" | "artifact_measurement" | "reviewed_analysis" | "official_document";
  locator: string;
  sha256: string;
  bytes: number;
  description: string;
}

export type AtlasMutationWitnessReviewDisposition =
  | "accepted_child"
  | "proposed_child"
  | "covered_by_owner"
  | "parameter_only"
  | "non_structural"
  | "insufficient_evidence"
  | "metric_only"
  | "unresolved";

export interface AtlasMutationWitness {
  witnessId: string;
  submissionId: string;
  mappingIdeaId: string | null;
  ideaIds: string[];
  constraintIds: string[];
  relation: AtlasMutationRelation;
  reviewDisposition: AtlasMutationWitnessReviewDisposition | null;
  reviewNote: string | null;
}

export type AtlasSubmissionInterpretation = "focused" | "single_idea" | "mixed" | "unmapped";
export type AtlasSubmissionTerminalReason =
  | "unsupported"
  | "measurement_only"
  | "no_op"
  | "metric_only"
  | "unresolved_only";

export interface AtlasSubmissionRoute {
  submissionId: string;
  mutationWitnessIds: string[];
  ideaIds: string[];
  constraintIds: string[];
  interpretation: AtlasSubmissionInterpretation;
  policyCoupled: boolean;
  hasUnresolved: boolean;
  terminalReason: AtlasSubmissionTerminalReason | null;
}

export interface AtlasIdeaDossierCoverage {
  submissions: number;
  witnesses: number;
  singleChangeSubmissions: number;
  bundledSubmissions: number;
  promoted: number;
  rejected: number;
  failed: number;
  promotionFailed: number;
  solvers: number;
}

export interface AtlasIdeaApproach {
  ideaId: string;
  title: string;
  summary: string;
  submissions: number;
  promoted: number;
  solvers: number;
}

export interface AtlasIdeaRepresentativeWitness {
  submissionId: string;
  changeId: string;
  title: string;
  description: string;
  site: string;
  status: AtlasSubmissionStatus;
  directionalGain: number | null;
  scoreComparatorId: string | null;
  scoreComparatorHops: number | null;
  bundledChangeCount: number;
  detailShard: string;
}

export interface AtlasIdeaVariationGroup {
  variationId: string;
  label: string;
  summary: string;
  site: string;
  submissions: number;
  solvers: number;
  bundledSubmissions: number;
  representativeSubmissionId: string;
  detailShard: string;
}

export interface AtlasIdeaDossier {
  ideaId: string;
  coverage: AtlasIdeaDossierCoverage;
  approaches: AtlasIdeaApproach[];
  variationGroups?: AtlasIdeaVariationGroup[];
  representativeWitnesses: AtlasIdeaRepresentativeWitness[];
  verification: "requires_verification";
}

export interface AtlasDecompositionRole {
  schema: "yukon.atlas";
  schemaVersion: 5;
  view: "decomposition";
  areas: AtlasResearchArea[];
  constraints: AtlasResearchConstraint[];
  ideas: AtlasResearchIdea[];
  links: AtlasConstraintIdeaLink[];
  unresolved: AtlasDecompositionUnresolved[];
  corpus?: AtlasDecompositionCorpusCoverage;
  dossiers?: AtlasIdeaDossier[];
  constraintAssessments?: AtlasConstraintAssessment[];
  constraintAssessmentEvidence?: AtlasConstraintAssessmentEvidence[];
  mutationWitnesses?: AtlasMutationWitness[];
  submissionRoutes?: AtlasSubmissionRoute[];
}

export interface AtlasExperimentLiteratureReference {
  sourceRef: string;
  citation: string;
  url: string;
  relevance: string;
}

export interface AtlasExperimentArtifactPin {
  artifactId: string;
  sha256: string;
}

export interface AtlasExperimentPairedDelta {
  pairId: string;
  treatmentDelta: number;
  controlDelta: number;
}

export type AtlasExperimentEvaluationStatus = "passed" | "failed" | "unavailable";
export type AtlasExperimentTraceConcordanceStatus = "identical" | "different" | "unavailable";

export interface AtlasExperimentQualificationArmResult {
  status: AtlasExperimentEvaluationStatus;
  score: number | null;
}

export interface AtlasExperimentTraceConcordanceFacet {
  status: AtlasExperimentTraceConcordanceStatus;
  method: string | null;
  controlFingerprint: string | null;
  treatmentFingerprint: string | null;
}

export interface AtlasExperimentTraceConcordance {
  observed_output: AtlasExperimentTraceConcordanceFacet;
  phase: AtlasExperimentTraceConcordanceFacet;
  ancilla: AtlasExperimentTraceConcordanceFacet;
}

export interface AtlasExperimentResourceObservation {
  metric: string;
  unit: string;
  control: number;
  treatment: number;
  treatmentMinusControl: number;
}

export type AtlasExperimentEstimatedEffect =
  | { status: "estimated"; delta: number }
  | { status: "unavailable"; reasonCode: string; reason: string };

export type AtlasExperimentBenchmarkEffect =
  | { status: "admitted" | "estimated"; delta: number }
  | { status: "unavailable"; reasonCode: string; reason: string };

export interface AtlasExperimentOfficialObservation {
  qualification: {
    control: AtlasExperimentQualificationArmResult;
    treatment: AtlasExperimentQualificationArmResult;
  };
  resourceObservations: AtlasExperimentResourceObservation[];
  benchmarkEffect: AtlasExperimentEstimatedEffect;
}

export interface AtlasExperimentPairedScopeResult {
  scopeId: string;
  controlStatus: AtlasExperimentEvaluationStatus;
  treatmentStatus: AtlasExperimentEvaluationStatus;
  traceConcordance: AtlasExperimentTraceConcordance;
  resourceObservations: AtlasExperimentResourceObservation[];
  benchmarkEffect: AtlasExperimentBenchmarkEffect;
  correctness?: AtlasExperimentCorrectnessObservation | null;
}

export interface AtlasExperimentCorrectnessDimensionSummary {
  n00NeitherFailed: number;
  n01TreatmentOnlyFailed: number;
  n10ControlOnlyFailed: number;
  n11BothFailed: number;
  controlFailures: number;
  treatmentFailures: number;
  controlRisk: number;
  treatmentRisk: number;
  riskDifferenceTreatmentMinusControl: number;
  discordantShots: number;
  exactTwoSidedMcNemarPValue: number;
}

export interface AtlasExperimentCorrectnessObservation {
  shotCount: number;
  dimensions: {
    classicalMismatch: AtlasExperimentCorrectnessDimensionSummary;
    phaseGarbage: AtlasExperimentCorrectnessDimensionSummary;
    ancillaGarbage: AtlasExperimentCorrectnessDimensionSummary;
    anyCorrectnessFailure: AtlasExperimentCorrectnessDimensionSummary;
  };
}

export interface AtlasExperimentPacketAdmission {
  admitted: boolean;
  issues: string[];
}

// Versioned independently from the surrounding detail role so result semantics can evolve
// without weakening the immutable v3 compatibility contract.
export interface AtlasExperimentControlledResultV1 {
  schemaVersion: 1;
  officialObservation: AtlasExperimentOfficialObservation;
  pairedScopes: AtlasExperimentPairedScopeResult[];
}

export interface AtlasExperimentControlledResultV2 {
  schemaVersion: 2;
  officialObservation: AtlasExperimentOfficialObservation;
  pairedScopes: AtlasExperimentPairedScopeResult[];
  packetAdmission: AtlasExperimentPacketAdmission;
  pooledCorrectness: AtlasExperimentCorrectnessObservation;
}

export type AtlasExperimentControlledResult = AtlasExperimentControlledResultV1 | AtlasExperimentControlledResultV2;

export interface AtlasExperimentControlledComparison {
  comparisonId: string;
  treatmentVariationId: string;
  sourceParentArtifactId: string | null;
  officialComparatorAttemptId: string | null;
  matchedControlArtifactId: string | null;
  recordedDelta: number | null;
  officialControlDelta: number | null;
  pairedDeltas: AtlasExperimentPairedDelta[] | null;
  evidenceLevel: AtlasExperimentEvidenceLevel;
  researchRunIds: string[];
  interpretation: string;
  result?: AtlasExperimentControlledResult | null;
}

export interface AtlasExperimentResearchRun {
  runId: string;
  kind: "ablation" | "reproduction" | "factorial";
  status: "planned" | "running" | "completed" | "failed";
  protocol: AtlasExperimentArtifactPin | null;
  runArtifact: AtlasExperimentArtifactPin | null;
  armArtifacts: {
    control: AtlasExperimentArtifactPin | null;
    treatment: AtlasExperimentArtifactPin | null;
  };
  executor: string | null;
  independenceKey: string | null;
  notes: string;
  result?: AtlasExperimentControlledResult | null;
  factorialResult?: AtlasExperimentFactorialResultV1 | null;
}

export type AtlasExperimentFactorialCellId = "00" | "10" | "01" | "11";

export interface AtlasExperimentFactorialFactor {
  factorId: string;
  ideaId: string;
  label: string;
  offLabel: string;
  onLabel: string;
}

export interface AtlasExperimentFactorialCell {
  cellId: AtlasExperimentFactorialCellId;
  artifact: AtlasExperimentArtifactPin;
  repeatBuildSha256: string;
}

export interface AtlasExperimentFactorialCellValues {
  "00": number;
  "10": number;
  "01": number;
  "11": number;
}

export interface AtlasExperimentFactorialSimpleEffect {
  factorId: string;
  heldFactorId: string;
  heldLevel: 0 | 1;
  delta: number;
}

export interface AtlasExperimentFactorialPatternCount {
  pattern: string;
  shots: number;
}

export interface AtlasExperimentFactorialCorrectness {
  dimension: string;
  cellFailures: AtlasExperimentFactorialCellValues;
  cellRisks: AtlasExperimentFactorialCellValues;
  patternCounts: AtlasExperimentFactorialPatternCount[];
  simpleRiskDifferences: AtlasExperimentFactorialSimpleEffect[];
  interactionRiskDifference: number;
}

export interface AtlasExperimentFactorialResourceValue {
  metric: string;
  unit: string;
  value: number;
}

export type AtlasExperimentFactorialEffect =
  | { status: "admitted" | "observed_not_admitted"; delta: number }
  | { status: "unavailable"; reason: string };

export interface AtlasExperimentFactorialResourceEffect {
  metric: string;
  unit: string;
  cellValues: AtlasExperimentFactorialCellValues;
  simpleEffects: AtlasExperimentFactorialSimpleEffect[];
  interaction: AtlasExperimentFactorialEffect;
}

export interface AtlasExperimentFactorialScopeCell {
  cellId: AtlasExperimentFactorialCellId;
  status: AtlasExperimentEvaluationStatus;
  resourceScore: number;
  resources: AtlasExperimentFactorialResourceValue[];
}

export interface AtlasExperimentFactorialScope {
  scopeId: string;
  shotCount: number;
  cells: AtlasExperimentFactorialScopeCell[];
  correctness: AtlasExperimentFactorialCorrectness[];
  resourceEffects: AtlasExperimentFactorialResourceEffect[];
  benchmarkInteraction:
    | { status: "admitted"; delta: number }
    | { status: "unavailable"; reason: string };
}

export interface AtlasExperimentFactorialResultV1 {
  schemaVersion: 1;
  sourceSubmissionId: string;
  packetAdmission: AtlasExperimentPacketAdmission;
  factors: [AtlasExperimentFactorialFactor, AtlasExperimentFactorialFactor];
  cellOrder: ["00", "10", "01", "11"];
  cells: [
    AtlasExperimentFactorialCell,
    AtlasExperimentFactorialCell,
    AtlasExperimentFactorialCell,
    AtlasExperimentFactorialCell,
  ];
  scopes: AtlasExperimentFactorialScope[];
  limitations: string[];
}

export interface AtlasExperimentDetail {
  experimentId: string;
  framing: {
    retrospective: { observedPattern: string; limitations: string[] } | null;
    prospective: { hypothesis: string; predictedOutcome: string; falsificationCriteria: string[] } | null;
  };
  variationRule: {
    unit: "one_change" | "bundle" | "factorial";
    treatment: string;
    heldConstant: string[];
    allowedDifferences: string[];
    exclusionCriteria: string[];
  };
  literature: AtlasExperimentLiteratureReference[];
  controlledComparisons: AtlasExperimentControlledComparison[];
  researchRuns: AtlasExperimentResearchRun[];
}

export interface AtlasExperimentDetailRoleV3 {
  schema: "yukon.atlas";
  schemaVersion: 3;
  view: "experiment-detail";
  shard: string;
  experiments: AtlasExperimentDetail[];
}

export interface AtlasExperimentDetailRoleV4 {
  schema: "yukon.atlas";
  schemaVersion: 4;
  view: "experiment-detail";
  shard: string;
  experiments: AtlasExperimentDetail[];
}

export interface AtlasExperimentDetailRoleV5 {
  schema: "yukon.atlas";
  schemaVersion: 5;
  view: "experiment-detail";
  shard: string;
  experiments: AtlasExperimentDetail[];
}

export type AtlasExperimentDetailRole =
  | AtlasExperimentDetailRoleV3
  | AtlasExperimentDetailRoleV4
  | AtlasExperimentDetailRoleV5;

export interface AtlasExperimentDetailModel {
  shard: string;
  experimentById: ReadonlyMap<string, AtlasExperimentDetail>;
}

export interface AtlasRelease {
  pointer: AtlasReleasePointer;
  manifest: AtlasReleaseManifest;
  ideas: AtlasIdeasRole;
  solvers: AtlasSolversRole;
  submissions: AtlasSubmissionsRole;
  experiments: AtlasExperimentsRole | null;
  genealogy?: AtlasGenealogyRole | null;
  decomposition?: AtlasDecompositionRole | null;
  ideaById: ReadonlyMap<string, AtlasIdea>;
  solverById: ReadonlyMap<string, AtlasSolver>;
  submissionById: ReadonlyMap<string, AtlasSubmission>;
  experimentById: ReadonlyMap<string, AtlasExperiment>;
  genealogyAnnotationByIdeaId?: ReadonlyMap<string, AtlasIdeaGenealogyAnnotation>;
  genealogyChildrenByIdeaId?: ReadonlyMap<string, readonly AtlasIdeaGenealogyEdge[]>;
  genealogyParentsByIdeaId?: ReadonlyMap<string, readonly AtlasIdeaGenealogyEdge[]>;
  variantById?: ReadonlyMap<string, AtlasExperimentVariant>;
  variantsByExperimentId?: ReadonlyMap<string, readonly AtlasExperimentVariant[]>;
  runsByVariantId?: ReadonlyMap<string, readonly AtlasExperimentVariationRef[]>;
  ungroupedRunsByExperimentId?: ReadonlyMap<string, readonly AtlasExperimentVariationRef[]>;
  areaById?: ReadonlyMap<string, AtlasResearchArea>;
  constraintById?: ReadonlyMap<string, AtlasResearchConstraint>;
  decompositionIdeaById?: ReadonlyMap<string, AtlasResearchIdea>;
  constraintsByOwnerKey?: ReadonlyMap<string, readonly AtlasResearchConstraint[]>;
  linksByConstraintId?: ReadonlyMap<string, readonly AtlasConstraintIdeaLink[]>;
  linksByIdeaId?: ReadonlyMap<string, readonly AtlasConstraintIdeaLink[]>;
  primaryPathByIdeaId?: ReadonlyMap<string, readonly string[]>;
  dossierByIdeaId?: ReadonlyMap<string, AtlasIdeaDossier>;
  constraintAssessmentById?: ReadonlyMap<string, AtlasConstraintAssessment>;
  constraintAssessmentEvidenceById?: ReadonlyMap<string, AtlasConstraintAssessmentEvidence>;
  mutationWitnessById?: ReadonlyMap<string, AtlasMutationWitness>;
  mutationWitnessesByIdeaId?: ReadonlyMap<string, readonly AtlasMutationWitness[]>;
  submissionRouteById?: ReadonlyMap<string, AtlasSubmissionRoute>;
  ideaIdsBySubmissionId?: ReadonlyMap<string, readonly string[]>;
  detailDescriptorByPath: ReadonlyMap<string, AtlasRoleDescriptor>;
  experimentDetailDescriptorByPath: ReadonlyMap<string, AtlasRoleDescriptor>;
}

export interface AtlasSubmissionDetailModel {
  shard: string;
  submissionById: ReadonlyMap<string, AtlasSubmissionDetail>;
}
