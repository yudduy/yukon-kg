import { summarizeConstraintAssessment } from "./decomposition-evidence";
import type {
  AtlasConstraintAssessment,
  AtlasExperiment,
  AtlasExperimentControlledComparison,
  AtlasExperimentDetail,
  AtlasExperimentEvidenceLevel,
  AtlasIdeaDossierCoverage,
  AtlasRelease,
  AtlasSubmissionInterpretation,
} from "./types";

export const WORKING_KNOWLEDGE_SCHEMA = "yukon.atlas-working-knowledge-brief";
export const WORKING_KNOWLEDGE_SCHEMA_VERSION = 1 as const;

export type WorkingKnowledgeClaimPredicate =
  | "source_reported"
  | "artifact_verified"
  | "independently_reproduced"
  | "causally_attributed";

export type WorkingKnowledgeClaimStatus = "confirmed" | "likely" | "inference" | "unknown";
export type WorkingKnowledgeInterventionFamily =
  | "algorithm"
  | "representation"
  | "elimination"
  | "schedule"
  | "specialization"
  | "tuning"
  | "measurement"
  | "evaluator_hazard";

export interface WorkingKnowledgeSource {
  citation: string;
  url: string;
}

export interface WorkingKnowledgeLiteratureClaim {
  claimId: string;
  claim: string;
  predicate: WorkingKnowledgeClaimPredicate;
  status: WorkingKnowledgeClaimStatus;
  applicability: "ecdsa.fail-scorer" | "published-pareto" | "knowledge-representation";
  sources: WorkingKnowledgeSource[];
  implication: string;
  boundary: string;
}

export interface WorkingKnowledgeBound {
  constraintId: string;
  label: string;
  metric: string;
  unit: string;
  baseline: number | null;
  frontier: number | null;
  limitKind: AtlasConstraintAssessment["limit"]["kind"];
  limitValue: number | null;
  limitStatement: string;
  progress: number | null;
  summary: ReturnType<typeof summarizeConstraintAssessment>;
  evidenceRefs: string[];
}

export interface WorkingKnowledgeFrontier {
  submissionId: string;
  commitSha: string | null;
  score: number;
  directionalGain: number | null;
  interpretation: AtlasSubmissionInterpretation | "unrouted";
  ideaIds: string[];
  changeTitles: string[];
  sourceRefs: string[];
}

export interface WorkingKnowledgeMechanism {
  ideaId: string;
  title: string;
  family: WorkingKnowledgeInterventionFamily;
  experimentId: string;
  comparisonId: string;
  evidenceLevel: AtlasExperimentEvidenceLevel;
  officialDelta: number;
  controlScore: number;
  treatmentScore: number;
  toffoliDelta: number | null;
  qubitDelta: number | null;
  scope: string;
  sourceRefs: string[];
}

export interface WorkingKnowledgeObservation {
  ideaId: string;
  title: string;
  family: WorkingKnowledgeInterventionFamily;
  evidenceLevel: AtlasExperimentEvidenceLevel | "submission_archive";
  whyUnverified: string;
  coverage: Pick<AtlasIdeaDossierCoverage, "submissions" | "promoted" | "rejected" | "failed" | "bundledSubmissions"> | null;
  sourceRefs: string[];
}

export interface WorkingKnowledgeNegative {
  ideaId: string;
  title: string;
  family: WorkingKnowledgeInterventionFamily;
  submissions: number;
  promoted: number;
  rejected: number;
  failed: number;
  why: string;
  reopenCondition: string;
  sourceRefs: string[];
}

export interface WorkingKnowledgeHazard {
  hazardId: string;
  title: string;
  count: number;
  why: string;
  recommendedAction: string;
  sourceRefs: string[];
}

export interface WorkingKnowledgeDiscriminator {
  discriminatorId: string;
  question: string;
  predictedDistinction: string;
  status: "untried_in_atlas" | "historical_only" | "qualification_failed";
  relatedIdeaIds: string[];
  sourceRefs: string[];
}

