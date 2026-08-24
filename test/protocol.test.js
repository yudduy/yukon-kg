import { describe, expect, test } from "bun:test";
import {
  MDE_PERCENT,
  analyzeConfirmatoryBlocks,
  assessPilotInformativeness,
  assessTuningLandscape,
  assertBlindedPacket,
  canonicalStringify,
  compileConditionPacket,
  estimateConfirmatoryBlocks,
  exactSignFlipPValue,
  holmAdjust,
  packetDifference,
  pairedImprovementPercent,
  parseSquareScore,
  sha256,
  verifyDuplicateScores,
  TUNING_CANDIDATES,
} from "../src/protocol.js";

function packetState() {
  return {
    forkArtifactId: "fork-1",
    remainingEvaluations: 8,
    incumbentPlan: "Measure a separate local rewrite.",
    frontier: [{ artifactId: "artifact-1", score: 100 }],
    alternatives: [{
      id: "alternative-1",
      interventionFamily: "carry ladder",
      hypothesis: "A shorter carry ladder reduces the endpoint.",
      falsifier: "The duplicate endpoint does not decrease.",
    }],
    candidates: [
      { candidateId: "ladder-008", chunkMin: 200, ladder: 8, region: "substantially lower carry-ladder budget" },
      { candidateId: "ladder-010", chunkMin: 200, ladder: 10, region: "substantially lower carry-ladder budget" },
    ],
    evidence: [{
      evaluationId: "prelude-P-0",
      baseArtifactId: "artifact-1",
      candidateArtifactId: "artifact-2",
      interventionFamily: "carry ladder",
      hypothesis: "A shorter carry ladder reduces the endpoint.",
      falsifier: "The duplicate endpoint does not decrease.",
      validity: "valid",
      score: { executedToffoli: 10, peakQubits: 10, score: 100 },
      rationale: "The measurement discriminates the local mechanism.",
      planUpdate: "Test a separate local rewrite.",
    }],
  };
}

function block({ a = 100, b = 99, c = 100, d = 99 } = {}) {
  return {
    conditions: {
      A: { bestScore: a },
      B: { bestScore: b },
      C: { bestScore: c },
      D: { bestScore: d },
    },
  };
}

describe("canonical artifacts", () => {
  test("sorts object keys while preserving array order", () => {
    expect(canonicalStringify({ z: 1, a: [{ y: 2, x: 1 }] }))
      .toBe('{"a":[{"x":1,"y":2}],"z":1}');
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
  });

  test("rejects values JSON cannot represent exactly", () => {
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalStringify({ value: 1n })).toThrow("bigint");
  });
});

describe("square scorer", () => {
  test("parses and reproduces the exact endpoint", () => {
    const output = "product-register square: 56339 emitted / 56059.047 executed Toffoli, 1270 peak qubits";
    const parsed = parseSquareScore(output);
    expect(parsed).toEqual({
      emittedToffoli: 56339,
      executedToffoli: 56059.047,
      peakQubits: 1270,
      score: 71194989.69,
    });
    expect(verifyDuplicateScores(parsed, { ...parsed }).reproductions).toBe(2);
  });

  test("rejects missing and non-reproducing output", () => {
    expect(() => parseSquareScore("not a score")).toThrow("did not contain");
    const first = parseSquareScore("product-register square: 1 emitted / 1.0 executed Toffoli, 2 peak qubits");
    expect(() => verifyDuplicateScores(first, { ...first, peakQubits: 3 })).toThrow("disagree");
  });
});

