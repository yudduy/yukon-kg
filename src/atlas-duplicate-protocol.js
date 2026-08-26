import { promises as fs } from "node:fs";
import path from "node:path";
import { canonicalStringify, holmAdjust, sha256 } from "./protocol.js";

export const ATLAS_DUPLICATE_PROTOCOL_VERSION = "yukon-kg.atlas-duplicate.v4";
export const ATLAS_DUPLICATE_MODELS = Object.freeze(["gpt-5.6-luna", "gpt-5.6-sol"]);
export const ATLAS_DUPLICATE_REASONING = "medium";
export const PINNED_RELEASE_ID = "b4bd9026018a9ab464fafd1ce4c2905c95af95462b29d55ede169c7cb953eac2";
export const PINNED_MANIFEST_SHA256 = "db9c9c924543418ab47d871a666f0cdd17bcd4c116369bbcc411bacf97b50925";
export const QUERY_CALL_LIMIT = 12;
export const QUERY_BYTE_LIMIT = 24_576;
export const RESPONSE_BYTE_LIMIT = 6 * 1024;
export const SESSION_TIMEOUT_MS = 180_000;
export const REPEAT_COUNT = 3;
export const PILOT_CASES = 6;
export const PILOT_POSITIVES = 4;
export const PILOT_NEGATIVES = 2;
export const CONFIRMATORY_CASES = 24;
export const CONFIRMATORY_POSITIVES = 18;
export const CONFIRMATORY_NEGATIVES = 6;
export const CONDITIONS = Object.freeze(["raw", "flat", "flat_plus_brief"]);
export const CASE_SEARCH_PROBE_LIMIT = 3;
export const NEGATIVE_NEIGHBOR_COUNT = 2;

const V3_PILOT_DIRECTION_BLOCKS = new Set([
  "candidate:measurement-and-feed-forward:069984c0e1",
  "candidate:in-place-multiplication:b6f8aa1086",
  "candidate:karatsuba-multiplication:5a4315a13f",
  "candidate:toffoli-gate-network:d8fb823289",
  "candidate:fermat-inversion:b1eff02f73",
  "candidate:windowed-arithmetic:6c2d57bb8b",
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["classification", "decision", "ideaIds", "matches", "caveats"],
  properties: {
    classification: { type: "string", enum: ["prior_attempt", "no_prior_attempt", "uncertain"] },
    decision: { type: "string", enum: ["reject_duplicate", "investigate_novel", "uncertain"] },
    ideaIds: { type: "array", items: { type: "string", minLength: 1 } },
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["changeId", "submissionId", "status", "outcome", "sourceRefs"],
        properties: {
          changeId: { type: "string", minLength: 1 },
          submissionId: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["promoted", "rejected", "failed", "promotion failed"] },
          outcome: { type: "string", minLength: 1 },
          sourceRefs: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        },
      },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
});

function requireObject(value, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function requireExactKeys(value, keys, context) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${context} must contain exactly ${expected.join(", ")}`);
  }
}

function requireString(value, context) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${context} must be a non-empty string`);
  return value;
}

function requireEnum(value, allowed, context) {
  if (!allowed.includes(value)) throw new Error(`${context} must be one of ${allowed.join(", ")}`);
  return value;
}

function requireStringArray(value, context, { nonempty = false } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) throw new Error(`${context} must be ${nonempty ? "a non-empty" : "an"} array`);
  const strings = value.map((item, index) => requireString(item, `${context}[${index}]`));
  if (new Set(strings).size !== strings.length) throw new Error(`${context} must not contain duplicates`);
  return strings;
}

export function recordedOutcome(submission) {
  return requireString(submission.classification, `submission ${submission.id}.classification`);
}

export function submissionSourceRef(submissionId) {
  return `submission:${submissionId}`;
}

export function changeSourceRef(submissionId, changeId) {
  return `change:${submissionId}:${changeId}`;
}

export function detailSourceRef(detailShard, submissionId) {
  return `detail:${detailShard}#${submissionId}`;
}

export function witnessSourceRef(witnessId) {
  return `witness:${witnessId}`;
}

export function routeSourceRef(submissionId) {
  return `route:${submissionId}`;
}

function parseGold(value, context) {
  const gold = requireObject(value, context);
  requireExactKeys(gold, ["classification", "decision", "ideaIds", "acceptableMatches"], context);
  const classification = requireEnum(gold.classification, ["prior_attempt", "no_prior_attempt"], `${context}.classification`);
  const decision = requireEnum(gold.decision, ["reject_duplicate", "investigate_novel"], `${context}.decision`);
  if ((classification === "prior_attempt") !== (decision === "reject_duplicate")) {
    throw new Error(`${context} classification and decision disagree`);
  }
  const ideaIds = requireStringArray(gold.ideaIds, `${context}.ideaIds`, { nonempty: true }).sort();
  if (!Array.isArray(gold.acceptableMatches)) throw new Error(`${context}.acceptableMatches must be an array`);
  const acceptableMatches = gold.acceptableMatches.map((candidate, index) => (
    parseReceipt(candidate, `${context}.acceptableMatches[${index}]`)
  ));
  if (classification === "prior_attempt" && acceptableMatches.length === 0) throw new Error(`${context} positive case has no acceptable match`);
  if (classification === "no_prior_attempt" && acceptableMatches.length !== 0) throw new Error(`${context} negative case must not contain matches`);
  return { classification, decision, ideaIds, acceptableMatches };
}

