import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFIRMATORY_POOL_SCHEMA,
  HOST_ASSIGNMENT_SCHEMA,
  TASK_REFERENCE_SCHEMA,
  TASK_REFERENCE_SCHEMA_V3,
  analysisSha256,
  analyzeRepresentationStudy,
  selectConfirmatoryTasks,
} from "../src/representation-study-analysis.js";

const EXPERIMENT = "experiment:users/bx/representation-v1";
const ASSIGNMENT_SHA = "a".repeat(64);
const VERIFIER_SHA = "b".repeat(64);
const REPRESENTATIONS = ["R0", "R1", "R2"];

function taskReference(taskId, index) {
  return {
    taskId,
    metricName: "score",
    direction: "minimize",
    officialBaselineScore: 100,
    startingCandidate: {
      score: 110,
      candidateContentSha256: analysisSha256(`baseline:${index}`),
      verifierSha256: VERIFIER_SHA,
    },
    reference: {
      score: 80,
      candidateContentSha256: analysisSha256(`reference:${index}`),
      verifierSha256: VERIFIER_SHA,
    },
  };
}

function validMilestones(cellId, startingCandidate, treatment) {
  const offset = { R0: 0, R1: 1, R2: 2 }[treatment];
  return [0, 25, 50, 75, 100].map((percent) => ({
    percent,
    candidate_content_sha256: percent === 0
      ? startingCandidate.candidateContentSha256
      : analysisSha256(`${cellId}:${percent}`),
    verifier_sha256: VERIFIER_SHA,
    verification: {
      status: "ok",
      score: percent === 0 ? startingCandidate.score : 100 - offset,
    },
  }));
}

function studyFixture({ taskCount, historiesPerTask, agents }) {
  const tasks = Array.from({ length: taskCount }, (_, index) => (
    taskReference(`task:users/bx/task-${index + 1}`, index + 1)
  ));
  const cells = [];
  const rows = [];
  for (const [taskIndex, task] of tasks.entries()) {
    for (let history = 1; history <= historiesPerTask; history += 1) {
      const blockId = `task-${taskIndex + 1}-history-${history}`;
      for (const agent of agents) {
        for (const [slotIndex, treatment] of REPRESENTATIONS.entries()) {
          const cellId = `study-c${analysisSha256(`${blockId}:${agent}:${treatment}`).slice(0, 16)}`;
          cells.push({
            cell_id: cellId,
            block_id: blockId,
            agent,
            repetition: 1,
            block_order: history,
            slot: slotIndex + 1,
            treatment,
            run_spec: `run-spec:users/bx/${cellId}-r1`,
            run_id: `${cellId}-r1`,
            research_view: `research-view:users/bx/${analysisSha256(`view:${cellId}`)}`,
            candidate_artifact: `candidate-artifact:users/bx/${task.startingCandidate.candidateContentSha256}`,
            task: task.taskId,
            checkpoint: `checkpoint:public/example/${"c".repeat(40)}`,
          });
          rows.push({
            cell_id: cellId,
            block_id: blockId,
            slot: slotIndex + 1,
            repetition: 1,
            status: "completed",
            usage: {},
            rounds: [],
            milestones: validMilestones(cellId, task.startingCandidate, treatment),
            final_candidate_sha256: analysisSha256(`final:${cellId}`),
            stopped_by_caps: [],
          });
        }
      }
    }
  }
  const taskReferences = {
    schema: TASK_REFERENCE_SCHEMA,
    experiment: EXPERIMENT,
    tasks,
  };
  const blindedResults = {
    schema_version: 1,
    type: "blinded-randomized-block-results",
    experiment: EXPERIMENT,
    assignment_sha256: ASSIGNMENT_SHA,
    rows,
  };
  const hostAssignment = {
    schema: HOST_ASSIGNMENT_SCHEMA,
    experiment: EXPERIMENT,
    assignment: {
      algorithm: "sha256-sort-v1",
      seed_sha256: "d".repeat(64),
      balanced_orders: {},
      cells,
      execution_order_sha256: ASSIGNMENT_SHA,
    },
    failureClassifications: [],
  };
  return { taskReferences, blindedResults, hostAssignment };
}

function pilotFixture() {
  return studyFixture({
    taskCount: 3,
    historiesPerTask: 2,
    agents: ["agent:projects/dungeness/gpt-5.6-sol"],
  });
}