describe("condition packets", () => {
  test("C and D differ only in the allocation instruction", () => {
    const state = packetState();
    const c = compileConditionPacket("C", state);
    const d = compileConditionPacket("D", state);
    expect(packetDifference(c, d)).toEqual(["instruction"]);
    expect(c.evidence).toEqual(d.evidence);
    expect(c.alternatives).toEqual(d.alternatives);
  });

  test("B retains narrative while blinded packets reject leakage", () => {
    const state = packetState();
    expect(compileConditionPacket("B", state).journal).toHaveLength(1);
    expect(() => assertBlindedPacket({ statement: "I recommend we continue because cost was already spent." }))
      .toThrow("first-person language");
    expect(() => assertBlindedPacket({ statement: "Use SUB4_SQUARE_KARATSUBA2." }))
      .toThrow("sealed toggle");
  });

  test("tuning packets expose a large reachable candidate landscape", () => {
    expect(TUNING_CANDIDATES).toHaveLength(92);
    const measurements = TUNING_CANDIDATES.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      validity: "valid",
      score: {
        score: index < 8 ? 99_000 - index * 100 : 100_000 + index,
      },
    }));
    const gate = assessTuningLandscape(100_000, measurements);
    expect(gate.status).toBe("PASS");
    expect(gate.distinctScores).toBeGreaterThanOrEqual(8);
    expect(gate.bestImprovementPercent).toBeGreaterThanOrEqual(MDE_PERCENT);
    expect(gate.bestScore).toBe(98_300);
    expect(gate.bestCandidateIds).toEqual([TUNING_CANDIDATES[7].candidateId]);
  });

  test("pilot gate rejects an uninformative search", () => {
    const tooEasy = assessPilotInformativeness({
      baselineScore: 100,
      optimumScore: 90,
      conditions: { A: { bestScore: 90 }, B: { bestScore: 90 }, C: { bestScore: 90 }, D: { bestScore: 90 } },
    });
    expect(tooEasy.status).toBe("TASK_TOO_EASY");
    const tooHard = assessPilotInformativeness({
      baselineScore: 100,
      optimumScore: 90,
      conditions: { A: { bestScore: 100 }, B: { bestScore: 100 }, C: { bestScore: 100 }, D: { bestScore: 100 } },
    });
    expect(tooHard.status).toBe("TASK_TOO_HARD");
  });
});

describe("confirmatory statistics", () => {
  test("computes paired improvements and exact sign-flip probabilities", () => {
    expect(pairedImprovementPercent(100, 99)).toBe(1);
    expect(exactSignFlipPValue([1, 1])).toBe(0.25);
    expect(exactSignFlipPValue([-1, -1])).toBe(1);
    expect(exactSignFlipPValue(Array.from({ length: 24 }, (_, index) => 1 + (index % 5) / 10)))
      .toBe(1 / 2 ** 24);
  });

  test("applies monotone Holm adjustment", () => {
    expect(holmAdjust({ a: 0.01, b: 0.03, c: 0.04 })).toEqual({ a: 0.03, b: 0.06, c: 0.06 });
  });

  test("returns supported and not-supported verdicts only with their gates", () => {
    const supported = analyzeConfirmatoryBlocks(Array.from({ length: 8 }, () => block()), {
      bootstrapDraws: 200,
      seed: "supported",
    });
    expect(supported.comparisons.h1.verdict).toBe("SUPPORTED");
    expect(supported.comparisons.h2.verdict).toBe("SUPPORTED");
    expect(supported.comparisons.product.verdict).toBe("SUPPORTED");
    expect(supported.proceedToLiveCourt).toBe(true);

    const negative = analyzeConfirmatoryBlocks(Array.from({ length: 8 }, () => block({ b: 101, d: 101 })), {
      bootstrapDraws: 200,
      seed: "negative",
    });
    expect(negative.comparisons.h1.verdict).toBe("NOT_SUPPORTED_AT_MDE");
    expect(negative.comparisons.product.verdict).toBe("NOT_SUPPORTED_AT_MDE");
    expect(negative.proceedToLiveCourt).toBe(false);
  });

  test("freezes a deterministic sample size from four calibration blocks", () => {
    const calibration = {
      h1: [0.3, 0.5, 0.7, 0.5],
      h2: [0.4, 0.5, 0.6, 0.5],
      product: [0.2, 0.5, 0.8, 0.5],
    };
    const first = estimateConfirmatoryBlocks(calibration, { draws: 200, seed: "fixed" });
    const second = estimateConfirmatoryBlocks(calibration, { draws: 200, seed: "fixed" });
    expect(first).toEqual(second);
    expect(first.blocks).toBeGreaterThanOrEqual(8);
    expect(first.blocks).toBeLessThanOrEqual(24);
    expect(first.mdePercent).toBe(MDE_PERCENT);
  });
});