function parseReceipt(value, context) {
  const receipt = requireObject(value, context);
  requireExactKeys(receipt, ["changeId", "submissionId", "status", "outcome", "sourceRefs"], context);
  return {
    changeId: requireString(receipt.changeId, `${context}.changeId`),
    submissionId: requireString(receipt.submissionId, `${context}.submissionId`),
    status: requireEnum(receipt.status, ["promoted", "rejected", "failed", "promotion failed"], `${context}.status`),
    outcome: requireString(receipt.outcome, `${context}.outcome`),
    sourceRefs: requireStringArray(receipt.sourceRefs, `${context}.sourceRefs`, { nonempty: true }).sort(),
  };
}

function parseRetrieval(value, classification, context) {
  const retrieval = requireObject(value, context);
  requireExactKeys(retrieval, ["searchProbes", "negativeNeighbors"], context);
  const searchProbes = requireStringArray(retrieval.searchProbes, `${context}.searchProbes`, { nonempty: true });
  if (searchProbes.length > CASE_SEARCH_PROBE_LIMIT) {
    throw new Error(`${context}.searchProbes may contain at most ${CASE_SEARCH_PROBE_LIMIT} probes`);
  }
  if (!Array.isArray(retrieval.negativeNeighbors)) throw new Error(`${context}.negativeNeighbors must be an array`);
  const negativeNeighbors = retrieval.negativeNeighbors.map((receipt, index) => (
    parseReceipt(receipt, `${context}.negativeNeighbors[${index}]`)
  ));
  if (classification === "prior_attempt" && negativeNeighbors.length !== 0) {
    throw new Error(`${context}.negativeNeighbors must be empty for a positive case`);
  }
  if (classification === "no_prior_attempt" && negativeNeighbors.length !== NEGATIVE_NEIGHBOR_COUNT) {
    throw new Error(`${context}.negativeNeighbors must contain exactly ${NEGATIVE_NEIGHBOR_COUNT} receipts for a negative case`);
  }
  return { searchProbes, negativeNeighbors };
}

function parseCase(value, context) {
  const candidate = requireObject(value, context);
  requireExactKeys(candidate, ["id", "query", "directionBlockId", "strata", "gold", "reviews", "retrieval"], context);
  const strata = requireObject(candidate.strata, `${context}.strata`);
  requireExactKeys(strata, ["lexicalOverlap", "witnessRole", "evidenceScope"], `${context}.strata`);
  const gold = parseGold(candidate.gold, `${context}.gold`);
  const retrieval = parseRetrieval(candidate.retrieval, gold.classification, `${context}.retrieval`);
  if (!Array.isArray(candidate.reviews) || candidate.reviews.length !== 2) throw new Error(`${context}.reviews must contain exactly two reviews`);
  const reviews = candidate.reviews.map((value, index) => {
    const reviewContext = `${context}.reviews[${index}]`;
    const review = requireObject(value, reviewContext);
    requireExactKeys(review, ["reviewerId", "decisionSha256", "rationale"], reviewContext);
    return {
      reviewerId: requireString(review.reviewerId, `${reviewContext}.reviewerId`),
      decisionSha256: requireString(review.decisionSha256, `${reviewContext}.decisionSha256`),
      rationale: requireString(review.rationale, `${reviewContext}.rationale`),
    };
  });
  if (reviews[0].reviewerId === reviews[1].reviewerId) throw new Error(`${context} reviewers must be distinct`);
  const decisionSha256 = sha256({ gold, negativeNeighbors: retrieval.negativeNeighbors });
  if (reviews.some((review) => review.decisionSha256 !== decisionSha256)) throw new Error(`${context} reviewer decisions do not match the gold and neighbor decision`);
  return {
    id: requireString(candidate.id, `${context}.id`),
    query: requireString(candidate.query, `${context}.query`),
    directionBlockId: requireString(candidate.directionBlockId, `${context}.directionBlockId`),
    retrieval,
    strata: {
      lexicalOverlap: requireEnum(strata.lexicalOverlap, ["low", "ordinary"], `${context}.strata.lexicalOverlap`),
      witnessRole: requireEnum(strata.witnessRole, ["representative", "nonrepresentative", "none"], `${context}.strata.witnessRole`),
      evidenceScope: requireEnum(strata.evidenceScope, ["focused", "bundled", "none"], `${context}.strata.evidenceScope`),
    },
    gold,
    reviews,
  };
}

function frozenFixtureValue(fixture) {
  const { fixtureSha256: _ignored, ...frozen } = fixture;
  return frozen;
}