describe("representation analysis input boundary", () => {
  test("unblinds only after validating a complete six-block pilot", () => {
    const fixture = pilotFixture();
    const result = analyzeRepresentationStudy({
      ...fixture,
      phase: "pilot",
      apparatusGatesPassed: true,
      bootstrapDraws: 200,
      seed: "pilot-test",
    });
    expect(result.validation).toMatchObject({
      blindedLeakageCheck: "passed-before-assignment-join",
      completeActiveBlocks: true,
      activeBlocks: 6,
      activeCells: 18,
    });
    expect(result.contrasts["R1-R0"].auc.estimate).toBeCloseTo(0.4375);
    expect(result.contrasts["R2-R1"].auc.estimate).toBeCloseTo(0.4375);
    const firstR0 = result.outcomes.find((row) => row.representation === "R0");
    expect(firstR0).toMatchObject({
      officialBaselineScore: 100,
      startingCandidateScore: 110,
      referenceScore: 80,
      meaningfulGain: 2,
    });
    expect(firstR0.curve[0].gain).toBe(0);
    expect(firstR0.curve[1].gain).toBe(5);
    expect(result.pilot.gates["R1-R0"].decision).toBe("GO_REPLICATION");
    expect(result.pilot.gates["R2-R0"].decision).toBe("GO_REPLICATION");
    expect(result.pilot.gates["R2-R1"]).toBeUndefined();
    expect(result.pilot.decision).toBe("GO_REPLICATION_ELIGIBLE_USER_AUTHORIZATION_REQUIRED");
    expect(result.execution).toEqual({
      modelCalls: 0,
      studyRunsStarted: 0,
      replicationStarted: false,
      confirmationStarted: false,
    });
  });

  test("runs the read-only analyzer CLI on frozen JSON inputs", async () => {
    const fixture = pilotFixture();
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "yukon-analysis-cli-"));
    try {
      const files = {
        tasks: path.join(temporary, "tasks.json"),
        results: path.join(temporary, "results.json"),
        assignments: path.join(temporary, "assignments.json"),
      };
      await Promise.all([
        fs.writeFile(files.tasks, JSON.stringify(fixture.taskReferences)),
        fs.writeFile(files.results, JSON.stringify(fixture.blindedResults)),
        fs.writeFile(files.assignments, JSON.stringify(fixture.hostAssignment)),
      ]);
      const output = execFileSync("bun", [
        path.resolve(import.meta.dir, "../src/representation-study-analysis-cli.js"),
        "analyze",
        "--tasks", files.tasks,
        "--results", files.results,
        "--assignments", files.assignments,
        "--phase", "pilot",
        "--bootstrap-draws", "50",
        "--apparatus-gates-passed", "true",
      ], { encoding: "utf8" });
      const result = JSON.parse(output);
      expect(result.schema).toBe("yukon.representation-analysis.v3");
      expect(result.execution.studyRunsStarted).toBe(0);
      expect(result.pilot.replicationStarted).toBe(false);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  test("accepts the native Dungeness host manifest when no failures need classification", () => {
    const fixture = pilotFixture();
    const result = analyzeRepresentationStudy({
      taskReferences: fixture.taskReferences,
      blindedResults: fixture.blindedResults,
      hostAssignment: fixture.hostAssignment.assignment,
      phase: "pilot",
      bootstrapDraws: 25,
    });
    expect(result.validation.activeCells).toBe(18);
  });

  test("rejects treatment leakage and incomplete assignment/result joins", () => {
    const leaked = pilotFixture();
    leaked.blindedResults.rows[0].treatment = "R0";
    expect(() => analyzeRepresentationStudy({
      ...leaked,
      phase: "pilot",
      bootstrapDraws: 10,
    })).toThrow("leaks");

    const incomplete = pilotFixture();
    incomplete.blindedResults.rows.pop();
    expect(() => analyzeRepresentationStudy({
      ...incomplete,
      phase: "pilot",
      bootstrapDraws: 10,
    })).toThrow("different cell IDs");
  });

  test("carries a frozen treatment failure forward without dropping its block", () => {
    const fixture = pilotFixture();
    const failedCell = fixture.hostAssignment.assignment.cells.find((cell) => cell.treatment === "R1");
    const failedRow = fixture.blindedResults.rows.find((row) => row.cell_id === failedCell.cell_id);
    failedRow.status = "failed";
    failedRow.milestones = failedRow.milestones.slice(0, 2);
    const resultsSha256 = analysisSha256(fixture.blindedResults);
    fixture.hostAssignment.failureClassifications.push({
      cellId: failedCell.cell_id,
      category: "treatment_failure",
      code: "agent-crash",
      blindedResultsSha256: resultsSha256,
    });
    const result = analyzeRepresentationStudy({
      ...fixture,
      blindedResultsSha256: resultsSha256,
      phase: "pilot",
      bootstrapDraws: 100,
    });
    expect(result.validation.treatmentFailures).toBe(1);
    expect(result.validation.activeBlocks).toBe(6);
    const failedOutcome = result.outcomes.find((row) => row.cellId === failedCell.cell_id);
    expect(failedOutcome.curve.slice(2).every((point) => point.sourceStatus === "treatment_failure")).toBe(true);
  });

  test("uses a distinct frozen starting candidate for each history", () => {
    const fixture = pilotFixture();
    fixture.taskReferences.schema = TASK_REFERENCE_SCHEMA_V3;
    for (const task of fixture.taskReferences.tasks) {
      const original = task.startingCandidate;
      delete task.startingCandidate;
      const histories = fixture.hostAssignment.assignment.cells
        .filter((cell) => cell.task === task.taskId)
        .map((cell) => cell.block_id);
      task.startingCandidates = [...new Set(histories)].map((historyId, index) => ({
        ...original,
        historyId,
        score: original.score + index,
        candidateContentSha256: analysisSha256(`${task.taskId}:${historyId}:start`),
      }));
      for (const cell of fixture.hostAssignment.assignment.cells.filter((entry) => entry.task === task.taskId)) {
        const start = task.startingCandidates.find((entry) => entry.historyId === cell.block_id);
        cell.candidate_artifact = `candidate-artifact:users/bx/${start.candidateContentSha256}`;
        const row = fixture.blindedResults.rows.find((entry) => entry.cell_id === cell.cell_id);
        row.milestones[0].candidate_content_sha256 = start.candidateContentSha256;
        row.milestones[0].verification.score = start.score;
      }
    }
    const result = analyzeRepresentationStudy({
      ...fixture,
      phase: "pilot",
      bootstrapDraws: 25,
    });
    const starts = new Map(result.outcomes.map((row) => [row.historyId, row.startingCandidateScore]));
    expect(new Set(starts.values()).size).toBe(2);
  });

  test("carries only an isolated failed milestone and accepts later valid milestones", () => {
    const fixture = pilotFixture();
    const failedCell = fixture.hostAssignment.assignment.cells.find((cell) => cell.treatment === "R1");
    const failedRow = fixture.blindedResults.rows.find((row) => row.cell_id === failedCell.cell_id);
    failedRow.milestones[1].verification = { status: "invalid", score: null };
    const resultsSha256 = analysisSha256(fixture.blindedResults);
    fixture.hostAssignment.failureClassifications.push({
      cellId: failedCell.cell_id,
      category: "treatment_failure",
      code: "verification-failure",
      blindedResultsSha256: resultsSha256,
    });
    const result = analyzeRepresentationStudy({
      ...fixture,
      blindedResultsSha256: resultsSha256,
      phase: "pilot",
      bootstrapDraws: 25,
    });
    const outcome = result.outcomes.find((row) => row.cellId === failedCell.cell_id);
    expect(outcome.curve[1].sourceStatus).toBe("treatment_failure");
    expect(outcome.curve[2].sourceStatus).toBe("valid");
  });

  test("requires classified administrative failures to have one frozen replacement", () => {
    const fixture = pilotFixture();
    const original = fixture.hostAssignment.assignment.cells[0];
    const originalRow = fixture.blindedResults.rows.find((row) => row.cell_id === original.cell_id);
    originalRow.status = "failed";
    originalRow.milestones = [];
    const replacement = {
      ...original,
      cell_id: `study-c${"e".repeat(16)}`,
      run_id: `study-c${"e".repeat(16)}-r1`,
      administrative_replacement_for: original.cell_id,
    };
    fixture.hostAssignment.assignment.cells.push(replacement);
    fixture.blindedResults.rows.push({
      ...originalRow,
      cell_id: replacement.cell_id,
      status: "completed",
      milestones: validMilestones(
        replacement.cell_id,
        {
          candidateContentSha256: replacement.candidate_artifact.split("/").at(-1),
          score: 110,
        },
        replacement.treatment,
      ),
    });
    const resultsSha256 = analysisSha256(fixture.blindedResults);
    fixture.hostAssignment.failureClassifications.push({
      cellId: original.cell_id,
      category: "administrative_failure",
      code: "provider-outage",
      blindedResultsSha256: resultsSha256,
    });
    const result = analyzeRepresentationStudy({
      ...fixture,
      blindedResultsSha256: resultsSha256,
      phase: "pilot",
      bootstrapDraws: 50,
    });
    expect(result.validation.administrativeFailures).toBe(1);
    expect(result.validation.activeCells).toBe(18);

    fixture.hostAssignment.failureClassifications[0].blindedResultsSha256 = "f".repeat(64);
    expect(() => analyzeRepresentationStudy({
      ...fixture,
      blindedResultsSha256: resultsSha256,
      phase: "pilot",
      bootstrapDraws: 10,
    })).toThrow("not frozen");
  });
});

describe("confirmatory analysis and selection", () => {
  test("computes deterministic Holm and max-T outputs for the frozen 216-chain design", () => {
    const fixture = studyFixture({
      taskCount: 12,
      historiesPerTask: 3,
      agents: ["agent:model-a", "agent:model-b"],
    });
    const result = analyzeRepresentationStudy({
      ...fixture,
      phase: "confirmatory",
      bootstrapDraws: 50,
      permutationDraws: 100,
      seed: "confirmation-test",
    });
    expect(result.validation).toMatchObject({ activeBlocks: 72, activeCells: 216 });
    expect(result.confirmatory.permutation).toMatchObject({
      method: "within-block-label-permutation-max-t.v1",
      blocks: 72,
      tasks: 12,
      draws: 100,
    });
    for (const id of ["R1-R0", "R2-R1", "R2-R0"]) {
      expect(result.contrasts[id].inference.rawPValue).toBeGreaterThan(0);
      expect(result.contrasts[id].inference.holmAdjustedPValue)
        .toBeGreaterThanOrEqual(result.contrasts[id].inference.rawPValue);
      expect(result.contrasts[id].inference.maxTAdjustedPValue)
        .toBeGreaterThanOrEqual(result.contrasts[id].inference.rawPValue);
    }
    expect(result.confirmatory.confirmationStarted).toBe(false);
  });

  test("selects exactly four eligible tasks per category with a stable blind hash rank", () => {
    const categories = ["search_learning", "symbolic_combinatorial", "systems_optimization"];
    const pool = {
      schema: CONFIRMATORY_POOL_SCHEMA,
      experiment: EXPERIMENT,
      categories: categories.map((category) => ({
        category,
        tasks: Array.from({ length: 6 }, (_, index) => ({
          taskId: `task:public/${category}-${index + 1}`,
          gates: {
            digest_pinning: true,
            headroom: true,
            leakage: true,
            license: true,
            runtime: true,
            valid_event_rate: true,
            verifier_stability: true,
          },
        })),
      })),
    };
    const first = selectConfirmatoryTasks(pool, { seed: "frozen" });
    const second = selectConfirmatoryTasks(pool, { seed: "frozen" });
    expect(first).toEqual(second);
    expect(first.status).toBe("ELIGIBLE");
    expect(first.selected).toHaveLength(12);
    for (const category of categories) expect(first.categories[category].selected).toHaveLength(4);
    expect(first.execution.confirmationStarted).toBe(false);

    pool.categories[0].tasks.slice(0, 3).forEach((task) => { task.gates.license = false; });
    const ineligible = selectConfirmatoryTasks(pool, { seed: "frozen" });
    expect(ineligible.status).toBe("INELIGIBLE");
    expect(ineligible.selected).toEqual([]);
  });

  test("rejects treatment outcomes in the confirmatory task-selection pool", () => {
    const pool = {
      schema: CONFIRMATORY_POOL_SCHEMA,
      experiment: EXPERIMENT,
      categories: [],
      treatment: "R2",
    };
    expect(() => selectConfirmatoryTasks(pool)).toThrow("treatment-outcome field");
  });
});