export interface WorkingKnowledgeBrief {
  schema: typeof WORKING_KNOWLEDGE_SCHEMA;
  schemaVersion: typeof WORKING_KNOWLEDGE_SCHEMA_VERSION;
  compiledFrom: {
    releaseId: string;
    manifestSha256: string;
    benchmark: AtlasRelease["manifest"]["benchmark"];
  };
  contract: {
    objective: string;
    direction: "-" | "+";
    unit: string | null;
    mutableSurface: string;
    shots: number;
    validity: string[];
    degenerateOptimum: string;
  };
  boundAndGap: WorkingKnowledgeBound[];
  currentFrontier: WorkingKnowledgeFrontier[];
  supportedMechanisms: WorkingKnowledgeMechanism[];
  unverifiedObservations: WorkingKnowledgeObservation[];
  liveAlternatives: WorkingKnowledgeObservation[];
  negativeKnowledge: WorkingKnowledgeNegative[];
  evaluatorHazards: WorkingKnowledgeHazard[];
  nextDiscriminators: WorkingKnowledgeDiscriminator[];
  literatureOverlay: WorkingKnowledgeLiteratureClaim[];
  corpusAccounting: {
    submissions: number;
    promoted: number;
    mixed: number;
    focused: number;
    unmapped: number;
    seedGrindingSubmissions: number;
    seedGrindingPromoted: number;
    experiments: number;
    oneChangeAblations: number;
    admittedOneChangeImprovements: number;
  };
  caveats: string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const ECDSA_LITERATURE_OVERLAY: readonly WorkingKnowledgeLiteratureClaim[] = Object.freeze([
  {
    claimId: "lit:representation-plus-evaluator",
    claim: "The strongest publicly auditable discovery systems search an executable representation against a hard external evaluator, not an undifferentiated knowledge graph.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "knowledge-representation",
    sources: [
      { citation: "Romera-Paredes et al., FunSearch, Nature 2024", url: "https://doi.org/10.1038/s41586-023-06924-6" },
      { citation: "Novikov et al., AlphaEvolve, arXiv:2506.13131", url: "https://arxiv.org/abs/2506.13131" },
      { citation: "Schkufza et al., STOKE, arXiv:1211.0557", url: "https://arxiv.org/abs/1211.0557" },
    ],
    implication: "Compile disposable decision briefs from immutable Atlas records. Do not add graph infrastructure until an equal-content representation factorial earns an effect.",
    boundary: "This describes where evidence is easiest to audit, not a controlled proof that executable domains produce the most important innovations.",
  },
  {
    claimId: "lit:knowledge-presentation-not-strategy",
    claim: "Knowledge presentation and advice are not a sufficient mechanism for strategy revision. In PostTrainBench, only 2.08% of adjacent recognized experiment pairs changed objective family, data-source type, or stage structure.",
    predicate: "source_reported",
    status: "likely",
    applicability: "knowledge-representation",
    sources: [
      { citation: "What Is Missing from AI Post-Training AI, arXiv:2608.19072", url: "https://arxiv.org/abs/2608.19072" },
    ],
    implication: "A compiled ECDSA brief can prevent rediscovery and stale claims. It should not be assumed to reallocate search.",
    boundary: "Observational corpus; 44 trajectories did probe alternatives. Not a causal result on Yukon agents.",
  },
  {
    claimId: "lit:memory-can-reduce-diversity",
    claim: "Cross-session memory can accelerate rediscovery while high memory injection reduces strategy diversity; a cold condition can still find the best point.",
    predicate: "source_reported",
    status: "likely",
    applicability: "knowledge-representation",
    sources: [
      { citation: "Experience Graphs/Trellis, arXiv:2606.29823", url: "https://arxiv.org/abs/2606.29823" },
    ],
    implication: "Hard-filter evaluator hazards and duplicated lineage. Do not broadcast the full submission archive into every prompt.",
    boundary: "Three sessions per configuration on one kernel task; reported token reduction is not total cost to a verified frontier.",
  },
  {
    claimId: "lit:hybrid-search",
    claim: "On autoresearch, classical TPE and CMA-ES beat pure LLM search; the best reported system kept a classical optimizer on the trajectory and let an LLM inject occasional domain-informed proposals.",
    predicate: "source_reported",
    status: "likely",
    applicability: "knowledge-representation",
    sources: [
      { citation: "Ferreira et al., arXiv:2603.24647", url: "https://arxiv.org/abs/2603.24647" },
    ],
    implication: "Prefer schedule/width/ladder search with a classical controller. Reserve LLM budget for representation proposals and diagnosis.",
    boundary: "Result is task-specific. It does not license deleting Atlas provenance.",
  },
  {
    claimId: "lit:schrottenloher-dialog",
    claim: "The 2026 open circuit that matches Google's unpublished secp256k1 Pareto points is Schrottenloher's EEA-dialog / ping-pong inversion, with jump-GCD and Gidney venting as the main published knobs.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "published-pareto",
    sources: [
      { citation: "Schrottenloher, Optimized Point Addition Circuits, arXiv:2606.02235", url: "https://arxiv.org/abs/2606.02235" },
      { citation: "trailofbits/trailmix circuit summaries", url: "https://github.com/trailofbits/trailmix" },
    ],
    implication: "Treat ping-pong / dialog inversion as a representation-class change. Local Kaliski-era tuning does not transfer automatically across this cut.",
    boundary: "Published counts use a different contract than the pinned ECDSA.fail 9,024-shot verified scorer. Do not subtract those Toffoli numbers from Atlas scores.",
  },
  {
    claimId: "lit:google-pareto-unpublished",
    claim: "Babbush et al. reported low-qubit and low-gate secp256k1 point-add operating points but did not publish the circuits, relying on a zero-knowledge proof. The ECDSA.fail README quotes 1,175 qubits / 2.7M Toffoli and 1,425 qubits / 2.1M Toffoli.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "published-pareto",
    sources: [
      { citation: "ECDSA.fail challenge README reference table", url: "https://github.com/ecdsafail/ecdsafail-challenge" },
      { citation: "Schrottenloher discussion of Babbush et al., arXiv:2606.02235", url: "https://arxiv.org/abs/2606.02235" },
    ],
    implication: "Use those numbers only as an external aspirational target, never as an Atlas floor or as evidence that a named mechanism is present in the sealed corpus.",
    boundary: "Kickmick / approximate-success circuits are not the ECDSA.fail exact classical+phase+ancilla contract.",
  },
  {
    claimId: "lit:gidney-mbu",
    claim: "Gidney measurement-based uncomputation and temporary AND remain the standard Toffoli-saving uncompute pattern; Atlas has a jointly qualified one-change ablation of the temporary-AND family.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "ecdsa.fail-scorer",
    sources: [
      { citation: "Gidney, Halving the cost of quantum addition, Quantum 2, 74 (2018)", url: "https://doi.org/10.22331/q-2018-06-18-74" },
    ],
    implication: "Keep measurement-uncomputation as a live algorithm family. Isolated Atlas effect is recorded separately as artifact_verified.",
    boundary: "The paper does not by itself identify the ECDSA.fail delta. Causal score movement requires the Atlas ablation.",
  },
  {
    claimId: "lit:square-false-closure",
    claim: "A public note declared the product-square closed after pricing one algorithm, then a later recursion level (Karatsuba-2) invalidated that closure.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "ecdsa.fail-scorer",
    sources: [
      { citation: "Yukon KG NOTE.md research cutoff 2026-08-23, section 11.2", url: "https://github.com/yudduy/yukon-kg/blob/main/NOTE.md" },
    ],
    implication: "Store closures as scoped assertions with reopen conditions. Never merge a retracted ceiling into current-best prose.",
    boundary: "The sealed Atlas snapshot records Karatsuba as historical observation, not a jointly qualified one-change ablation.",
  },
  {
    claimId: "lit:nonce-lottery",
    claim: "The trusted evaluator derives inputs from SHAKE256 of the semantic operation stream, so identity padding and nonce grinding select a new Fiat-Shamir sample rather than proving an algorithmic mechanism.",
    predicate: "source_reported",
    status: "confirmed",
    applicability: "ecdsa.fail-scorer",
    sources: [
      { citation: "ECDSA.fail challenge README, Fiat-Shamir workload", url: "https://github.com/ecdsafail/ecdsafail-challenge" },
    ],
    implication: "Classify seed grinding as an evaluator hazard. Do not promote it as a supported mechanism even when it dominates promotion counts.",
    boundary: "Competition realism may still use nonce search. Primary mechanism claims must freeze or factor it out.",
  },
]);

const HAZARD_IDEA = /seed-grinding|variant:seed-grinding/;
const REPRESENTATION_IDEA = /karatsuba|new-point-addition|fermat-inversion|representation:|ping-pong|dialog/;
const SCHEDULE_IDEA = /window-size|comparator:width|iteration|fold|carry-tail|segmentation|truncated-comparison/;
const ELIMINATION_IDEA = /toffoli|liveness|cancellation|carry-out-elision|fixed-point-rewriting/;
const SPECIALIZATION_IDEA = /solinas|signed-digit|classical-operand|direct-shifted/;
const MEASUREMENT_IDEA = /resource-estimation|validation|simulation|count-only|lifetime-tracing|phase-aware|geometry-guard/;
const ALGORITHM_IDEA = /inversion|kaliski|bernstein|euclidean|measurement|temporary-and|gidney|uncompute|cuccaro|adder|ancilla|divstep/;

export function interventionFamilyFor(ideaId: string, releaseFamily?: string | null): WorkingKnowledgeInterventionFamily {
  if (HAZARD_IDEA.test(ideaId) || releaseFamily === "search-and-tuning") return "evaluator_hazard";
  if (MEASUREMENT_IDEA.test(ideaId) || releaseFamily === "resource-estimation" || releaseFamily === "validation-and-tooling") {
    return "measurement";
  }
  if (REPRESENTATION_IDEA.test(ideaId)) return "representation";
  if (SCHEDULE_IDEA.test(ideaId)) return "schedule";
  if (ELIMINATION_IDEA.test(ideaId)) return "elimination";
  if (SPECIALIZATION_IDEA.test(ideaId)) return "specialization";
  if (ALGORITHM_IDEA.test(ideaId) || releaseFamily === "inversion" || releaseFamily === "measurement-uncomputation") {
    return "algorithm";
  }
  if (releaseFamily === "modular-arithmetic") return "specialization";
  if (releaseFamily === "ancilla-management" || releaseFamily === "reversible-synthesis" || releaseFamily === "point-addition") {
    return "algorithm";
  }
  return "tuning";
}

function ideaTitle(release: AtlasRelease, ideaId: string): string {
  return release.decompositionIdeaById?.get(ideaId)?.title
    ?? release.ideaById.get(ideaId)?.name
    ?? ideaId;
}

function ideaFamily(release: AtlasRelease, ideaId: string): WorkingKnowledgeInterventionFamily {
  return interventionFamilyFor(ideaId, release.ideaById.get(ideaId)?.family ?? null);
}

function sourceRef(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function resourceDelta(
  comparison: AtlasExperimentControlledComparison,
  metric: string,
): number | null {
  const observation = comparison.result?.officialObservation.resourceObservations.find((item) => item.metric === metric);
  return observation === undefined ? null : observation.treatmentMinusControl;
}

function admittedImprovement(comparison: AtlasExperimentControlledComparison): {
  delta: number;
  controlScore: number;
  treatmentScore: number;
} | null {
  const official = comparison.result?.officialObservation;
  if (official === undefined) return null;
  if (official.qualification.control.status !== "passed" || official.qualification.treatment.status !== "passed") {
    return null;
  }
  if (official.benchmarkEffect.status !== "estimated") return null;
  const controlScore = official.qualification.control.score;
  const treatmentScore = official.qualification.treatment.score;
  if (controlScore === null || treatmentScore === null) return null;
  if (!(official.benchmarkEffect.delta < 0)) return null;
  return { delta: official.benchmarkEffect.delta, controlScore, treatmentScore };
}

function coverageFor(release: AtlasRelease, ideaId: string) {
  const dossier = release.dossierByIdeaId?.get(ideaId);
  if (dossier === undefined) return null;
  return {
    submissions: dossier.coverage.submissions,
    promoted: dossier.coverage.promoted,
    rejected: dossier.coverage.rejected,
    failed: dossier.coverage.failed,
    bundledSubmissions: dossier.coverage.bundledSubmissions,
  };
}

function seedGrindingStats(release: AtlasRelease): { submissions: number; promoted: number } {
  let submissions = 0;
  let promoted = 0;
  for (const submission of release.submissions.submissions) {
    if (!submission.changes.some((change) => change.ideaId !== null && HAZARD_IDEA.test(change.ideaId))) continue;
    submissions += 1;
    if (submission.status === "promoted") promoted += 1;
  }
  return { submissions, promoted };
}

function interpretationCounts(release: AtlasRelease): Record<string, number> {
  const counts: Record<string, number> = { focused: 0, single_idea: 0, mixed: 0, unmapped: 0, unrouted: 0 };
  for (const submission of release.submissions.submissions) {
    const interpretation = release.submissionRouteById?.get(submission.id)?.interpretation ?? "unrouted";
    counts[interpretation] = (counts[interpretation] ?? 0) + 1;
  }
  return counts;
}

const UNTRIED_DISCRIMINATORS: readonly Omit<WorkingKnowledgeDiscriminator, "sourceRefs">[] = [
  {
    discriminatorId: "disc:barrett-vs-solinas",
    question: "Does Barrett reciprocal reduction beat the pinned Solinas fold on the verified scorer?",
    predictedDistinction: "A genuine Barrett construction would not be a pseudo-Mersenne fold, even if nearby Solinas receipts exist.",
    status: "untried_in_atlas",
    relatedIdeaIds: ["candidate:solinas-reduction:5a45b2514d"],
  },
  {
    discriminatorId: "disc:half-gcd",
    question: "Does recursive half-GCD matrix inversion beat the fixed-stream Kaliski / dialog replay?",
    predictedDistinction: "Divide-and-conquer Bézout updates are a representation change relative to a recorded forward/reverse stream.",
    status: "untried_in_atlas",
    relatedIdeaIds: ["candidate:extended-euclidean-algorithm:f11501d92a", "candidate:kaliski-inversion:e79f263674"],
  },
  {
    discriminatorId: "disc:qrom-vs-location",
    question: "Does a bucket-brigade QROM constant load beat location-controlled arithmetic synthesis?",
    predictedDistinction: "Table lookup plus uncompute is a different mechanism from position-guarded local arithmetic.",
    status: "untried_in_atlas",
    relatedIdeaIds: ["candidate:location-controlled-arithmetic:0efa7e6ff7"],
  },
  {
    discriminatorId: "disc:fourier-comparator",
    question: "Does a Fourier-basis sign test beat the ripple-borrow quantum-classical comparator?",
    predictedDistinction: "Phase-rotation comparison is not a carry-chain width or truncation variant.",
    status: "untried_in_atlas",
    relatedIdeaIds: ["candidate:quantum-classical-comparator:d9ffd5fcec"],
  },
];

function requireV5(release: AtlasRelease): void {
  if (release.manifest.schemaVersion !== 5 || release.decomposition === undefined) {
    throw new Error("working-knowledge briefs require an Atlas v5 release with decomposition");
  }
}

export function buildEcdsaWorkingKnowledgeBrief(
  release: AtlasRelease,
  experimentDetailById: ReadonlyMap<string, AtlasExperimentDetail> = new Map(),
): WorkingKnowledgeBrief {
  requireV5(release);
  const assessments = [...(release.decomposition?.constraintAssessments ?? [])]
    .sort((left, right) => compareText(left.constraintId, right.constraintId));
  const boundAndGap = assessments.map((assessment) => {
    const constraint = release.constraintById?.get(assessment.constraintId);
    return {
      constraintId: assessment.constraintId,
      label: constraint?.label ?? assessment.constraintId,
      metric: assessment.metric.label,
      unit: assessment.metric.unit,
      baseline: assessment.baseline.value,
      frontier: assessment.frontier.value,
      limitKind: assessment.limit.kind,
      limitValue: assessment.limit.value,
      limitStatement: assessment.limit.statement,
      progress: assessment.progress,
      summary: summarizeConstraintAssessment(assessment, release.constraintAssessmentEvidenceById),
      evidenceRefs: [...new Set([
        ...assessment.baseline.evidenceRefs,
        ...assessment.frontier.evidenceRefs,
        ...assessment.limit.evidenceRefs,
      ])].sort(compareText),
    };
  });

  const currentFrontier = release.submissions.submissions
    .filter((submission) => submission.status === "promoted" && typeof submission.score === "number")
    .sort((left, right) => compareNumber(left.score ?? Number.POSITIVE_INFINITY, right.score ?? Number.POSITIVE_INFINITY)
      || compareText(left.id, right.id))
    .slice(0, 5)
    .map((submission) => {
      const route = release.submissionRouteById?.get(submission.id);
      const ideaIds = [...(route?.ideaIds ?? submission.changes.flatMap((change) => change.ideaId === null ? [] : [change.ideaId]))]
        .sort(compareText);
      return {
        submissionId: submission.id,
        commitSha: submission.commitSha,
        score: submission.score as number,
        directionalGain: submission.directionalGain,
        interpretation: route?.interpretation ?? "unrouted",
        ideaIds,
        changeTitles: submission.changes.map((change) => change.title),
        sourceRefs: [
          sourceRef("submission", submission.id),
          ...(submission.commitSha === null ? [] : [sourceRef("commit", submission.commitSha)]),
        ],
      };
    });

  const experiments = [...(release.experiments?.experiments ?? [])]
    .sort((left, right) => compareText(left.id, right.id));
  const supportedMechanisms: WorkingKnowledgeMechanism[] = [];
  const unverifiedObservations: WorkingKnowledgeObservation[] = [];
  const liveAlternatives: WorkingKnowledgeObservation[] = [];
  const nextDiscriminators: WorkingKnowledgeDiscriminator[] = UNTRIED_DISCRIMINATORS.map((item) => ({
    ...item,
    sourceRefs: item.relatedIdeaIds.map((ideaId) => sourceRef("idea", ideaId)),
  }));

  for (const experiment of experiments) {
    const detail = experimentDetailById.get(experiment.id);
    const comparisons = detail?.controlledComparisons ?? [];
    if (comparisons.length === 0) {
      unverifiedObservations.push(observationFromExperiment(release, experiment, "No jointly qualified controlled comparison is attached."));
      continue;
    }
    for (const comparison of comparisons.sort((left, right) => compareText(left.comparisonId, right.comparisonId))) {
      const admitted = admittedImprovement(comparison);
      if (admitted !== null && experiment.evidenceLevel === "one_change_ablation") {
        supportedMechanisms.push({
          ideaId: experiment.ideaId,
          title: ideaTitle(release, experiment.ideaId),
          family: ideaFamily(release, experiment.ideaId),
          experimentId: experiment.id,
          comparisonId: comparison.comparisonId,
          evidenceLevel: experiment.evidenceLevel,
          officialDelta: admitted.delta,
          controlScore: admitted.controlScore,
          treatmentScore: admitted.treatmentScore,
          toffoliDelta: resourceDelta(comparison, "average Toffoli"),
          qubitDelta: resourceDelta(comparison, "max referenced qubits"),
          scope: comparison.interpretation,
          sourceRefs: [
            sourceRef("experiment", experiment.id),
            sourceRef("comparison", comparison.comparisonId),
            sourceRef("idea", experiment.ideaId),
          ],
        });
        continue;
      }
      const official = comparison.result?.officialObservation;
      if (official?.benchmarkEffect.status === "unavailable") {
        const treatmentPassed = official.qualification.treatment.status === "passed";
        const controlFailed = official.qualification.control.status !== "passed";
        const record = observationFromExperiment(
          release,
          experiment,
          official.benchmarkEffect.reason,
        );
        if (treatmentPassed && controlFailed) {
          liveAlternatives.push(record);
          nextDiscriminators.push({
            discriminatorId: `disc:requalify:${experiment.id}`,
            question: `Can ${ideaTitle(release, experiment.ideaId)} be re-run with a jointly valid matched control?`,
            predictedDistinction: "The treatment arm produced a numeric score while the control did not, so no official effect is admitted.",
            status: "qualification_failed",
            relatedIdeaIds: [experiment.ideaId],
            sourceRefs: [sourceRef("experiment", experiment.id), sourceRef("comparison", comparison.comparisonId)],
          });
        } else {
          unverifiedObservations.push(record);
        }
        continue;
      }
      if (experiment.evidenceLevel !== "one_change_ablation") {
        unverifiedObservations.push(observationFromExperiment(
          release,
          experiment,
          `Evidence level is ${experiment.evidenceLevel}, so the comparison is not promoted as a component mechanism.`,
        ));
        continue;
      }
      unverifiedObservations.push(observationFromExperiment(
        release,
        experiment,
        "The one-change comparison did not admit a jointly qualified score improvement.",
      ));
    }
  }

  supportedMechanisms.sort((left, right) => compareNumber(left.officialDelta, right.officialDelta)
    || compareText(left.ideaId, right.ideaId));

  const negativeKnowledge = [...(release.decomposition?.dossiers ?? [])]
    .filter((dossier) => dossier.coverage.submissions > 0 && dossier.coverage.promoted === 0)
    .map((dossier) => {
      const family = ideaFamily(release, dossier.ideaId);
      return {
        ideaId: dossier.ideaId,
        title: ideaTitle(release, dossier.ideaId),
        family,
        submissions: dossier.coverage.submissions,
        promoted: dossier.coverage.promoted,
        rejected: dossier.coverage.rejected,
        failed: dossier.coverage.failed,
        why: family === "measurement"
          ? "These records change accounting or tooling, not the scored circuit."
          : "No promoted submission is routed to this idea in the sealed snapshot.",
        reopenCondition: reopenCondition(dossier.ideaId, family),
        sourceRefs: [sourceRef("idea", dossier.ideaId), sourceRef("dossier", dossier.ideaId)],
      };
    })
    .sort((left, right) => compareNumber(right.submissions, left.submissions) || compareText(left.ideaId, right.ideaId));

  const seed = seedGrindingStats(release);
  const interpretations = interpretationCounts(release);
  const statusCounts = release.submissions.submissions.reduce<Record<string, number>>((counts, submission) => {
    counts[submission.status] = (counts[submission.status] ?? 0) + 1;
    return counts;
  }, {});

  const evaluatorHazards: WorkingKnowledgeHazard[] = [
    {
      hazardId: "hazard:seed-grinding",
      title: "Nonce / seed grinding",
      count: seed.submissions,
      why: `${seed.promoted} of ${seed.submissions} seed-grinding-tagged submissions were promoted. The evaluator hashes the operation stream, so identity tails select a new workload rather than proving a circuit identity.`,
      recommendedAction: "Exclude nonce, reroll, and tail grinding from mechanism briefs. Factor them out of causal comparisons.",
      sourceRefs: ["idea:candidate:seed-grinding:7647dab7dc"],
    },
    {
      hazardId: "hazard:bundled-diffs",
      title: "Bundled multi-idea submissions",
      count: interpretations.mixed ?? 0,
      why: `${interpretations.mixed ?? 0} of ${release.submissions.submissions.length} submissions are mixed-idea routes. Promotion counts on those ideas are not component effects.`,
      recommendedAction: "Use one-change ablations or factorials for mechanism claims. Keep mixed submissions as search history only.",
      sourceRefs: ["role:decomposition.submissionRoutes"],
    },
  ];

  for (const experiment of experiments) {
    if (experiment.evidenceLevel !== "historical_observation") continue;
    if (nextDiscriminators.some((item) => item.relatedIdeaIds.includes(experiment.ideaId) && item.status === "historical_only")) {
      continue;
    }
    nextDiscriminators.push({
      discriminatorId: `disc:isolate:${experiment.id}`,
      question: `What is the isolated resource effect of ${ideaTitle(release, experiment.ideaId)} under a matched one-change ablation?`,
      predictedDistinction: "Historical or bundled observation cannot identify the component.",
      status: "historical_only",
      relatedIdeaIds: [experiment.ideaId],
      sourceRefs: [sourceRef("experiment", experiment.id)],
    });
  }
  nextDiscriminators.sort((left, right) => compareText(left.discriminatorId, right.discriminatorId));
  unverifiedObservations.sort((left, right) => compareText(left.ideaId, right.ideaId) || compareText(left.whyUnverified, right.whyUnverified));
  liveAlternatives.sort((left, right) => compareText(left.ideaId, right.ideaId));

  const spacetime = boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:spacetime-product");
  const qubits = boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:qubit-count");

  return {
    schema: WORKING_KNOWLEDGE_SCHEMA,
    schemaVersion: WORKING_KNOWLEDGE_SCHEMA_VERSION,
    compiledFrom: {
      releaseId: release.pointer.id,
      manifestSha256: release.pointer.manifestSha256,
      benchmark: release.manifest.benchmark,
    },
    contract: {
      objective: release.manifest.benchmark.description,
      direction: release.manifest.benchmark.direction,
      unit: release.manifest.benchmark.unit,
      mutableSurface: "src/point_add/** only; harness, Cargo.toml, and evaluator remain frozen.",
      shots: 9024,
      validity: [
        "classical output matches Weierstrass addition on every retained shot",
        "ancilla qubits return to |0>",
        "global phase is clean",
        "forward then reverse restores the input",
      ],
      degenerateOptimum: "Identity-pair nonce grinding and operation-stream padding can move the Fiat-Shamir sample without a structural circuit change.",
    },
    boundAndGap,
    currentFrontier,
    supportedMechanisms,
    unverifiedObservations,
    liveAlternatives,
    negativeKnowledge,
    evaluatorHazards,
    nextDiscriminators,
    literatureOverlay: [...ECDSA_LITERATURE_OVERLAY],
    corpusAccounting: {
      submissions: release.submissions.submissions.length,
      promoted: statusCounts.promoted ?? 0,
      mixed: interpretations.mixed ?? 0,
      focused: interpretations.focused ?? 0,
      unmapped: interpretations.unmapped ?? 0,
      seedGrindingSubmissions: seed.submissions,
      seedGrindingPromoted: seed.promoted,
      experiments: experiments.length,
      oneChangeAblations: experiments.filter((experiment) => experiment.evidenceLevel === "one_change_ablation").length,
      admittedOneChangeImprovements: supportedMechanisms.length,
    },
    caveats: [
      "Official one-change deltas are scoped to their parent artifacts. They are not additive with each other or with the current frontier score.",
      "Frontier submissions in this snapshot still bundle nonce grinding with structural edits, so the champion score is not a pure mechanism effect.",
      spacetime === undefined
        ? "No spacetime-product assessment is present."
        : `Atlas reports baseline ${spacetime.baseline} and frontier ${spacetime.frontier} qubit-Toffoli product, with no compatible nontrivial product floor.`,
      qubits === undefined
        ? "No qubit-count assessment is present."
        : `The 512-qubit floor is a pinned two-register interface bound, not a universal ECC lower bound. Current frontier width is ${qubits.frontier}.`,
      "Published Google/Schrottenloher Pareto points use a different contract than the pinned ECDSA.fail scorer.",
      "This brief is a disposable presentation-plane compilation. It does not mutate Atlas releases and has not earned an innovation-accelerator claim.",
    ],
  };
}

function observationFromExperiment(
  release: AtlasRelease,
  experiment: AtlasExperiment,
  whyUnverified: string,
): WorkingKnowledgeObservation {
  return {
    ideaId: experiment.ideaId,
    title: ideaTitle(release, experiment.ideaId),
    family: ideaFamily(release, experiment.ideaId),
    evidenceLevel: experiment.evidenceLevel,
    whyUnverified,
    coverage: coverageFor(release, experiment.ideaId),
    sourceRefs: [sourceRef("experiment", experiment.id), sourceRef("idea", experiment.ideaId)],
  };
}

function reopenCondition(ideaId: string, family: WorkingKnowledgeInterventionFamily): string {
  if (ideaId.includes("fermat-inversion")) {
    return "Reopen only if the inversion representation itself changes; a failed Fermat attempt does not bound dialog/Kaliski inversion.";
  }
  if (ideaId.includes("extended-euclidean-algorithm")) {
    return "Reopen if a recursive half-GCD or other non-stream EEA is implemented; recorded neighbors are fixed forward/reverse streams.";
  }
  if (family === "measurement") {
    return "Reopen if a new measurement becomes part of the official score or a verified bound.";
  }
  return "Reopen if the active point-add representation, scorer, or reachable-state regime changes, or if a later one-change ablation is jointly valid.";
}