export function validateCaseFixture(value, evidenceIndex = null) {
  const fixture = requireObject(value, "case fixture");
  requireExactKeys(fixture, ["schema", "schemaVersion", "protocolVersion", "release", "frozenAt", "fixtureSha256", "pilot", "confirmatory"], "case fixture");
  if (fixture.schema !== "yukon.atlas-duplicate-cases" || fixture.schemaVersion !== 2) throw new Error("case fixture schema must be yukon.atlas-duplicate-cases v2");
  if (fixture.protocolVersion !== ATLAS_DUPLICATE_PROTOCOL_VERSION) throw new Error(`case fixture protocol must be ${ATLAS_DUPLICATE_PROTOCOL_VERSION}`);
  const release = requireObject(fixture.release, "case fixture.release");
  requireExactKeys(release, ["id", "manifestSha256"], "case fixture.release");
  if (release.id !== PINNED_RELEASE_ID || release.manifestSha256 !== PINNED_MANIFEST_SHA256) throw new Error("case fixture does not name the pinned Atlas release and manifest");
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(requireString(fixture.frozenAt, "case fixture.frozenAt")) || !Number.isFinite(Date.parse(fixture.frozenAt))) {
    throw new Error("case fixture.frozenAt must be an ISO timestamp");
  }
  if (!/^[0-9a-f]{64}$/u.test(fixture.fixtureSha256)) throw new Error("case fixture.fixtureSha256 must be a SHA-256 digest");
  if (sha256(frozenFixtureValue(fixture)) !== fixture.fixtureSha256) throw new Error("case fixture frozen hash differs from its content");
  if (!Array.isArray(fixture.pilot) || fixture.pilot.length !== PILOT_CASES) throw new Error(`case fixture must contain exactly ${PILOT_CASES} pilot cases`);
  if (!Array.isArray(fixture.confirmatory) || fixture.confirmatory.length !== CONFIRMATORY_CASES) throw new Error(`case fixture must contain exactly ${CONFIRMATORY_CASES} confirmatory cases`);
  const pilot = fixture.pilot.map((item, index) => parseCase(item, `case fixture.pilot[${index}]`));
  const confirmatory = fixture.confirmatory.map((item, index) => parseCase(item, `case fixture.confirmatory[${index}]`));
  const all = [...pilot, ...confirmatory];
  if (new Set(all.map((item) => item.id)).size !== all.length) throw new Error("case IDs must be unique across pilot and confirmatory cases");
  if (new Set(confirmatory.map((item) => item.directionBlockId)).size !== confirmatory.length) throw new Error("confirmatory directionBlockId values must be distinct");
  if (pilot.some((item) => V3_PILOT_DIRECTION_BLOCKS.has(item.directionBlockId))) {
    throw new Error("pilot cases must be fresh relative to the discarded v3 pilot");
  }
  const confirmatoryDirections = new Set(confirmatory.map((item) => item.directionBlockId));
  if (pilot.some((item) => confirmatoryDirections.has(item.directionBlockId))) {
    throw new Error("pilot directionBlockId values must not overlap the frozen confirmatory court");
  }
  const pilotPositives = pilot.filter((item) => item.gold.classification === "prior_attempt");
  const pilotNegatives = pilot.filter((item) => item.gold.classification === "no_prior_attempt");
  if (pilotPositives.length !== PILOT_POSITIVES || pilotNegatives.length !== PILOT_NEGATIVES) {
    throw new Error(`pilot cases must contain ${PILOT_POSITIVES} positive and ${PILOT_NEGATIVES} negative cases`);
  }
  const positives = confirmatory.filter((item) => item.gold.classification === "prior_attempt");
  const negatives = confirmatory.filter((item) => item.gold.classification === "no_prior_attempt");
  if (positives.length !== CONFIRMATORY_POSITIVES || negatives.length !== CONFIRMATORY_NEGATIVES) {
    throw new Error(`confirmatory cases must contain ${CONFIRMATORY_POSITIVES} positive and ${CONFIRMATORY_NEGATIVES} negative cases`);
  }
  if (confirmatory.filter((item) => item.strata.witnessRole === "nonrepresentative").length < 6) throw new Error("confirmatory cases need at least six nonrepresentative witnesses");
  if (!confirmatory.some((item) => item.strata.evidenceScope === "focused") || !confirmatory.some((item) => item.strata.evidenceScope === "bundled")) {
    throw new Error("confirmatory cases must cover focused and bundled evidence");
  }
  if (!confirmatory.some((item) => item.strata.lexicalOverlap === "low")) throw new Error("confirmatory cases must include low-overlap queries");
  if (evidenceIndex !== null) validateFixtureEvidence(all, evidenceIndex);
  return { ...fixture, release: { ...release }, pilot, confirmatory };
}

function validateFixtureEvidence(cases, evidenceIndex) {
  for (const candidate of cases) {
    for (const ideaId of candidate.gold.ideaIds) {
      if (!evidenceIndex.ideaIds.has(ideaId)) throw new Error(`case ${candidate.id} references unknown idea ${ideaId}`);
    }
    for (const match of candidate.gold.acceptableMatches) {
      const expected = evidenceIndex.matchByKey.get(`${match.submissionId}\0${match.changeId}`);
      if (expected === undefined) throw new Error(`case ${candidate.id} references unknown match ${match.submissionId}/${match.changeId}`);
      if (expected.status !== match.status || expected.outcome !== match.outcome) throw new Error(`case ${candidate.id} match outcome differs from the pinned release`);
      if (!expected.ideaIds.some((ideaId) => candidate.gold.ideaIds.includes(ideaId))) {
        throw new Error(`case ${candidate.id} match is not routed to one of its gold Ideas`);
      }
      if (!arraysEqual(match.sourceRefs, expected.sourceRefs)) {
        throw new Error(`case ${candidate.id} match must contain the full linked source-reference set`);
      }
    }
    for (const neighbor of candidate.retrieval.negativeNeighbors) {
      const expected = evidenceIndex.matchByKey.get(`${neighbor.submissionId}\0${neighbor.changeId}`);
      if (expected === undefined) throw new Error(`case ${candidate.id} references unknown negative neighbor ${neighbor.submissionId}/${neighbor.changeId}`);
      if (expected.status !== neighbor.status || expected.outcome !== neighbor.outcome) {
        throw new Error(`case ${candidate.id} negative-neighbor outcome differs from the pinned release`);
      }
      if (!arraysEqual(neighbor.sourceRefs, expected.sourceRefs)) {
        throw new Error(`case ${candidate.id} negative neighbor must contain the full linked source-reference set`);
      }
    }
  }
}

