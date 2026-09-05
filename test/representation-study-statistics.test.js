import { describe, expect, test } from "bun:test";
import {
  assessConfirmatoryWinner,
  assessFinalScoreNoninferiority,
  assessRepresentationPilot,
  hierarchicalBootstrap,
  holmAdjustPValues,
  milestoneProgressAuc,
  meaningfulGainFromReference,
  normalizeMeaningfulGain,
  pairedWithinHistoryContrasts,
  prepareConfirmatoryContrasts,
  probabilityOfImprovement,
  REPRESENTATION_BUDGET_FRACTIONS,
  simulateHierarchicalPower,
  withinBlockMaxTPermutation,
  taskEqualMean,
} from "../src/representation-study-statistics.js";

function outcomeRow({
  blockId,
  taskId = "task-1",
  historyId = blockId,
  representation,
  progressAuc,
  finalGain = progressAuc,
  eligible = true,
}) {
  return {
    blockId,
    taskId,
    historyId,
    representation,
    progressAuc: eligible ? progressAuc : null,
    finalGain: eligible ? finalGain : null,
    eligible,
  };
}

function pairedRows(blockId, taskId, controlAuc, treatmentAuc, {
  controlFinal = controlAuc,
  treatmentFinal = treatmentAuc,
} = {}) {
  return [
    outcomeRow({
      blockId,
      taskId,
      representation: "flat",
      progressAuc: controlAuc,
      finalGain: controlFinal,
    }),
    outcomeRow({
      blockId,
      taskId,
      representation: "map",
      progressAuc: treatmentAuc,
      finalGain: treatmentFinal,
    }),
  ];
}

const MAP_VS_FLAT = [{ id: "map_vs_flat", treatment: "map", control: "flat" }];

describe("meaningful-gain outcomes", () => {
  test("normalizes both score directions and preserves zero gaps", () => {
    expect(normalizeMeaningfulGain({
      baselineScore: 100,
      score: 95,
      direction: "minimize",
      meaningfulGain: 5,
    })).toBe(1);
    expect(normalizeMeaningfulGain({
      baselineScore: 50,
      score: 55,
      direction: "maximize",
      meaningfulGain: 5,
    })).toBe(1);
    expect(normalizeMeaningfulGain({
      baselineScore: 50,
      score: 50,
      direction: "maximize",
      meaningfulGain: 5,
    })).toBe(0);
    expect(normalizeMeaningfulGain({
      baselineScore: 50,
      score: 45,
      direction: "maximize",
      meaningfulGain: 5,
    })).toBe(-1);
    expect(() => normalizeMeaningfulGain({
      baselineScore: 50,
      score: 55,
      direction: "maximize",
      meaningfulGain: 0,
    })).toThrow("meaningfulGain must be positive");
  });

  test("derives ten percent of a strictly positive baseline-reference gap", () => {
    expect(meaningfulGainFromReference({
      baselineScore: 100,
      referenceScore: 80,
      direction: "minimize",
    })).toBe(2);
    expect(() => meaningfulGainFromReference({
      baselineScore: 100,
      referenceScore: 100,
      direction: "minimize",
    })).toThrow("strictly better");
  });

  test("integrates best-so-far progress over budget milestones", () => {
    const result = milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 0.5, score: 95, status: "valid" },
        { fraction: 1, score: 90, status: "valid" },
      ],
    });
    expect(result.eligible).toBe(true);
    expect(result.curve.map((point) => point.gain)).toEqual([0, 0.5, 1]);
    expect(result.progressAuc).toBe(0.5);
    expect(result.finalGain).toBe(1);
  });

  test("does not clip outer-verified regressions or select by outer score", () => {
    const result = milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 0.5, score: 105, status: "valid" },
        { fraction: 1, score: 90, status: "valid" },
      ],
    });
    expect(result.curve.map((point) => point.gain)).toEqual([0, -0.5, 1]);
    expect(result.progressAuc).toBe(0);
  });

  test("carries treatment failures forward but excludes administrative failures", () => {
    const treatmentFailure = milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 0.5, score: 95, status: "valid" },
        { fraction: 1, status: "treatment_failure" },
      ],
    });
    expect(treatmentFailure.curve.map((point) => point.gain)).toEqual([0, 0.5, 0.5]);
    expect(treatmentFailure.progressAuc).toBe(0.375);
    expect(treatmentFailure.finalGain).toBe(0.5);

    const administrative = milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 1, status: "administrative_failure" },
      ],
    });
    expect(administrative).toMatchObject({
      eligible: false,
      exclusionReason: "administrative_failure",
      progressAuc: null,
      finalGain: null,
    });
  });

  test("rejects unclassified missing final milestones and duplicate fractions", () => {
    expect(() => milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 0.5, score: 95, status: "valid" },
      ],
    })).toThrow("fractions zero and one");
    expect(() => milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 1, score: 90, status: "valid" },
        { fraction: 1, score: 90, status: "valid" },
      ],
    })).toThrow("duplicate fraction");
    expect(() => milestoneProgressAuc({
      baselineScore: 100,
      meaningfulGain: 10,
      direction: "minimize",
      expectedFractions: REPRESENTATION_BUDGET_FRACTIONS,
      milestones: [
        { fraction: 0, score: 100, status: "valid" },
        { fraction: 0.25, score: 98, status: "valid" },
        { fraction: 0.75, score: 94, status: "valid" },
        { fraction: 1, score: 92, status: "valid" },
      ],
    })).toThrow("milestone fractions must equal");
  });
});

