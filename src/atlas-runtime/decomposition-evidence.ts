import type {
  AtlasConstraintAssessment,
  AtlasConstraintAssessmentEvidence,
  AtlasMutationWitness,
  AtlasRelease,
  AtlasSubmission,
  AtlasSubmissionChange,
  AtlasSubmissionRoute,
} from "./types";

export interface ConstraintAssessmentSummary {
  startingPoint: string;
  bestFound: string;
  limitLabel: "Known minimum" | "Estimated minimum" | "Best known" | "Minimum";
  limitValue: string;
  progress: string | null;
  basis: string | null;
  source: string | null;
  unmeasured: { title: "Not measured yet"; detail: string } | null;
}

export interface ObservedIdeaMutation {
  witness: AtlasMutationWitness;
  submission: AtlasSubmission;
  change: AtlasSubmissionChange;
  route: AtlasSubmissionRoute;
}

function formatValue(value: number, unit: string): string {
  const formatted = new Intl.NumberFormat("en", { maximumSignificantDigits: 7 }).format(value);
  return `${formatted} ${unit}`;
}

function limitBasis(assessment: AtlasConstraintAssessment): string | null {
  if (assessment.limit.kind === "proven_floor") return "Proven minimum";
  if (assessment.limit.kind === "pinned_floor") return "Benchmark minimum";
  if (assessment.limit.kind === "working_bound") return "Working estimate";
  if (assessment.limit.kind === "best_known_construction") return "Best known";
  return null;
}

function limitLabel(assessment: AtlasConstraintAssessment): ConstraintAssessmentSummary["limitLabel"] {
  if (assessment.limit.kind === "working_bound") return "Estimated minimum";
  if (assessment.limit.kind === "best_known_construction") return "Best known";
  if (assessment.limit.kind === "unknown") return "Minimum";
  return "Known minimum";
}

function progressDestination(assessment: AtlasConstraintAssessment): string {
  if (assessment.limit.kind === "working_bound") return "estimated minimum";
  if (assessment.limit.kind === "best_known_construction") return "best-known result";
  return "known minimum";
}

export function summarizeConstraintAssessment(
  assessment: AtlasConstraintAssessment,
  evidenceById?: ReadonlyMap<string, AtlasConstraintAssessmentEvidence>,
): ConstraintAssessmentSummary {
  const unmeasured = assessment.baseline.value === null
    && assessment.frontier.value === null
    && assessment.limit.kind === "unknown"
    ? {
        title: "Not measured yet" as const,
        detail: assessment.limit.statement.trim() || "Component cost is not measured yet.",
      }
    : null;
  const basis = limitBasis(assessment);
  const limitValue = assessment.limit.kind === "unknown" || assessment.limit.value === null
    ? assessment.limit.kind === "best_known_construction"
      ? "Not quantified"
      : "Not known"
    : assessment.limit.kind === "best_known_construction"
      ? formatValue(assessment.limit.value, assessment.metric.unit)
      : formatValue(assessment.limit.value, assessment.metric.unit);
  const source = assessment.limit.evidenceRefs
    .map((evidenceId) => evidenceById?.get(evidenceId) ?? null)
    .find((evidence) => evidence !== null)?.description ?? null;
  return {
    startingPoint: assessment.baseline.value === null
      ? "Not recorded"
      : formatValue(assessment.baseline.value, assessment.metric.unit),
    bestFound: assessment.frontier.value === null
      ? "Not established"
      : formatValue(assessment.frontier.value, assessment.metric.unit),
    limitLabel: limitLabel(assessment),
    limitValue,
    progress: assessment.progress === null
      ? null
      : `${new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 }).format(assessment.progress)} of the way from the starting point to the ${progressDestination(assessment)}`,
    basis,
    source,
    unmeasured,
  };
}

export function observedMutationsForIdea(release: AtlasRelease, ideaId: string): ObservedIdeaMutation[] {
  return (release.mutationWitnessesByIdeaId?.get(ideaId) ?? []).flatMap((witness) => {
    const submission = release.submissionById.get(witness.submissionId);
    const change = submission?.changes.find((candidate) => candidate.id === witness.witnessId);
    const route = release.submissionRouteById?.get(witness.submissionId);
    return submission === undefined || change === undefined || route === undefined
      ? []
      : [{ witness, submission, change, route }];
  }).sort((left, right) => {
    const leftTime = left.submission.createdAt === null ? Number.NEGATIVE_INFINITY : Date.parse(left.submission.createdAt);
    const rightTime = right.submission.createdAt === null ? Number.NEGATIVE_INFINITY : Date.parse(right.submission.createdAt);
    return rightTime - leftTime
      || left.submission.id.localeCompare(right.submission.id)
      || left.witness.witnessId.localeCompare(right.witness.witnessId);
  });
}

export function submissionBundleLabel(route: AtlasSubmissionRoute, submission: AtlasSubmission): string {
  if (route.interpretation === "focused") return "Mostly this idea";
  if (route.ideaIds.length > 1) return `Mixed with ${route.ideaIds.length} ideas`;
  if (submission.changes.length > 1) return `Mixed with ${submission.changes.length} changes`;
  return "One recorded change";
}

export function submissionComparatorLabel(submission: AtlasSubmission): string {
  if (submission.scoreComparatorId === null) return "No direct comparison";
  if (submission.scoreComparatorId === submission.parentId && submission.scoreComparatorHops === 1) {
    return "Compared with parent";
  }
  return submission.scoreComparatorHops === null
    ? "Compared with another version"
    : `Compared with an earlier version (${submission.scoreComparatorHops} ${submission.scoreComparatorHops === 1 ? "commit" : "commits"} back)`;
}