function submissionDetail(detailsBySubmission, submissionId) {
  return detailsBySubmission.get(submissionId)?.submissionById?.get(submissionId) ?? null;
}

function receiptSourceRefs(submission, change, { detail, route, witness }) {
  const refs = [
    submissionSourceRef(submission.id),
    changeSourceRef(submission.id, change.id),
  ];
  if (witness !== undefined) refs.push(witnessSourceRef(witness.witnessId));
  if (route !== undefined) refs.push(routeSourceRef(submission.id));
  if (detail !== null) refs.push(detailSourceRef(submission.detailShard, submission.id));
  return refs.sort();
}

export function buildEvidenceIndex(release, detailsBySubmission = new Map()) {
  const ideaIds = new Set(release.decomposition?.ideas.map((idea) => idea.ideaId) ?? []);
  const sourceRefs = new Set();
  const matchByKey = new Map();
  for (const submission of release.submissions.submissions) {
    sourceRefs.add(submissionSourceRef(submission.id));
    const detail = submissionDetail(detailsBySubmission, submission.id);
    if (detail !== null) sourceRefs.add(detailSourceRef(submission.detailShard, submission.id));
    const route = release.submissionRouteById?.get(submission.id);
    if (route !== undefined) sourceRefs.add(routeSourceRef(submission.id));
    for (const change of submission.changes) {
      sourceRefs.add(changeSourceRef(submission.id, change.id));
      const witness = release.mutationWitnessById?.get(change.id);
      if (witness !== undefined) sourceRefs.add(witnessSourceRef(witness.witnessId));
      let witnessIdeaIds = [];
      if (witness?.ideaIds.length > 0) witnessIdeaIds = witness.ideaIds;
      else if (witness?.mappingIdeaId != null) witnessIdeaIds = [witness.mappingIdeaId];
      matchByKey.set(`${submission.id}\0${change.id}`, {
        submissionId: submission.id,
        changeId: change.id,
        status: submission.status,
        outcome: recordedOutcome(submission),
        ideaIds: witnessIdeaIds,
        sourceRefs: receiptSourceRefs(submission, change, { detail, route, witness }),
      });
    }
  }
  return { ideaIds, sourceRefs, matchByKey };
}

export function buildAttemptFacts(release, detailsBySubmission = new Map()) {
  const facts = [];
  for (const witness of release.decomposition?.mutationWitnesses ?? []) {
    const submission = release.submissionById.get(witness.submissionId);
    const change = submission?.changes.find((candidate) => candidate.id === witness.witnessId);
    const route = release.submissionRouteById?.get(witness.submissionId);
    if (submission === undefined || change === undefined || route === undefined) continue;
    const detail = submissionDetail(detailsBySubmission, submission.id);
    const ideaIds = witness.ideaIds.length > 0 ? witness.ideaIds : witness.mappingIdeaId === null ? [] : [witness.mappingIdeaId];
    for (const ideaId of ideaIds) {
      const idea = release.decompositionIdeaById?.get(ideaId);
      if (idea === undefined) continue;
      const refs = receiptSourceRefs(submission, change, { detail, route, witness });
      facts.push({
        recordId: `attempt:${submission.id}:${change.id}:${ideaId}`,
        ideaId,
        ideaTitle: idea.title,
        ideaSummary: idea.summary,
        submissionId: submission.id,
        changeId: change.id,
        title: change.title,
        description: change.description,
        site: change.site,
        relation: change.relation,
        status: submission.status,
        outcome: recordedOutcome(submission),
        sourceRefs: refs,
        route: {
          ideaIds: route.ideaIds,
          constraintIds: route.constraintIds,
          interpretation: route.interpretation,
          policyCoupled: route.policyCoupled,
          hasUnresolved: route.hasUnresolved,
        },
        review: { disposition: witness.reviewDisposition, note: witness.reviewNote },
      });
    }
  }
  return facts.sort((left, right) => compareText(left.recordId, right.recordId));
}

function searchableText(value) {
  return canonicalStringify(value).toLowerCase();
}

function record(id, kind, label, body, searchText = null) {
  return { id, kind, label, searchText: searchText ?? searchableText(body), body };
}

function sourceAtomsForFacts(facts) {
  return [...new Set(facts.flatMap((fact) => fact.sourceRefs))].sort();
}