describe("paired task summaries", () => {
  test("pairs only arms from the same history and preserves direction", () => {
    const rows = [
      ...pairedRows("block-a", "task-a", 0.1, 0.5, { controlFinal: 0.2, treatmentFinal: 0.6 }),
      ...pairedRows("block-b", "task-b", 0.4, 0.2, { controlFinal: 0.5, treatmentFinal: 0.3 }),
    ];
    const result = pairedWithinHistoryContrasts(rows, MAP_VS_FLAT);
    expect(result.valid).toBe(true);
    expect(result.contrasts.map_vs_flat.pairs.map((pair) => pair.difference)).toEqual([0.4, -0.2]);
    expect(result.contrasts.map_vs_flat.pairs[0].finalDifference).toBeCloseTo(0.4);
    expect(result.contrasts.map_vs_flat.pairs[1].finalDifference).toBeCloseTo(-0.2);
  });

  test("does not silently drop missing arms and records administrative exclusion", () => {
    const missing = pairedWithinHistoryContrasts([
      outcomeRow({ blockId: "missing", representation: "flat", progressAuc: 0 }),
    ], MAP_VS_FLAT);
    expect(missing.valid).toBe(false);
    expect(missing.exclusions).toEqual([
      { blockId: "missing", contrastId: "map_vs_flat", reason: "missing_arm" },
    ]);

    const administrative = pairedWithinHistoryContrasts([
      outcomeRow({ blockId: "admin", representation: "flat", progressAuc: 0 }),
      outcomeRow({
        blockId: "admin",
        representation: "map",
        progressAuc: null,
        eligible: false,
      }),
    ], MAP_VS_FLAT);
    expect(administrative.valid).toBe(true);
    expect(administrative.contrasts.map_vs_flat.pairs).toHaveLength(0);
    expect(administrative.exclusions[0].reason).toBe("administrative_failure");
  });

  test("weights tasks equally rather than histories equally", () => {
    const pairs = [
      { taskId: "task-a", difference: 1 },
      { taskId: "task-a", difference: 3 },
      { taskId: "task-b", difference: 10 },
    ];
    const summary = taskEqualMean(pairs);
    expect(summary.mean).toBe(6);
    expect(summary.taskCount).toBe(2);
    expect(summary.historyCount).toBe(3);
  });

  test("computes task-equal probability of improvement with half-credit ties", () => {
    const result = probabilityOfImprovement([
      { taskId: "task-a", difference: 1 },
      { taskId: "task-a", difference: -1 },
      { taskId: "task-b", difference: 0 },
    ]);
    expect(result.probability).toBe(0.5);
  });
});

