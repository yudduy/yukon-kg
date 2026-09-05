import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analysisSha256,
  canonicalAnalysisJson,
} from "../src/representation-study-analysis.js";
import {
  SEED_CONVERGENCE_DECISION_SCHEMA,
  SEED_CONVERGENCE_EVIDENCE_SCHEMA,
  checkSeedConvergence,
  validateSeedConvergenceDecision,
} from "../src/seed-convergence.js";
import { sha256 } from "../src/research-view.js";

const TASK_ID = "task:users/bx/ecdsa-fail";
const VERIFIER_SHA256 = "a".repeat(64);

function contentHash(label) {
  return analysisSha256(`candidate:${label}`);
}

function trustedEvent(index, { score, valid = true, content = contentHash(index) } = {}) {
  const evaluationId = String(index).padStart(4, "0");
  const parent = index === 1 ? contentHash("baseline") : contentHash(index - 1);
  const diffText = `--- a/src/candidate.py\n+++ b/src/candidate.py\n@@ -1 +1 @@\n-${index - 1}\n+${index}\n`;
  const numericScore = valid ? score : null;
  return {
    evaluation_id: evaluationId,
    created_at: `2026-08-27T00:00:${String(index).padStart(2, "0")}.000Z`,
    candidate_commit_sha: null,
    parent_content_sha256: parent,
    content_sha256: content,
    candidate_paths: ["src/candidate.py"],
    payload: {
      algorithm: "tree-sha256-v1",
      sha256: content,
      file_count: 1,
      bytes: index,
      files: [{ path: "src/candidate.py", sha256: contentHash(`file-${index}`), bytes: index }],
    },
    exact_diff: { sha256: sha256(diffText), text: diffText },
    changes: {
      paths: ["src/candidate.py"],
      symbols: ["candidate"],
      config: [],
      detection: "trusted-diff-v1",
    },
    development_outcome: {
      valid,
      status: valid ? "ok" : "invalid-candidate",
      metric: { name: "cost", direction: "minimize", value: numericScore },
      measurement: {
        status: valid ? "valid" : "invalid",
        validity: valid ? "valid" : "invalid",
        metric_name: "cost",
        direction: "-",
        score: numericScore,
        comparator_content_sha256: parent,
        comparator_score: null,
        comparator_hops: 1,
        raw_delta: null,
        directional_gain: null,
        admission: valid ? "admitted" : "rejected",
      },
    },
    cost: { scope: "cumulative-at-evaluation" },
    timing: { elapsed_ms: 100, cumulative_elapsed_ms: index * 100 },
    budget: { evaluations_used: index, evaluations_limit: 8 },
    provenance: {
      event_path: `usage/evaluations/${evaluationId}/event.json`,
      event_sha256: contentHash(`event-${index}`),
      source_transport_sha256: contentHash(`transport-${index}`),
    },
    execution: {
      evaluation_id: evaluationId,
      model_provider: "openrouter",
      model_id: "openai/gpt-5.6-sol",
      reasoning_effort: "high",
      model_cost: { normalized_usd: index / 10 },
      evaluation_cost: { evaluations: index, compute_ms: index * 100 },
      total_cost: { normalized_usd: null, evaluation_compute_ms: index * 100 },
    },
  };
}

function trustedExport({ validScores = [99, 98, 97, 96], invalidEvents = 4 } = {}) {
  const events = validScores.map((score, index) => trustedEvent(index + 1, { score }));
  for (let index = 0; index < invalidEvents; index += 1) {
    events.push(trustedEvent(events.length + 1, { valid: false }));
  }
  return {
    schema: "dungeness.trusted-research-events.v1",
    run: { id: "seed-run", ref: "run:users/bx/seed-run" },
    selection: events.map((event) => event.evaluation_id),
    task: {
      ref: TASK_ID,
      id: "ecdsa-fail",
      interface: "file-v1",
      candidate: { allowed_paths: ["src/candidate.py"] },
      metric: { name: "cost", direction: "minimize" },
    },
    checkpoint: {
      ref: "checkpoint:users/bx/ecdsa",
      id: "ecdsa",
      repository: {},
      interface: "file-v1",
      web_cutoff: "2026-08-27T00:00:00.000Z",
    },
    seed: {
      initialization: { mode: "checkpoint" },
      evaluation_baseline: { content_sha256: contentHash("baseline") },
      checkpoint_commit: "b".repeat(40),
    },
    environment: {
      model: { provider: "openrouter", upstream_id: "openai/gpt-5.6-sol" },
      resources: {},
      policies: {},
      limits: {},
    },
    harness: { adapter: {}, evaluation: {}, verifier: {} },
    events,
  };
}