function rawReleaseRecords(release, detailsBySubmission) {
  const records = [];
  for (const submission of release.submissions.submissions) {
    records.push(record(
      `raw:submission:${submission.id}`,
      "raw_submission",
      submission.id,
      { ...submission, changes: undefined, sourceRef: submissionSourceRef(submission.id) },
    ));
    for (const change of submission.changes) {
      records.push(record(
        `raw:change:${submission.id}:${change.id}`,
        "raw_change",
        change.id,
        { submissionId: submission.id, ...change, sourceRef: changeSourceRef(submission.id, change.id) },
      ));
    }
    const detail = detailsBySubmission.get(submission.id)?.submissionById?.get(submission.id);
    if (detail !== undefined) {
      records.push(record(
        `raw:detail:${submission.id}`,
        "raw_submission_detail",
        submission.detailShard,
        { detailShard: submission.detailShard, ...detail, sourceRef: detailSourceRef(submission.detailShard, submission.id) },
      ));
    }
  }
  for (const witness of release.decomposition?.mutationWitnesses ?? []) {
    records.push(record(
      `raw:witness:${witness.witnessId}`,
      "raw_mutation_witness",
      witness.witnessId,
      { ...witness, sourceRef: witnessSourceRef(witness.witnessId) },
    ));
  }
  for (const route of release.decomposition?.submissionRoutes ?? []) {
    records.push(record(
      `raw:route:${route.submissionId}`,
      "raw_submission_route",
      route.submissionId,
      { ...route, sourceRef: routeSourceRef(route.submissionId) },
    ));
  }
  for (const [kind, values, id] of [
    ["area", release.decomposition?.areas ?? [], "areaId"],
    ["constraint", release.decomposition?.constraints ?? [], "constraintId"],
    ["idea", release.decomposition?.ideas ?? [], "ideaId"],
    ["link", release.decomposition?.links ?? [], "linkId"],
    ["dossier", release.decomposition?.dossiers ?? [], "ideaId"],
    ["constraint_assessment", release.decomposition?.constraintAssessments ?? [], "constraintId"],
  ]) {
    for (const value of values) {
      const rawId = value[id];
      records.push(record(`raw:${kind}:${rawId}`, `raw_${kind}`, rawId, value));
    }
  }
  return records.sort((left, right) => compareText(left.id, right.id));
}

export function materializeConditionCorpora(release, detailsBySubmission, directionCompiler) {
  const buildIdeaEvidenceBrief = directionCompiler?.buildAtlasIdeaEvidenceBrief
    ?? directionCompiler?.buildAtlasDirectionBrief;
  const listIdeaAttempts = directionCompiler?.listAtlasIdeaAttempts
    ?? directionCompiler?.listAtlasDirectionAttempts;
  if (typeof buildIdeaEvidenceBrief !== "function" || typeof listIdeaAttempts !== "function") {
    throw new Error("Atlas idea-evidence compiler is unavailable");
  }
  const facts = buildAttemptFacts(release, detailsBySubmission);
  const factByPlacement = new Map(facts.map((fact) => [
    `${fact.submissionId}\0${fact.changeId}\0${fact.ideaId}`,
    fact,
  ]));
  const sourceAtoms = sourceAtomsForFacts(facts);
  const rawRecords = rawReleaseRecords(release, detailsBySubmission);
  const flatRecords = [...rawRecords];
  const flatPlusBriefRecords = [...rawRecords];
  const pages = {};
  for (const idea of [...(release.decomposition?.ideas ?? [])].sort((left, right) => compareText(left.ideaId, right.ideaId))) {
    const brief = buildIdeaEvidenceBrief(release, idea.ideaId);
    const firstPageCursor = `attempts:${idea.ideaId}:0`;
    const compactAttempt = (attempt) => {
      const fact = factByPlacement.get(`${attempt.submissionId}\0${attempt.changeId}\0${idea.ideaId}`);
      if (fact === undefined) throw new Error(`compiler attempt is missing its flat fact: ${attempt.submissionId}/${attempt.changeId}/${idea.ideaId}`);
      return {
        submissionId: fact.submissionId,
        changeId: fact.changeId,
        ideaId: fact.ideaId,
        title: fact.title,
        description: fact.description,
        site: fact.site,
        relation: fact.relation,
        status: fact.status,
        outcome: fact.outcome,
        sourceRefs: fact.sourceRefs,
        qualification: attempt.qualification,
        route: {
          interpretation: fact.route.interpretation,
          policyCoupled: fact.route.policyCoupled,
          hasUnresolved: fact.route.hasUnresolved,
        },
        review: fact.review,
      };
    };
    const compactOutcomeExample = (attempt) => {
      const compact = compactAttempt(attempt);
      return {
        submissionId: compact.submissionId,
        changeId: compact.changeId,
        title: compact.title,
        status: compact.status,
        outcome: compact.outcome,
        sourceRefs: compact.sourceRefs,
        qualification: compact.qualification,
      };
    };
    const compactChildConstraint = (constraint) => ({
      constraintId: constraint.constraintId,
      label: constraint.label,
      summary: constraint.summary,
      reviewStatus: constraint.reviewStatus,
      evidenceRefs: constraint.evidenceRefs,
      assessment: constraint.assessment === null ? null : {
        assessmentId: constraint.assessment.assessmentId,
        status: constraint.assessment.status,
        metric: {
          label: constraint.assessment.metric.label,
          unit: constraint.assessment.metric.unit,
          direction: constraint.assessment.metric.direction,
        },
        baselineValue: constraint.assessment.baseline.value,
        frontierValue: constraint.assessment.frontier.value,
        limit: constraint.assessment.limit,
        progress: constraint.assessment.progress,
      },
      linkedIdeaIds: constraint.linkedIdeas.map((linked) => linked.ideaId),
    });
    const ideaRecordId = `idea:${idea.ideaId}`;
    const ideaSearchText = `${idea.title}\n${idea.summary}`.toLowerCase();
    const commonIdeaBody = {
      idea: brief.idea,
      primaryPath: brief.primaryPath,
      placements: brief.placements,
      attemptPageCursor: firstPageCursor,
    };
    flatRecords.push(record(
      ideaRecordId,
      "idea_direction",
      idea.title,
      commonIdeaBody,
      ideaSearchText,
    ));
    flatPlusBriefRecords.push(record(
      ideaRecordId,
      "idea_direction",
      idea.title,
      {
        ...commonIdeaBody,
        evidenceBrief: {
          schema: brief.schema,
          schemaVersion: brief.schemaVersion,
          release: {
            releaseId: brief.release.releaseId,
            manifestSha256: brief.release.manifestSha256,
          },
          approaches: brief.approaches,
          variationGroups: brief.variationGroups,
          coverage: brief.coverage,
          outcomeExamples: brief.outcomeExamples.map(compactOutcomeExample),
          childConstraints: brief.childConstraints.map(compactChildConstraint),
          caveats: brief.caveats,
          verification: brief.verification,
        },
      },
      ideaSearchText,
    ));
    let cursor = null;
    let pageIndex = 0;
    do {
      const page = listIdeaAttempts(release, idea.ideaId, { limit: 5, ...(cursor === null ? {} : { cursor }) });
      const pageCursor = `attempts:${idea.ideaId}:${pageIndex}`;
      const compilerCursor = page.page.nextCursor;
      pages[pageCursor] = {
        schema: page.schema,
        schemaVersion: page.schemaVersion,
        release: {
          releaseId: page.release.releaseId,
          manifestSha256: page.release.manifestSha256,
        },
        idea: page.idea,
        filter: page.filter,
        items: page.items.map(compactAttempt),
        page: {
          ...page.page,
          nextCursor: compilerCursor === null ? null : `attempts:${idea.ideaId}:${pageIndex + 1}`,
        },
      };
      cursor = compilerCursor;
      pageIndex += 1;
    } while (cursor !== null);
  }
  const attemptRecords = facts.map((fact) => record(fact.recordId, "flat_attempt", `${fact.ideaTitle}: ${fact.title}`, fact));
  flatRecords.push(...attemptRecords);
  flatPlusBriefRecords.push(...attemptRecords);
  const base = {
    schema: "yukon.atlas-query-corpus",
    schemaVersion: 1,
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    releaseId: PINNED_RELEASE_ID,
    sourceAtoms,
    sourceRecordIds: rawRecords.map((entry) => entry.id),
  };
  return {
    raw: { ...base, condition: "raw", records: rawRecords, searchRecordIds: rawRecords.map((entry) => entry.id), pages: {} },
    flat: {
      ...base,
      condition: "flat",
      records: flatRecords,
      searchRecordIds: flatRecords.filter((entry) => entry.kind === "idea_direction" || entry.kind === "flat_attempt").map((entry) => entry.id),
      pages,
    },
    flat_plus_brief: {
      ...base,
      condition: "flat_plus_brief",
      records: flatPlusBriefRecords,
      searchRecordIds: flatPlusBriefRecords.filter((entry) => entry.kind === "idea_direction" || entry.kind === "flat_attempt").map((entry) => entry.id),
      pages,
    },
  };
}

