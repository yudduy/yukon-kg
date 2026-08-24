import { describe, expect, test } from "bun:test";
import {
  analyzePlanningBlocks,
  compilePlanningPacket,
  createPlanningOracle,
  createPlanningTask,
  planningPacketDifference,
  samplePlanningWorld,
  scorePlanningInspection,
  scorePlanningPreludeInspection,
  terminalDecision,
  verifyPlanningDuplicate,
} from "../src/mouselab.js";
import { planningScorerPreflight } from "../src/planning-mve.js";

function recordsFor(task) {
  return task.nodes.slice(0, 2).map((node, index) => ({
    evaluationId: `prelude-${index}`,
    nodeId: node.nodeId,
    validity: "valid",
    revealedValue: index === 0 ? 4 : -4,
    posteriorBestExpectedTotal: 4,
    rationale: "A narrative reason that must not enter a neutral packet.",
    planUpdate: "Inspect the high-variance stage next.",
  }));
}

function resultBlock({ incumbent = 2, narrative = 0, neutral = 2, budget = 0 } = {}) {
  return {
    conditions: {
      incumbent: { totalDecisionLoss: incumbent },
      freshNarrative: { totalDecisionLoss: narrative },
      freshNeutral: { totalDecisionLoss: neutral },
      freshBudget: { totalDecisionLoss: budget },
    },
  };
}

describe("Mouselab task", () => {
  test("generates a deterministic sealed task and world", () => {
    const task = createPlanningTask("same-seed");
    expect(createPlanningTask("same-seed")).toEqual(task);
    expect(task.routes).toHaveLength(6);
    expect(task.nodes).toHaveLength(18);
    expect(samplePlanningWorld(task, "world")).toEqual(samplePlanningWorld(task, "world"));
  });

  test("scores every inspection twice against an exact finite-horizon oracle", () => {
    const task = createPlanningTask("oracle-test", { branches: 2 });
    const world = samplePlanningWorld(task, "oracle-world");
    const observations = {};
    const oracle = createPlanningOracle(task);
    const nodeId = oracle.decision(observations, 2).optimalNodeIds[0];
    const first = scorePlanningInspection({ task, oracle, observations, remaining: 2, nodeId, world });
    const second = scorePlanningInspection({ task, oracle, observations, remaining: 2, nodeId, world });
    expect(first.validity).toBe("valid");
    expect(first.decisionLoss).toBe(0);
    expect(verifyPlanningDuplicate(first, second).reproductions).toBe(2);
    expect(terminalDecision(task, first.observations).expectedValue).toBe(first.after.expectedValue);
  });

  test("duplicates the deterministic shared-prelude reveal", () => {
    const task = createPlanningTask("prelude-score", { branches: 2 });
    const world = samplePlanningWorld(task, "prelude-world");
    const nodeId = task.nodes[0].nodeId;
    const first = scorePlanningPreludeInspection({ task, observations: {}, nodeId, world });
    const second = scorePlanningPreludeInspection({ task, observations: {}, nodeId, world });
    expect(first.validity).toBe("valid");
    expect(verifyPlanningDuplicate(first, second).reproductions).toBe(2);
  });

  test("keeps the two neutral packets identical except for the budget instruction", () => {
    const task = createPlanningTask("packet-test");
    const records = recordsFor(task);
    const neutral = compilePlanningPacket("freshNeutral", {
      task,
      records,
      remainingEvaluations: 4,
      incumbentPlan: "Narrative plan",
    });
    const budget = compilePlanningPacket("freshBudget", {
      task,
      records,
      remainingEvaluations: 4,
      incumbentPlan: "Narrative plan",
    });
    expect(planningPacketDifference(neutral, budget)).toEqual(["instruction"]);
    expect(JSON.stringify(neutral)).not.toContain("narrative reason");
    expect(JSON.stringify(neutral)).not.toContain("Narrative plan");
  });

  test("separates the exact oracle from random measurement choices", () => {
    const report = planningScorerPreflight();
    expect(report.status).toBe("PASS");
    expect(report.meanDecisionLoss.exactOracle).toBe(0);
    expect(report.meanDecisionLoss.random).toBeGreaterThanOrEqual(1);
    expect(report.duplicateScoring.reproductions).toBe(2);
  });
});

describe("Mouselab inference", () => {
  test("supports a procedure only when corrected inference and the practical effect both pass", () => {
    const result = analyzePlanningBlocks(Array.from({ length: 8 }, () => resultBlock()), {
      bootstrapDraws: 200,
      seed: "supported-planning",
    });
    expect(result.comparisons.contextReset.verdict).toBe("SUPPORTED");
    expect(result.comparisons.explicitBudget.verdict).toBe("SUPPORTED");
    expect(result.comparisons.completeHandoff.verdict).toBe("SUPPORTED");
    expect(result.proceedToLiveYukonTest).toBe(true);
  });

  test("rejects a meaningful benefit when paired loss reductions stay at zero", () => {
    const tied = Array.from({ length: 8 }, () => resultBlock({ incumbent: 0, narrative: 0, neutral: 0, budget: 0 }));
    const result = analyzePlanningBlocks(tied, { bootstrapDraws: 200, seed: "tied-planning" });
    expect(result.comparisons.contextReset.verdict).toBe("NOT_SUPPORTED_AT_MDE");
    expect(result.comparisons.explicitBudget.verdict).toBe("NOT_SUPPORTED_AT_MDE");
    expect(result.comparisons.completeHandoff.verdict).toBe("NOT_SUPPORTED_AT_MDE");
    expect(result.proceedToLiveYukonTest).toBe(false);
  });
});
