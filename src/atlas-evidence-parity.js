import {
  CONDITIONS,
  PINNED_MANIFEST_SHA256,
  PINNED_RELEASE_ID,
  buildAttemptFacts,
  buildEvidenceIndex,
  materializeConditionCorpora,
} from "./atlas-duplicate-protocol.js";
import { canonicalStringify, sha256 } from "./protocol.js";

export const ATLAS_EVIDENCE_PARITY_DEFAULTS = Object.freeze({
  releaseId: PINNED_RELEASE_ID,
  manifestSha256: PINNED_MANIFEST_SHA256,
  ideas: 75,
  rawMutationWitnesses: 2_311,
  ideaRoutedRows: 2_209,
  submissionRoutes: 949,
  verifiedSubmissionDetails: 949,
  unroutedWitnessAtoms: 102,
  unroutedWithoutIdea: 83,
  unroutedMissingIdea: 19,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function allowedStatuses() {
  return new Set(["promoted", "rejected", "failed", "promotion failed"]);
}

function arraysEqual(left, right) {
  return canonicalStringify([...left].sort()) === canonicalStringify([...right].sort());
}

function rawAtomRecordId(sourceRef) {
  if (sourceRef.startsWith("detail:")) return `raw:detail:${sourceRef.slice(sourceRef.lastIndexOf("#") + 1)}`;
  return `raw:${sourceRef}`;
}

function rawSourceRefMap(rawRecords) {
  const bySourceRef = new Map();
  for (const record of rawRecords) {
    const sourceRef = record?.body?.sourceRef;
    if (typeof sourceRef === "string") bySourceRef.set(sourceRef, record.id);
  }
  return bySourceRef;
}

function corpusAccounting(corpora) {
  const rawRecordIds = new Set(corpora.raw.records.map((record) => record.id));
  const flatAtomRefs = new Set(corpora.flat.records.flatMap((record) => record.body?.sourceRefs ?? []));
  const hybridRecordIds = new Set(corpora.flat_plus_brief.records.map((record) => record.id));
  const sourceHashes = Object.fromEntries(CONDITIONS.map((condition) => [
    condition,
    sha256(corpora[condition].sourceAtoms),
  ]));
  const sourceRecordHashes = Object.fromEntries(CONDITIONS.map((condition) => [
    condition,
    sha256(corpora[condition].sourceRecordIds),
  ]));
  const sourceAtomCoverage = {
    raw: corpora.raw.sourceAtoms.every((sourceRef) => rawRecordIds.has(rawAtomRecordId(sourceRef))),
    flat: corpora.flat.sourceAtoms.every((sourceRef) => flatAtomRefs.has(sourceRef)),
    flat_plus_brief: corpora.flat_plus_brief.sourceAtoms.every((sourceRef) => hybridRecordIds.has(rawAtomRecordId(sourceRef))),
  };
  const sourceRecordCoverage = Object.fromEntries(CONDITIONS.map((condition) => {
    const ids = new Set(corpora[condition].records.map((record) => record.id));
    return [condition, corpora[condition].sourceRecordIds.every((id) => ids.has(id))];
  }));
  return {
    sourceHashes,
    sourceRecordHashes,
    sameSourceAtoms: new Set(Object.values(sourceHashes)).size === 1,
    sameSourceRecords: new Set(Object.values(sourceRecordHashes)).size === 1,
    sourceAtomCoverage,
    sourceRecordCoverage,
    rawWitnesses: corpora.raw.records.filter((record) => record.kind === "raw_mutation_witness").length,
    flatRows: corpora.flat.records.filter((record) => record.kind === "flat_attempt").length,
    flatPlusBriefRows: corpora.flat_plus_brief.records.filter((record) => record.kind === "idea_direction").length,
    flatPlusBriefPageRows: Object.values(corpora.flat_plus_brief.pages).reduce((total, page) => total + page.items.length, 0),
    uniqueRecordIds: Object.fromEntries(CONDITIONS.map((condition) => [
      condition,
      new Set(corpora[condition].records.map((record) => record.id)).size === corpora[condition].records.length,
    ])),
  };
}

export function collectWitnessAccounting(release) {
  const accounting = {
    totalWitnesses: release.decomposition?.mutationWitnesses?.length ?? 0,
    routedRows: 0,
    multiIdeaWitnesses: 0,
    unroutedWithoutIdea: 0,
    unroutedMissingIdea: 0,
    missingSubmission: 0,
    missingChange: 0,
    missingRoute: 0,
    missingIdeaIds: [],
  };
  for (const witness of release.decomposition?.mutationWitnesses ?? []) {
    const ideaIds = witness.ideaIds.length > 0 ? witness.ideaIds : witness.mappingIdeaId === null ? [] : [witness.mappingIdeaId];
    if (ideaIds.length === 0) {
      accounting.unroutedWithoutIdea += 1;
      continue;
    }
    if (ideaIds.length > 1) accounting.multiIdeaWitnesses += 1;
    const submission = release.submissionById.get(witness.submissionId);
    if (submission === undefined) {
      accounting.missingSubmission += 1;
      continue;
    }
    const change = submission.changes.find((candidate) => candidate.id === witness.witnessId);
    if (change === undefined) {
      accounting.missingChange += 1;
      continue;
    }
    if (release.submissionRouteById?.get(witness.submissionId) === undefined) {
      accounting.missingRoute += 1;
      continue;
    }
    let emitted = 0;
    for (const ideaId of ideaIds) {
      if (release.decompositionIdeaById?.get(ideaId) === undefined) {
        accounting.unroutedMissingIdea += 1;
        accounting.missingIdeaIds.push(ideaId);
        continue;
      }
      emitted += 1;
      accounting.routedRows += 1;
    }
    if (emitted === 0 && ideaIds.length === 0) accounting.unroutedWithoutIdea += 1;
  }
  accounting.totalUnroutedWitnessAtoms = accounting.unroutedWithoutIdea + accounting.unroutedMissingIdea;
  accounting.missingIdeaIds = [...new Set(accounting.missingIdeaIds)].sort(compareText);
  return accounting;
}

function collectSubmissionReferenceAudit(release, detailsBySubmission) {
  const submissions = release.submissions?.submissions ?? [];
  const knownIds = new Set(submissions.map((submission) => submission.id));
  const statusValues = allowedStatuses();
  const parentRefs = [];
  const scoreRefs = [];
  const badStatuses = [];
  for (const submission of submissions) {
    if (submission.parentId !== null && !knownIds.has(submission.parentId)) parentRefs.push(submission.id);
    if (submission.scoreComparatorId !== null && !knownIds.has(submission.scoreComparatorId)) scoreRefs.push(submission.id);
    if (!statusValues.has(submission.status)) badStatuses.push(submission.id);
  }
  const unknownDetails = [...detailsBySubmission.keys()].filter((id) => !knownIds.has(id));
  return {
    knownSubmissionIds: knownIds.size,
    invalidParentIds: parentRefs.sort(compareText),
    invalidScoreComparatorIds: scoreRefs.sort(compareText),
    invalidStatuses: badStatuses.sort(compareText),
    unknownDetailIds: unknownDetails.sort(compareText),
  };
}

function collectEvidenceResolution(release, detailsBySubmission, corpora) {
  const evidenceIndex = buildEvidenceIndex(release, detailsBySubmission);
  const rawSourceRefs = rawSourceRefMap(corpora.raw.records);
  const unresolvedSourceRefs = [...evidenceIndex.sourceRefs].filter((sourceRef) => !rawSourceRefs.has(sourceRef)).sort(compareText);
  const facts = buildAttemptFacts(release, detailsBySubmission);
  const mismatchedReceipts = [];
  for (const fact of facts) {
    const expected = evidenceIndex.matchByKey.get(`${fact.submissionId}\0${fact.changeId}`);
    if (expected === undefined) {
      mismatchedReceipts.push(`${fact.submissionId}/${fact.changeId}:missing`);
      continue;
    }
    if (expected.status !== fact.status || expected.outcome !== fact.outcome || !arraysEqual(expected.sourceRefs, fact.sourceRefs)) {
      mismatchedReceipts.push(`${fact.submissionId}/${fact.changeId}:mismatch`);
    }
  }
  const unmatchedKeys = [...evidenceIndex.matchByKey.keys()].filter((key) => {
    const [submissionId, changeId] = key.split("\0");
    return !facts.some((fact) => fact.submissionId === submissionId && fact.changeId === changeId);
  }).sort(compareText);
  return {
    sourceRefs: {
      declared: evidenceIndex.sourceRefs.size,
      unresolved: unresolvedSourceRefs,
    },
    receipts: {
      indexed: evidenceIndex.matchByKey.size,
      factRows: facts.length,
      mismatched: mismatchedReceipts.sort(compareText),
      unmatchedIndexed: unmatchedKeys,
    },
  };
}

export function analyzeAtlasEvidenceParity({
  atlas,
  release,
  detailsBySubmission,
  corpora = null,
  expected = ATLAS_EVIDENCE_PARITY_DEFAULTS,
} = {}) {
  if (atlas === undefined || release === undefined || detailsBySubmission === undefined) {
    throw new Error("atlas, release, and detailsBySubmission are required");
  }
  const materialized = corpora ?? materializeConditionCorpora(release, detailsBySubmission, atlas);
  const rematerialized = materializeConditionCorpora(release, detailsBySubmission, atlas);
  const witnessAccounting = collectWitnessAccounting(release);
  const accounting = corpusAccounting(materialized);
  const referenceAudit = collectSubmissionReferenceAudit(release, detailsBySubmission);
  const evidenceResolution = collectEvidenceResolution(release, detailsBySubmission, materialized);
  const ideas = release.decomposition?.ideas?.length ?? 0;
  const routes = release.decomposition?.submissionRoutes?.length ?? 0;
  const corrections = [];
  if (release.manifest?.releaseId !== expected.releaseId) corrections.push(`expected release ${expected.releaseId}, found ${release.manifest?.releaseId ?? "missing"}`);
  if (release.pointer?.manifestSha256 !== expected.manifestSha256) {
    corrections.push(`expected manifest hash ${expected.manifestSha256}, found ${release.pointer?.manifestSha256 ?? "missing"}`);
  }
  if (ideas !== expected.ideas) corrections.push(`expected ${expected.ideas} ideas, found ${ideas}`);
  if (witnessAccounting.totalWitnesses !== expected.rawMutationWitnesses) {
    corrections.push(`expected ${expected.rawMutationWitnesses} raw witnesses, found ${witnessAccounting.totalWitnesses}`);
  }
  if (witnessAccounting.routedRows !== expected.ideaRoutedRows) {
    corrections.push(`expected ${expected.ideaRoutedRows} routed rows, found ${witnessAccounting.routedRows}`);
  }
  if (routes !== expected.submissionRoutes) corrections.push(`expected ${expected.submissionRoutes} submission routes, found ${routes}`);
  if (detailsBySubmission.size !== expected.verifiedSubmissionDetails) {
    corrections.push(`expected ${expected.verifiedSubmissionDetails} verified details, found ${detailsBySubmission.size}`);
  }
  if (witnessAccounting.totalUnroutedWitnessAtoms !== expected.unroutedWitnessAtoms) {
    corrections.push(`expected ${expected.unroutedWitnessAtoms} unrouted witness atoms, found ${witnessAccounting.totalUnroutedWitnessAtoms}`);
  }
  if (witnessAccounting.unroutedWithoutIdea !== expected.unroutedWithoutIdea) {
    corrections.push(`expected ${expected.unroutedWithoutIdea} unmapped witness atoms, found ${witnessAccounting.unroutedWithoutIdea}`);
  }
  if (witnessAccounting.unroutedMissingIdea !== expected.unroutedMissingIdea) {
    corrections.push(`expected ${expected.unroutedMissingIdea} missing-idea witness atoms, found ${witnessAccounting.unroutedMissingIdea}`);
  }
  if (!accounting.sameSourceAtoms) corrections.push("condition corpora disagree on source atoms");
  if (!accounting.sameSourceRecords) corrections.push("condition corpora disagree on raw source records");
  if (Object.values(accounting.sourceAtomCoverage).some((covered) => !covered)) corrections.push("a condition misses at least one declared source atom");
  if (Object.values(accounting.sourceRecordCoverage).some((covered) => !covered)) corrections.push("a condition misses at least one declared raw source record");
  if (Object.values(accounting.uniqueRecordIds).some((unique) => !unique)) corrections.push("a condition contains duplicate record IDs");
  if (accounting.rawWitnesses !== witnessAccounting.totalWitnesses) corrections.push("raw corpus does not expose every mutation witness");
  if (accounting.flatRows !== witnessAccounting.routedRows) corrections.push("flat corpus row count differs from routed row count");
  if (accounting.flatPlusBriefRows !== ideas) corrections.push("flat_plus_brief corpus does not have one idea_direction record per idea");
  if (accounting.flatPlusBriefPageRows !== witnessAccounting.routedRows) corrections.push("flat_plus_brief pages do not cover every routed row");
  if (referenceAudit.invalidParentIds.length > 0) corrections.push("at least one submission parentId does not resolve");
  if (referenceAudit.invalidScoreComparatorIds.length > 0) corrections.push("at least one scoreComparatorId does not resolve");
  if (referenceAudit.invalidStatuses.length > 0) corrections.push("at least one submission status is outside the admitted set");
  if (referenceAudit.unknownDetailIds.length > 0) corrections.push("at least one detail shard maps to an unknown submission");
  if (evidenceResolution.sourceRefs.unresolved.length > 0) corrections.push("at least one declared sourceRef does not resolve to a raw record");
  if (evidenceResolution.receipts.mismatched.length > 0) corrections.push("at least one routed receipt disagrees with the evidence index");
  const byteStable = canonicalStringify(materialized) === canonicalStringify(rematerialized);
  if (!byteStable) corrections.push("condition corpora are not byte-stable");
  return {
    protocolVersion: materialized.raw.protocolVersion,
    status: corrections.length === 0 ? "PASS" : "FAIL",
    corrections: [...new Set(corrections)],
    counts: {
      ideas,
      rawMutationWitnesses: witnessAccounting.totalWitnesses,
      ideaRoutedRows: witnessAccounting.routedRows,
      submissionRoutes: routes,
      verifiedSubmissionDetails: detailsBySubmission.size,
    },
    witnessAccounting,
    corpusAccounting: accounting,
    referenceAudit,
    evidenceResolution,
    byteStability: {
      stable: byteStable,
      corpusSha256: Object.fromEntries(CONDITIONS.map((condition) => [condition, sha256(materialized[condition])])),
      rematerializedSha256: Object.fromEntries(CONDITIONS.map((condition) => [condition, sha256(rematerialized[condition])])),
    },
  };
}