function arraysEqual(left, right) {
  return canonicalStringify([...left].sort()) === canonicalStringify([...right].sort());
}

function matchKey(match) {
  return `${match.submissionId}\0${match.changeId}`;
}

export function validateResponse(value) {
  const response = requireObject(value, "agent response");
  requireExactKeys(response, ["classification", "decision", "ideaIds", "matches", "caveats"], "agent response");
  const classification = requireEnum(response.classification, ["prior_attempt", "no_prior_attempt", "uncertain"], "agent response.classification");
  const decision = requireEnum(response.decision, ["reject_duplicate", "investigate_novel", "uncertain"], "agent response.decision");
  const ideaIds = requireStringArray(response.ideaIds, "agent response.ideaIds");
  if (!Array.isArray(response.matches)) throw new Error("agent response.matches must be an array");
  const matches = response.matches.map((match, index) => parseGold({
    classification: "prior_attempt",
    decision: "reject_duplicate",
    ideaIds: ["placeholder"],
    acceptableMatches: [match],
  }, `agent response match wrapper ${index}`).acceptableMatches[0]);
  const caveats = requireStringArray(response.caveats, "agent response.caveats");
  return { classification, decision, ideaIds, matches, caveats };
}

export function scoreCaseResponse(candidate, responseValue, evidenceIndex, audit = {}) {
  const failures = [];
  let response = null;
  try {
    response = validateResponse(responseValue);
  } catch (error) {
    failures.push(error.message);
  }
  let fabricated = false;
  let negativeFalsePositive = false;
  let decisionCorrect = false;
  let citationCorrect = false;
  if (response !== null) {
    if (response.classification !== candidate.gold.classification) failures.push("classification differs from gold");
    if (response.decision !== candidate.gold.decision) failures.push("decision differs from gold");
    const linkedIdeaIds = new Set(candidate.gold.ideaIds);
    for (const match of response.matches) {
      const known = evidenceIndex.matchByKey.get(matchKey(match));
      if (known !== undefined) {
        for (const ideaId of known.ideaIds ?? []) linkedIdeaIds.add(ideaId);
      }
      const allowedSourceRefs = new Set(known?.sourceRefs ?? []);
      if (known === undefined || match.sourceRefs.some((ref) => !allowedSourceRefs.has(ref))) fabricated = true;
    }
    if (response.ideaIds.some((ideaId) => !evidenceIndex.ideaIds.has(ideaId))) fabricated = true;
    const unlinkedIdeas = response.ideaIds.filter((ideaId) => !linkedIdeaIds.has(ideaId));
    if (unlinkedIdeas.length > 0) failures.push("response contains a real but unlinked Idea");
    if (candidate.gold.classification === "prior_attempt" && response.ideaIds.length === 0) {
      failures.push("positive case returned no linked Idea");
    }
    if (fabricated) failures.push("response contains a fabricated ID or source reference");
    if (candidate.gold.classification === "no_prior_attempt") {
      negativeFalsePositive = response.matches.length > 0 || response.classification === "prior_attempt";
      if (response.matches.length !== 0) failures.push("negative case returned a match");
      if (response.ideaIds.some((ideaId) => !candidate.gold.ideaIds.includes(ideaId))) {
        failures.push("negative case returned an unlinked Idea");
      }
      decisionCorrect = response.classification === candidate.gold.classification
        && response.decision === candidate.gold.decision
        && response.matches.length === 0
        && response.ideaIds.every((ideaId) => candidate.gold.ideaIds.includes(ideaId));
      citationCorrect = response.matches.length === 0;
    } else {
      const acceptable = new Map(candidate.gold.acceptableMatches.map((match) => [matchKey(match), match]));
      if (response.matches.length === 0) failures.push("positive case returned no match");
      for (const match of response.matches) {
        const expected = acceptable.get(matchKey(match));
        const citesChosenReceipt = expected !== undefined
          && match.sourceRefs.every((sourceRef) => expected.sourceRefs.includes(sourceRef));
        if (expected === undefined || expected.status !== match.status || expected.outcome !== match.outcome || !citesChosenReceipt) {
          failures.push(`match ${match.submissionId}/${match.changeId} is not an exact acceptable match`);
        }
      }
      decisionCorrect = response.classification === candidate.gold.classification
        && response.decision === candidate.gold.decision
        && response.matches.length > 0
        && response.matches.every((match) => {
          const expected = acceptable.get(matchKey(match));
          return expected !== undefined && expected.status === match.status && expected.outcome === match.outcome;
        })
        && response.ideaIds.length > 0
        && unlinkedIdeas.length === 0;
      citationCorrect = response.matches.length > 0 && response.matches.every((match) => {
        const known = evidenceIndex.matchByKey.get(matchKey(match));
        return known !== undefined
          && match.sourceRefs.length > 0
          && match.sourceRefs.every((sourceRef) => known.sourceRefs.includes(sourceRef));
      });
    }
  }
  if (audit.valid === false) failures.push(...(audit.violations ?? ["session audit failed"]));
  const observedReceipts = audit.retrieval?.receipts ?? [];
  const searchResultIds = audit.retrieval?.searchResultIds ?? [];
  const relevantToReceipt = (id, receipt) => id.includes(receipt.submissionId) || id.includes(receipt.changeId);
  const targetReceipts = candidate.gold.classification === "prior_attempt"
    ? candidate.gold.acceptableMatches
    : candidate.retrieval?.negativeNeighbors ?? [];
  const discoveredTargets = targetReceipts.filter((target) => (
    searchResultIds.some((id) => relevantToReceipt(id, target))
    || observedReceipts.some((observed) => matchKey(observed) === matchKey(target))
  ));
  const evidencedTargets = targetReceipts.filter((target) => observedReceipts.some((observed) => (
    matchKey(observed) === matchKey(target)
    && observed.status === target.status
    && observed.outcome === target.outcome
    && observed.sourceRefs.some((sourceRef) => target.sourceRefs.includes(sourceRef))
  )));
  const discovery = candidate.gold.classification === "prior_attempt"
    ? discoveredTargets.length > 0
    : discoveredTargets.length === targetReceipts.length;
  const evidence = candidate.gold.classification === "prior_attempt"
    ? evidencedTargets.length > 0
    : evidencedTargets.length === targetReceipts.length;
  const protocol = audit.valid !== false;
  const wholeAnswer = failures.length === 0;
  return {
    pass: wholeAnswer,
    wholeAnswer,
    discovery,
    evidence,
    decision: decisionCorrect,
    citation: citationCorrect,
    protocol,
    failures: [...new Set(failures)],
    fabricated,
    negativeFalsePositive,
  };
}