function seedEvidence(exported, overrides = {}) {
  const selected = exported.events
    .filter((event) => event.development_outcome.measurement.validity === "valid")
    .sort((left, right) => (
      left.development_outcome.measurement.score - right.development_outcome.measurement.score
      || left.evaluation_id.localeCompare(right.evaluation_id)
    ))[0];
  const cleanScore = overrides.cleanScore ?? 95;
  const evidence = {
    schema: SEED_CONVERGENCE_EVIDENCE_SCHEMA,
    experiment: "experiment:users/bx/dungeness-representation-v1",
    producerRun: exported.run.ref,
    taskId: TASK_ID,
    trustedExportSha256: analysisSha256(exported),
    task: {
      taskId: TASK_ID,
      metricName: "cost",
      direction: "minimize",
      officialBaselineScore: 100,
      startingCandidate: {
        score: 110,
        candidateContentSha256: contentHash("baseline"),
        verifierSha256: VERIFIER_SHA256,
      },
      reference: {
        score: 80,
        candidateContentSha256: null,
        verifierSha256: VERIFIER_SHA256,
      },
    },
    runOutcome: {
      status: "completed",
      failureCategory: null,
      failureCode: null,
      administrativeRetryUsed: false,
      eligibleReplacementAvailable: true,
    },
    cleanSelection: selected === undefined ? null : {
      evaluationId: selected.evaluation_id,
      candidateArtifactRef: `candidate-artifact:users/bx/${selected.content_sha256}`,
      candidateArtifactManifestSha256: contentHash("candidate-manifest"),
      candidateContentSha256: selected.content_sha256,
      verifierSha256: VERIFIER_SHA256,
      status: "ok",
      score: cleanScore,
      scoreArtifactSha256: contentHash(`clean-score-${cleanScore}`),
    },
    protocolViolations: [],
  };
  if (overrides.runOutcome !== undefined) evidence.runOutcome = overrides.runOutcome;
  if (overrides.cleanSelection !== undefined) evidence.cleanSelection = overrides.cleanSelection;
  if (overrides.protocolViolations !== undefined) evidence.protocolViolations = overrides.protocolViolations;
  if (overrides.trustedExportSha256 !== undefined) evidence.trustedExportSha256 = overrides.trustedExportSha256;
  return evidence;
}

function decide(exported, evidence = seedEvidence(exported)) {
  return checkSeedConvergence({ trustedExport: exported, evidence });
}

