import { describe, expect, test } from "bun:test";
import { analyzeAtlasAccess } from "../src/atlas-access-analysis.js";

function fixture() {
  const candidate = (id, classification, strata) => ({
    id,
    gold: { classification },
    strata,
  });
  return {
    protocolVersion: "test-protocol",
    fixtureSha256: "f".repeat(64),
    pilot: [candidate("a", "prior_attempt", {
      lexicalOverlap: "low",
      witnessRole: "nonrepresentative",
      evidenceScope: "bundled",
    })],
    confirmatory: [candidate("b", "no_prior_attempt", {
      lexicalOverlap: "low",
      witnessRole: "none",
      evidenceScope: "none",
    })],
  };
}

function path(calls, returnedBytes, status = "PASS") {
  return { status, calls, returnedBytes, failures: [] };
}

describe("Atlas access analysis", () => {
  test("compares only cases reachable in every arm and preserves the cost tradeoff", () => {
    const reachability = {
      schema: "yukon.atlas-reachability-report",
      protocolVersion: "test-protocol",
      callLimit: 11,
      byteLimit: 22_528,
      caseReports: [
        {
          caseId: "a",
          retrievalKind: "positive",
          conditionReports: {
            raw: { status: "PASS", targets: [path(5, 9_000)] },
            flat: { status: "PASS", targets: [path(4, 11_000)] },
            flat_plus_brief: { status: "PASS", targets: [path(4, 11_000)] },
          },
        },
        {
          caseId: "b",
          retrievalKind: "negative",
          conditionReports: {
            raw: { status: "PASS", sharedPath: path(7, 10_000) },
            flat: { status: "FAIL", sharedPath: path(8, 20_000, "FAIL") },
            flat_plus_brief: { status: "PASS", sharedPath: path(5, 13_000) },
          },
        },
      ],
    };
    const analysis = analyzeAtlasAccess(reachability, fixture());
    expect(analysis.admission.allArmReachableCases).toBe(1);
    expect(analysis.admission.excludedCases).toBe(1);
    expect(analysis.admission.failedByCondition.flat).toEqual(["b"]);
    expect(analysis.overall.comparisons.flatVsRawCalls).toMatchObject({
      cases: 1,
      meanDifference: -1,
      treatmentLower: 1,
      ties: 0,
      treatmentHigher: 0,
    });
    expect(analysis.overall.comparisons.flatVsRawBytes.meanDifference).toBe(2_000);
    expect(analysis.overall.comparisons.flatPlusBriefVsFlatCalls.ties).toBe(1);
    expect(analysis.byRetrievalKind.negative.cases).toBe(0);
    expect(analysis.analysisSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("chooses the lowest-call passing positive target path", () => {
    const reachability = {
      schema: "yukon.atlas-reachability-report",
      callLimit: 11,
      byteLimit: 22_528,
      caseReports: [{
        caseId: "a",
        retrievalKind: "positive",
        conditionReports: {
          raw: { status: "PASS", targets: [path(7, 8_000), path(5, 9_000)] },
          flat: { status: "PASS", targets: [path(4, 12_000)] },
          flat_plus_brief: { status: "PASS", targets: [path(4, 12_000)] },
        },
      }],
    };
    const input = fixture();
    input.confirmatory = [];
    const analysis = analyzeAtlasAccess(reachability, input);
    expect(analysis.rows[0].raw).toEqual({ calls: 5, returnedBytes: 9_000 });
  });
});