function binomialCoefficient(n, k) {
  const smaller = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= smaller; index += 1) result = result * (n - smaller + index) / index;
  return result;
}

export function exactMcNemar(controlPasses, treatmentPasses) {
  if (controlPasses.length !== treatmentPasses.length) throw new Error("paired McNemar inputs must have equal length");
  let controlOnly = 0;
  let treatmentOnly = 0;
  for (let index = 0; index < controlPasses.length; index += 1) {
    if (controlPasses[index] && !treatmentPasses[index]) controlOnly += 1;
    if (!controlPasses[index] && treatmentPasses[index]) treatmentOnly += 1;
  }
  const discordant = controlOnly + treatmentOnly;
  if (discordant === 0) return { controlOnly, treatmentOnly, discordant, pValue: 1 };
  const tail = Math.min(controlOnly, treatmentOnly);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) probability += binomialCoefficient(discordant, index) / 2 ** discordant;
  return { controlOnly, treatmentOnly, discordant, pValue: Math.min(1, 2 * probability) };
}

function repeatKeys(candidateId, condition, model) {
  return Array.from({ length: REPEAT_COUNT }, (_, repeatIndex) => (
    `${candidateId}:${condition}:${model}:r${repeatIndex + 1}`
  ));
}

function modelConditionPasses(cases, results, model, condition) {
  return cases.map((candidate) => (
    repeatKeys(candidate.id, condition, model)
      .map((key) => Boolean(results.get(key)?.score?.pass))
      .filter(Boolean)
      .length >= 2
  ));
}

function stratumNoRegression(cases, control, treatment, predicate) {
  const indexes = cases.map((candidate, index) => predicate(candidate) ? index : -1).filter((index) => index >= 0);
  return indexes.reduce((total, index) => total + Number(treatment[index]), 0)
    >= indexes.reduce((total, index) => total + Number(control[index]), 0);
}

