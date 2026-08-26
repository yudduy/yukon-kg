import { describe, expect, test } from "bun:test";
import {
  ATLAS_EVIDENCE_PARITY_DEFAULTS,
  analyzeAtlasEvidenceParity,
} from "../src/atlas-evidence-parity.js";
import {
  REACHABILITY_BYTE_LIMIT,
  REACHABILITY_CALL_LIMIT,
  replayNaturalTrace,
  verifyAtlasFixtureReachability,
} from "../src/atlas-reachability.js";
import {
  buildEvidenceIndex,
  materializeConditionCorpora,
} from "../src/atlas-duplicate-protocol.js";
import { loadPinnedAtlas } from "../src/atlas-duplicate-mve.js";

const loaded = await loadPinnedAtlas();
const corpora = materializeConditionCorpora(loaded.release, loaded.detailsBySubmission, loaded.atlas);
const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);

function receipt(submissionId, changeId) {
  const value = evidenceIndex.matchByKey.get(`${submissionId}\0${changeId}`);
  if (value === undefined) throw new Error(`missing test receipt ${submissionId}/${changeId}`);
  return {
    submissionId,
    changeId,
    status: value.status,
    outcome: value.outcome,
    sourceRefs: value.sourceRefs,
  };
}

describe("Atlas evidence parity", () => {
  test("reconciles the pinned v5 release and explains the 102 unrouted witness atoms mechanically", () => {
    const report = analyzeAtlasEvidenceParity({
      atlas: loaded.atlas,
      release: loaded.release,
      detailsBySubmission: loaded.detailsBySubmission,
      corpora,
    });
    expect(report.status).toBe("PASS");
    expect(report.counts).toEqual({
      ideas: ATLAS_EVIDENCE_PARITY_DEFAULTS.ideas,
      rawMutationWitnesses: ATLAS_EVIDENCE_PARITY_DEFAULTS.rawMutationWitnesses,
      ideaRoutedRows: ATLAS_EVIDENCE_PARITY_DEFAULTS.ideaRoutedRows,
      submissionRoutes: ATLAS_EVIDENCE_PARITY_DEFAULTS.submissionRoutes,
      verifiedSubmissionDetails: ATLAS_EVIDENCE_PARITY_DEFAULTS.verifiedSubmissionDetails,
    });
    expect(report.witnessAccounting.unroutedWithoutIdea).toBe(ATLAS_EVIDENCE_PARITY_DEFAULTS.unroutedWithoutIdea);
    expect(report.witnessAccounting.unroutedMissingIdea).toBe(ATLAS_EVIDENCE_PARITY_DEFAULTS.unroutedMissingIdea);
    expect(report.witnessAccounting.totalUnroutedWitnessAtoms).toBe(ATLAS_EVIDENCE_PARITY_DEFAULTS.unroutedWitnessAtoms);
    expect(report.referenceAudit.invalidParentIds).toHaveLength(0);
    expect(report.referenceAudit.invalidScoreComparatorIds).toHaveLength(0);
    expect(report.referenceAudit.invalidStatuses).toHaveLength(0);
    expect(report.evidenceResolution.sourceRefs.unresolved).toHaveLength(0);
    expect(report.evidenceResolution.receipts.mismatched).toHaveLength(0);
    expect(report.byteStability.stable).toBe(true);
  });
});

describe("Atlas mechanical reachability", () => {
  const positiveReceipt = receipt(
    "ae1e6010-c22a-4049-9067-19461c3e71a7",
    "ae1e6010-c22a-4049-9067-19461c3e71a7::m1",
  );
  const negativeNeighbors = [
    receipt("326f593f-20fa-4b33-8551-4f4057cbaeda", "326f593f-20fa-4b33-8551-4f4057cbaeda::m3"),
    receipt("1b502283-2a79-40ea-8708-eefa415b5f63", "1b502283-2a79-40ea-8708-eefa415b5f63::m6"),
  ];

  test("reaches a positive equivalent and both reviewed negative neighbors in every arm", () => {
    const cases = [
      {
        id: "positive-fermat",
        directionBlockId: "candidate:fermat-inversion:b1eff02f73",
        gold: { classification: "prior_attempt", acceptableMatches: [positiveReceipt] },
        retrieval: { searchProbes: ["Fermat inversion"], negativeNeighbors: [] },
      },
      {
        id: "negative-barrett",
        directionBlockId: "candidate:solinas-reduction:5a45b2514d",
        gold: { classification: "no_prior_attempt", acceptableMatches: [] },
        retrieval: {
          searchProbes: [
            "sparse shift reduction",
            "shifted-low field folds with symmetric square build and unbuild",
          ],
          negativeNeighbors,
        },
      },
    ];
    const report = verifyAtlasFixtureReachability(corpora, cases, evidenceIndex);
    expect(report.status).toBe("PASS");
    expect(report.readyCases).toBe(2);
    expect(report.pendingCases).toBe(0);
    for (const candidate of report.caseReports) {
      expect(candidate.status).toBe("PASS");
      for (const condition of Object.values(candidate.conditionReports)) {
        const paths = condition.targets ?? [condition.sharedPath];
        for (const path of paths) {
          expect(path.calls).toBeLessThanOrEqual(REACHABILITY_CALL_LIMIT);
          expect(path.returnedBytes).toBeLessThanOrEqual(REACHABILITY_BYTE_LIMIT);
        }
      }
    }
  });

  test("rejects a direct read of a known answer that was not surfaced", () => {
    const targetId = "attempt:ae1e6010-c22a-4049-9067-19461c3e71a7:ae1e6010-c22a-4049-9067-19461c3e71a7::m1:candidate:fermat-inversion:b1eff02f73";
    const report = replayNaturalTrace(corpora.flat, [
      { operation: "search", argument: "carry" },
      { operation: "read", argument: targetId },
    ], [{ ...positiveReceipt, ideaIds: ["candidate:fermat-inversion:b1eff02f73"] }]);
    expect(report.status).toBe("FAIL");
    expect(report.failures).toContain(`read ${targetId} was not surfaced by search or deterministic derivation`);
  });

  test("fails the fixture gate while any case lacks reviewed retrieval data", () => {
    const report = verifyAtlasFixtureReachability(corpora, [{
      id: "pending",
      directionBlockId: "pending",
      gold: { classification: "prior_attempt", acceptableMatches: [positiveReceipt] },
    }], evidenceIndex);
    expect(report.status).toBe("FAIL");
    expect(report.pendingCases).toBe(1);
  });
});