describe("seed convergence checker", () => {
  test("passes a diverse, clean-verified seed with positive progress and remaining headroom", () => {
    const exported = trustedExport();
    const first = decide(exported);
    const second = decide(exported);
    expect(first).toEqual(second);
    expect(first.schema).toBe(SEED_CONVERGENCE_DECISION_SCHEMA);
    expect(first.decision).toBe("PASS");
    expect(first.reasons).toEqual([]);
    expect(first.metrics).toMatchObject({
      capturedEvents: 8,
      validNumericEvents: 4,
      validEventRate: 0.5,
      distinctValidCandidateHashes: 4,
      distinctValidScores: 4,
      officialBaselineScore: 100,
      startingCandidateScore: 110,
      officialReferenceGap: 20,
      seedProgress: 15,
      meaningfulGain: 2,
      remainingHeadroom: 15,
      selectedEvaluationId: "0004",
    });
    expect(first.execution).toEqual({ modelCalls: 0, studyRunsStarted: 0 });
    const { decisionSha256, ...core } = first;
    expect(decisionSha256).toBe(analysisSha256(core));
    expect(validateSeedConvergenceDecision(first)).toBe(first);
    expect(() => validateSeedConvergenceDecision({ ...first, unexpected: true })).toThrow("keys must be exactly");
    expect(() => validateSeedConvergenceDecision({ ...first, taskId: "changed" })).toThrow("hash does not match");
  });

  test("keeps AutoLab official baselines separate from clean starting candidates", () => {
    const cases = [
      {
        officialBaselineScore: 5.0,
        startingCandidateScore: 5.3321,
        referenceScore: 4.0,
        cleanSeedScore: 5.2,
        meaningfulGain: 0.1,
        seedProgress: 0.1321,
        remainingHeadroom: 1.2,
      },
      {
        officialBaselineScore: 1.5,
        startingCandidateScore: 1.775523,
        referenceScore: 1.0,
        cleanSeedScore: 1.7,
        meaningfulGain: 0.05,
        seedProgress: 0.075523,
        remainingHeadroom: 0.7,
      },
    ];
    for (const calibration of cases) {
      const exported = trustedExport();
      const evidence = seedEvidence(exported, { cleanScore: calibration.cleanSeedScore });
      evidence.task.officialBaselineScore = calibration.officialBaselineScore;
      evidence.task.startingCandidate.score = calibration.startingCandidateScore;
      evidence.task.reference.score = calibration.referenceScore;
      const decision = decide(exported, evidence);
      expect(decision.decision).toBe("PASS");
      expect(decision.metrics.officialBaselineScore).toBe(calibration.officialBaselineScore);
      expect(decision.metrics.startingCandidateScore).toBe(calibration.startingCandidateScore);
      expect(decision.metrics.meaningfulGain).toBeCloseTo(calibration.meaningfulGain, 12);
      expect(decision.metrics.seedProgress).toBeCloseTo(calibration.seedProgress, 12);
      expect(decision.metrics.remainingHeadroom).toBeCloseTo(calibration.remainingHeadroom, 12);
    }
  });

  test("classifies rate, candidate-diversity, and score-diversity failures as task replacement", () => {
    const lowRate = trustedExport({ validScores: [99, 98, 97, 96], invalidEvents: 5 });
    expect(decide(lowRate).decision).toBe("TASK_REPLACE");
    expect(decide(lowRate).reasons).toContain("valid_event_rate_below_threshold");

    const sameCandidate = trustedExport();
    const repeatedHash = sameCandidate.events[0].content_sha256;
    for (const event of sameCandidate.events.slice(0, 4)) {
      event.content_sha256 = repeatedHash;
      event.payload.sha256 = repeatedHash;
    }
    const candidateDecision = decide(sameCandidate, seedEvidence(sameCandidate));
    expect(candidateDecision.decision).toBe("TASK_REPLACE");
    expect(candidateDecision.reasons).toContain("insufficient_distinct_candidate_hashes");

    const sameScore = trustedExport({ validScores: [99, 99, 99, 99] });
    const scoreDecision = decide(sameScore);
    expect(scoreDecision.decision).toBe("TASK_REPLACE");
    expect(scoreDecision.reasons).toContain("insufficient_distinct_scores");
  });

  test("classifies a completed zero-event producer deterministically as task replacement", () => {
    const exported = trustedExport({ validScores: [], invalidEvents: 0 });
    const decision = decide(exported);
    expect(decision.decision).toBe("TASK_REPLACE");
    expect(decision.metrics).toMatchObject({
      capturedEvents: 0,
      validNumericEvents: 0,
      validEventRate: 0,
      distinctValidCandidateHashes: 0,
      distinctValidScores: 0,
      cleanSeedScore: null,
      selectedEvaluationId: null,
      selectedCandidateContentSha256: null,
    });
    expect(decision.reasons).toEqual([
      "clean_reverification_failed",
      "insufficient_distinct_candidate_hashes",
      "insufficient_distinct_scores",
      "insufficient_remaining_headroom",
      "insufficient_valid_numeric_events",
      "no_deterministic_best_candidate",
      "no_positive_clean_outer_progress",
      "valid_event_rate_below_threshold",
    ]);
    expect(validateSeedConvergenceDecision(decision)).toBe(decision);
  });

  test("rejects non-positive progress and a seed that leaves less than one meaningful gain", () => {
    const exported = trustedExport();
    const noProgress = decide(exported, seedEvidence(exported, { cleanScore: 110 }));
    expect(noProgress.decision).toBe("TASK_REPLACE");
    expect(noProgress.reasons).toContain("no_positive_clean_outer_progress");

    const saturated = decide(exported, seedEvidence(exported, { cleanScore: 81 }));
    expect(saturated.decision).toBe("TASK_REPLACE");
    expect(saturated.reasons).toContain("insufficient_remaining_headroom");
  });

  test("stops the study when a task fails and no frozen replacement is available", () => {
    const exported = trustedExport({ validScores: [99, 99, 99, 99] });
    const evidence = seedEvidence(exported);
    evidence.runOutcome.eligibleReplacementAvailable = false;
    expect(decide(exported, evidence).decision).toBe("STUDY_STOP");
  });

  test("permits one administrative retry and stops after it is used", () => {
    const exported = trustedExport();
    const baseOutcome = {
      status: "failed",
      failureCategory: "administrative_failure",
      failureCode: "provider-outage",
      administrativeRetryUsed: false,
      eligibleReplacementAvailable: true,
    };
    const retry = decide(exported, seedEvidence(exported, { runOutcome: baseOutcome }));
    expect(retry.decision).toBe("ADMIN_RETRY");
    const exhausted = decide(exported, seedEvidence(exported, {
      runOutcome: { ...baseOutcome, administrativeRetryUsed: true },
    }));
    expect(exhausted.decision).toBe("STUDY_STOP");
  });

  test("routes explicit task and apparatus failures without interpreting them as evidence", () => {
    const exported = trustedExport();
    const taskFailure = seedEvidence(exported, {
      runOutcome: {
        status: "failed",
        failureCategory: "task_failure",
        failureCode: "agent-crash",
        administrativeRetryUsed: false,
        eligibleReplacementAvailable: true,
      },
    });
    expect(decide(exported, taskFailure).decision).toBe("TASK_REPLACE");

    const apparatusFailure = seedEvidence(exported, {
      runOutcome: {
        status: "failed",
        failureCategory: "apparatus_failure",
        failureCode: "budget-ledger-mismatch",
        administrativeRetryUsed: false,
        eligibleReplacementAvailable: true,
      },
    });
    const decision = decide(exported, apparatusFailure);
    expect(decision.decision).toBe("APPARATUS_STOP");
    expect(decision.reasons).toContain("apparatus_failure:budget-ledger-mismatch");
  });

  test("stops the apparatus on source, selection, verifier, or protocol-integrity mismatches", () => {
    const exported = trustedExport();
    const sourceMismatch = seedEvidence(exported, { trustedExportSha256: "f".repeat(64) });
    expect(decide(exported, sourceMismatch).decision).toBe("APPARATUS_STOP");

    const wrongCandidate = seedEvidence(exported);
    wrongCandidate.cleanSelection.candidateContentSha256 = contentHash("wrong");
    wrongCandidate.cleanSelection.candidateArtifactRef = `candidate-artifact:users/bx/${wrongCandidate.cleanSelection.candidateContentSha256}`;
    expect(decide(exported, wrongCandidate).decision).toBe("APPARATUS_STOP");

    const wrongVerifier = seedEvidence(exported);
    wrongVerifier.cleanSelection.verifierSha256 = "c".repeat(64);
    expect(decide(exported, wrongVerifier).decision).toBe("APPARATUS_STOP");

    const wrongRun = seedEvidence(exported);
    wrongRun.producerRun = "run:users/bx/different";
    expect(decide(exported, wrongRun).decision).toBe("APPARATUS_STOP");

    const wrongBaseline = seedEvidence(exported);
    wrongBaseline.task.startingCandidate.candidateContentSha256 = contentHash("wrong-baseline");
    expect(decide(exported, wrongBaseline).decision).toBe("APPARATUS_STOP");

    const violation = seedEvidence(exported, {
      protocolViolations: [{ code: "source-leakage", evidenceSha256: contentHash("violation") }],
    });
    expect(decide(exported, violation).decision).toBe("APPARATUS_STOP");
  });

  test("rejects unknown evidence fields and invalid failure classifications", () => {
    const exported = trustedExport();
    const unknown = { ...seedEvidence(exported), inferredReason: "looks good" };
    expect(() => decide(exported, unknown)).toThrow("keys must be exactly");
    const badFailure = seedEvidence(exported);
    badFailure.runOutcome = {
      ...badFailure.runOutcome,
      status: "failed",
      failureCategory: "administrative_failure",
      failureCode: "unknown-outage",
    };
    expect(() => decide(exported, badFailure)).toThrow("category/code is invalid");
  });

  test("CLI hashes the exact frozen input bytes and starts no run", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seed-convergence-"));
    const exportPath = path.join(directory, "trusted-export.json");
    const evidencePath = path.join(directory, "evidence.json");
    const exported = trustedExport();
    const exportBytes = `${JSON.stringify(exported, null, 2)}\n`;
    const evidence = seedEvidence(exported);
    evidence.trustedExportSha256 = analysisSha256(exportBytes);
    const evidenceBytes = `${JSON.stringify(evidence, null, 2)}\n`;
    await fs.writeFile(exportPath, exportBytes);
    await fs.writeFile(evidencePath, evidenceBytes);
    try {
      const output = execFileSync(
        process.execPath,
        ["src/seed-convergence-cli.js", "--export", exportPath, "--evidence", evidencePath],
        { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" },
      );
      const decision = JSON.parse(output);
      expect(output).toBe(`${canonicalAnalysisJson(decision)}\n`);
      expect(decision.decision).toBe("PASS");
      expect(decision.inputHashes).toEqual({
        trustedExportSha256: analysisSha256(exportBytes),
        evidenceSha256: analysisSha256(evidenceBytes),
      });
      expect(decision.execution).toEqual({ modelCalls: 0, studyRunsStarted: 0 });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