export function analyzeConfirmatoryResults(cases, results) {
  if (cases.length !== CONFIRMATORY_CASES) throw new Error(`analysis requires ${CONFIRMATORY_CASES} confirmatory cases`);
  const passes = Object.fromEntries(ATLAS_DUPLICATE_MODELS.map((model) => [model, Object.fromEntries(
    CONDITIONS.map((condition) => [condition, modelConditionPasses(cases, results, model, condition)]),
  )]));
  const comparisons = Object.fromEntries(ATLAS_DUPLICATE_MODELS.flatMap((model) => [
    [`${model}:flat_vs_raw`, { model, control: "raw", treatment: "flat", ...exactMcNemar(passes[model].raw, passes[model].flat) }],
    [`${model}:flat_plus_brief_vs_flat`, {
      model,
      control: "flat",
      treatment: "flat_plus_brief",
      ...exactMcNemar(passes[model].flat, passes[model].flat_plus_brief),
    }],
  ]));
  const adjusted = holmAdjust(Object.fromEntries(Object.entries(comparisons).map(([key, value]) => [key, value.pValue])));
  for (const [key, comparison] of Object.entries(comparisons)) {
    const control = passes[comparison.model][comparison.control];
    const treatment = passes[comparison.model][comparison.treatment];
    comparison.adjustedPValue = adjusted[key];
    comparison.liftPercentagePoints = 100 * (treatment.filter(Boolean).length - control.filter(Boolean).length) / cases.length;
    comparison.zeroFabrication = cases.every((candidate) => repeatKeys(candidate.id, comparison.treatment, comparison.model)
      .every((repeatKey) => !results.get(repeatKey)?.score?.fabricated));
    comparison.zeroNegativeFalsePositives = cases.filter((candidate) => candidate.gold.classification === "no_prior_attempt")
      .every((candidate) => repeatKeys(candidate.id, comparison.treatment, comparison.model)
        .every((repeatKey) => !results.get(repeatKey)?.score?.negativeFalsePositive));
    comparison.noLowOverlapRegression = stratumNoRegression(cases, control, treatment, (candidate) => candidate.strata.lexicalOverlap === "low");
    comparison.noNonrepresentativeRegression = stratumNoRegression(cases, control, treatment, (candidate) => candidate.strata.witnessRole === "nonrepresentative");
    comparison.supported = comparison.liftPercentagePoints >= 25
      && comparison.adjustedPValue < 0.05
      && comparison.zeroFabrication
      && comparison.zeroNegativeFalsePositives
      && comparison.noLowOverlapRegression
      && comparison.noNonrepresentativeRegression;
  }
  const decision = ATLAS_DUPLICATE_MODELS.every((model) => comparisons[`${model}:flat_plus_brief_vs_flat`].supported)
    && ATLAS_DUPLICATE_MODELS.every((model) => comparisons[`${model}:flat_vs_raw`].supported)
    ? "ADOPT_FLAT_PLUS_BRIEF"
    : ATLAS_DUPLICATE_MODELS.every((model) => comparisons[`${model}:flat_vs_raw`].supported)
      ? "ADOPT_FLAT_INDEX"
      : "RETAIN_CURRENT_ATLAS";
  return {
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    totals: Object.fromEntries(ATLAS_DUPLICATE_MODELS.map((model) => [model, Object.fromEntries(
      CONDITIONS.map((condition) => [condition, { passed: passes[model][condition].filter(Boolean).length, cases: cases.length }]),
    )])),
    comparisons,
    decision,
  };
}

export function assessPilotResults(cases, results) {
  if (cases.length !== PILOT_CASES) throw new Error(`pilot assessment requires ${PILOT_CASES} cases`);
  const passes = Object.fromEntries(ATLAS_DUPLICATE_MODELS.map((model) => [model, Object.fromEntries(
    CONDITIONS.map((condition) => [condition, modelConditionPasses(cases, results, model, condition)]),
  )]));
  const corrections = [];
  for (const model of ATLAS_DUPLICATE_MODELS) {
    for (const condition of CONDITIONS) {
      const passed = passes[model][condition].filter(Boolean).length;
      if (passed === 0) corrections.push(`${model} ${condition} is at floor`);
      if (passed === cases.length) corrections.push(`${model} ${condition} is at ceiling`);
    }
  }
  const distinguishingCases = Object.fromEntries(ATLAS_DUPLICATE_MODELS.map((model) => [model, cases.filter((candidate, index) => (
    new Set(CONDITIONS.map((condition) => passes[model][condition][index])).size > 1
  )).map((candidate) => candidate.id)]));
  if (Object.values(distinguishingCases).some((value) => value.length < 2)) {
    corrections.push("fewer than two pilot cases distinguish the conditions for at least one model");
  }
  return {
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections,
    totals: Object.fromEntries(ATLAS_DUPLICATE_MODELS.map((model) => [model, Object.fromEntries(
      CONDITIONS.map((condition) => [condition, {
        passed: passes[model][condition].filter(Boolean).length,
        cases: cases.length,
      }]),
    )])),
    distinguishingCases,
  };
}

export async function readAndValidateCaseFixture(fixturePath, evidenceIndex = null) {
  const value = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  return validateCaseFixture(value, evidenceIndex);
}

export async function writeCanonicalJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${canonicalStringify(value)}\n`);
  await fs.rename(temporary, target);
}