describe("intervals and decisions", () => {
  const calibrationPairs = [
    { taskId: "task-a", difference: 0.1, finalDifference: 0.2 },
    { taskId: "task-a", difference: 0.4, finalDifference: 0.1 },
    { taskId: "task-b", difference: 0.3, finalDifference: 0.2 },
    { taskId: "task-b", difference: 0.6, finalDifference: 0.4 },
    { taskId: "task-c", difference: -0.1, finalDifference: 0 },
    { taskId: "task-c", difference: 0.2, finalDifference: 0.1 },
  ];

  test("hierarchical bootstrap is deterministic and resamples tasks then histories", () => {
    const first = hierarchicalBootstrap(calibrationPairs, { draws: 500, seed: "fixed" });
    const second = hierarchicalBootstrap(calibrationPairs, { draws: 500, seed: "fixed" });
    expect(first).toEqual(second);
    expect(first.estimate).toBeCloseTo(0.25);
    expect(first.lowerBound).toBeLessThanOrEqual(first.estimate);
    expect(first.upperBound).toBeGreaterThanOrEqual(first.estimate);
  });

  test("applies the final-score noninferiority margin", () => {
    expect(assessFinalScoreNoninferiority({
      estimate: 0,
      lowerBound: -0.2,
      upperBound: 0.2,
    }).supported).toBe(true);
    expect(assessFinalScoreNoninferiority({
      estimate: 0,
      lowerBound: -0.3,
      upperBound: 0.2,
    }).supported).toBe(false);
  });

  test("uses the frozen pilot threshold, win count, and futility bound", () => {
    const go = assessRepresentationPilot({
      differences: [0.5, 0.4, 0.3, 0.2, 0.1, 0],
      upperBound: 0.5,
      finalNoninferior: true,
      apparatusGatesPassed: true,
    });
    expect(go).toMatchObject({
      decision: "GO_REPLICATION",
      estimate: 0.25,
      meaningfulEffect: 0.25,
      wins: 5,
      minimumWins: 4,
    });

    const futile = assessRepresentationPilot({
      differences: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      upperBound: 0.2,
      finalNoninferior: true,
      apparatusGatesPassed: true,
    });
    expect(futile.decision).toBe("STOP_FUTILITY");

    const inconsistent = assessRepresentationPilot({
      differences: [1, 1, 1, -0.5, -0.5, -0.5],
      estimate: 0.25,
      upperBound: 0.8,
      finalNoninferior: true,
      apparatusGatesPassed: true,
    });
    expect(inconsistent.decision).toBe("PILOT_INCONCLUSIVE");

    const noninferiorFailure = assessRepresentationPilot({
      differences: [0.5, 0.4, 0.3, 0.2, 0.1, 0],
      upperBound: 0.5,
      finalNoninferior: false,
      apparatusGatesPassed: true,
    });
    expect(noninferiorFailure.decision).toBe("PILOT_INCONCLUSIVE");
  });

  test("requires every frozen criterion for a confirmatory winner", () => {
    const winner = assessConfirmatoryWinner({
      adjustedPValue: 0.01,
      estimate: 0.3,
      simultaneousLowerBound: 0.1,
      finalNoninferior: true,
      modelFamilyEffects: [0.2, 0.1],
      protocolViolations: 0,
    });
    expect(winner.winner).toBe(true);
    expect(assessConfirmatoryWinner({
      adjustedPValue: 0.01,
      estimate: 0.3,
      simultaneousLowerBound: 0.1,
      finalNoninferior: true,
      modelFamilyEffects: [0.2, -0.1],
      protocolViolations: 0,
    }).winner).toBe(false);
  });

  test("prepares joint contrast vectors for Holm or within-block max-T inference", () => {
    const rows = [
      ...pairedRows("block-a", "task-a", 0, 0.5),
      ...pairedRows("block-b", "task-b", 0.1, 0.4),
    ];
    const result = prepareConfirmatoryContrasts(rows, MAP_VS_FLAT, {
      bootstrapDraws: 200,
      seed: "confirmatory",
    });
    expect(result.valid).toBe(true);
    expect(result.contrasts.map_vs_flat).toMatchObject({
      analyzable: true,
      treatment: "map",
      control: "flat",
      inference: {
        rawPValue: null,
        holmAdjustedPValue: null,
        maxTAdjustedPValue: null,
      },
    });
    expect(result.permutationFrame.blocks).toHaveLength(2);
    expect(result.permutationFrame.blocks[0].outcomes).toEqual({
      flat: { progressAuc: 0, finalGain: 0 },
      map: { progressAuc: 0.5, finalGain: 0.5 },
    });
    expect(holmAdjustPValues({ first: 0.01, second: 0.04, third: 0.03 }))
      .toEqual({ first: 0.03, third: 0.06, second: 0.06 });
  });

  test("provides a deterministic hierarchical power-simulation scaffold", () => {
    const first = simulateHierarchicalPower(calibrationPairs, {
      targetEffect: 0.25,
      taskCounts: [3, 6],
      historiesPerTask: 2,
      draws: 500,
      familySize: 3,
      seed: "power",
    });
    const second = simulateHierarchicalPower(calibrationPairs, {
      targetEffect: 0.25,
      taskCounts: [3, 6],
      historiesPerTask: 2,
      draws: 500,
      familySize: 3,
      seed: "power",
    });
    expect(first).toEqual(second);
    expect(first.results).toHaveLength(2);
    for (const result of first.results) {
      expect(result.estimatedPower).toBeGreaterThanOrEqual(0);
      expect(result.estimatedPower).toBeLessThanOrEqual(1);
    }
  });

  test("permutates labels within complete blocks with max-T familywise control", () => {
    const rows = [];
    for (const [taskIndex, taskId] of ["task-a", "task-b", "task-c"].entries()) {
      for (const history of ["h1", "h2"]) {
        const blockId = `${taskId}-${history}`;
        rows.push(
          { blockId, taskId, historyId: history, representation: "R0", eligible: true, progressAuc: taskIndex, finalGain: 0 },
          { blockId, taskId, historyId: history, representation: "R1", eligible: true, progressAuc: taskIndex + 1 + (history === "h2" ? 0.1 : 0), finalGain: 1 },
          { blockId, taskId, historyId: history, representation: "R2", eligible: true, progressAuc: taskIndex + 1.5 + (history === "h2" ? 0.2 : 0), finalGain: 1.5 },
        );
      }
    }
    const definitions = [
      { id: "R1-R0", treatment: "R1", control: "R0" },
      { id: "R2-R1", treatment: "R2", control: "R1" },
      { id: "R2-R0", treatment: "R2", control: "R0" },
    ];
    const first = withinBlockMaxTPermutation(rows, definitions, { draws: 2_000, seed: "fixed" });
    const second = withinBlockMaxTPermutation(rows, definitions, { draws: 2_000, seed: "fixed" });
    expect(first).toEqual(second);
    expect(first.blocks).toBe(6);
    for (const definition of definitions) {
      const id = definition.id;
      expect(first.maxTAdjustedPValues[id]).toBeGreaterThanOrEqual(first.rawPValues[id]);
      expect(first.holmAdjustedPValues[id]).toBeGreaterThanOrEqual(first.rawPValues[id]);
      expect(first.simultaneousIntervals[id]).toHaveProperty("lowerBound");
    }
  });
});
