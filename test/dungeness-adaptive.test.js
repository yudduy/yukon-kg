import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../src/mve.js";
import {
  CALIBRATION_PAIR_COUNT,
  CONFIRMATORY_INTERIMS,
  analyzeAdaptiveCampaigns,
  buildPairedAssignments,
  estimateConfirmatoryPairs,
  freezeAdaptiveProtocol,
  parseDungenessAdapter,
  sha256,
} from "../src/dungeness-adaptive-protocol.js";
import {
  parseDungenessEvaluation,
  runDungenessCampaign,
} from "../src/dungeness-campaign-runner.js";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function checkpoint(id, gitRef = "a".repeat(40)) {
  return {
    id,
    gitRef,
    baselineScore: 100,
    developmentPanelSha256: sha256(`development:${id}`),
    hiddenPanelSha256: sha256(`hidden:${id}`),
  };
}

function adapterValue(repoSha = "a".repeat(40)) {
  return {
    schema: "yukon-kg.dungeness-adapter.v1",
    repoSha,
    mutableGlobs: ["src/point_add/**"],
    setupCommand: null,
    evaluator: {
      developmentCommand: ["bun", "evaluator.js", "development"],
      hiddenCommand: ["bun", "evaluator.js", "hidden"],
      timeoutMs: 10_000,
    },
    checkpoints: Array.from({ length: 8 }, (_, index) => checkpoint(`checkpoint-${index + 1}`, repoSha)),
  };
}

function campaign(pairId, checkpointId, arm, gain, overrides = {}) {
  return {
    pairId,
    checkpointId,
    arm,
    normalizedGain: gain,
    invalidRate: 0,
    costUsd: 1,
    provenanceViolations: [],
    ...overrides,
  };
}

describe("adaptive campaign protocol", () => {
  test("freezes exactly eight checkpoints and deterministic paired assignments", () => {
    const adapter = parseDungenessAdapter(adapterValue());
    const first = buildPairedAssignments({
      checkpoints: adapter.checkpoints,
      pairCount: CALIBRATION_PAIR_COUNT,
      phase: "calibration",
      seed: "frozen-seed",
    });
    const second = buildPairedAssignments({
      checkpoints: adapter.checkpoints,
      pairCount: CALIBRATION_PAIR_COUNT,
      phase: "calibration",
      seed: "frozen-seed",
    });
    expect(first).toEqual(second);
    expect(first).toHaveLength(2 * CALIBRATION_PAIR_COUNT);
    expect(new Set(first.map((row) => row.pairId)).size).toBe(CALIBRATION_PAIR_COUNT);
    for (const pairId of new Set(first.map((row) => row.pairId))) {
      const pair = first.filter((row) => row.pairId === pairId);
      expect(new Set(pair.map((row) => row.arm))).toEqual(new Set(["state_static", "state_adaptive"]));
      expect(pair.map((row) => row.waveOrder).sort()).toEqual([0, 1]);
    }
  });

  test("rejects unpinned adapters and mutable harness files", () => {
    expect(() => parseDungenessAdapter({ ...adapterValue(), repoSha: "bad" })).toThrow(/commit hash/i);
    expect(() => parseDungenessAdapter({
      ...adapterValue(),
      mutableGlobs: ["Cargo.toml"],
    })).toThrow(/src\/point_add/i);
    expect(() => parseDungenessAdapter(adapterValue(), {
      expectedRepoSha: "b".repeat(40),
    })).toThrow(/checkout/i);
  });

  test("freezes model, provider, budgets, pins, and assignments into one hash", () => {
    const adapter = parseDungenessAdapter(adapterValue());
    const input = {
      adapter,
      dungenessPin: { repo: "https://github.com/Layr-Labs/dungeness.git", sha: adapter.repoSha },
      atlasReleaseId: "1".repeat(64),
      atlasManifestSha256: "2".repeat(64),
      model: "openai/gpt-5.4",
      provider: "OpenAI",
      decoding: { temperature: 0, maxTokens: 2048 },
      seed: "protocol-seed",
      createdAt: "2026-08-27T00:00:00.000Z",
    };
    const protocol = freezeAdaptiveProtocol(input);
    expect(protocol.calibration.assignments).toHaveLength(32);
    expect(protocol.confirmatory.assignments).toHaveLength(160);
    expect(protocol.protocolSha256).toHaveLength(64);
    expect(freezeAdaptiveProtocol(input)).toEqual(protocol);
  });

  test("powers from calibration and makes only the preregistered interim decision", () => {
    const calibration = Array.from({ length: 16 }, (_, index) => {
      const pairId = `cal-${index}`;
      const checkpointId = `checkpoint-${index % 8}`;
      return [
        campaign(pairId, checkpointId, "state_static", 0),
        campaign(pairId, checkpointId, "state_adaptive", 0.1),
      ];
    }).flat();
    const power = estimateConfirmatoryPairs(calibration);
    expect(CONFIRMATORY_INTERIMS).toContain(power.scheduledPairs);
    expect(power.projectedMaxSpendUsd).toBeGreaterThan(0);

    const confirmatory = Array.from({ length: 80 }, (_, index) => {
      const pairId = `confirm-${index}`;
      const checkpointId = `checkpoint-${index % 8}`;
      return [
        campaign(pairId, checkpointId, "state_static", 0),
        campaign(pairId, checkpointId, "state_adaptive", 0.1),
      ];
    }).flat();
    const report = analyzeAdaptiveCampaigns(confirmatory);
    expect(report.decision).toBe("ADOPT_ADAPTIVE_STATE");
    expect(report.positiveCheckpoints).toBe(8);
    expect(report.provenanceViolations).toBe(0);
  });
});

describe("Dungeness evaluator and campaign runner", () => {
  test("requires strict evaluator JSON and all validity dimensions", () => {
    const valid = parseDungenessEvaluation({
      exitCode: 0,
      stdout: JSON.stringify({
        schema: "yukon-kg.dungeness-evaluation.v1",
        score: 90,
        qualification: {
          classicalOutput: "passed",
          ancillae: "passed",
          globalPhase: "passed",
          reverseExecution: "passed",
        },
      }),
    });
    expect(valid).toMatchObject({ score: 90, valid: true });
    expect(() => parseDungenessEvaluation({ exitCode: 0, stdout: "{}" })).toThrow(/schema/i);
  });

  test("runs an isolated adaptive campaign against a host evaluator", async () => {
    const root = await mkdtemp(join(tmpdir(), "yukon-dungeness-"));
    temporaryRoots.push(root);
    const repo = join(root, "repo");
    const runs = join(root, "runs");
    await mkdir(join(repo, "src", "point_add"), { recursive: true });
    await writeFile(join(repo, "src", "point_add", "candidate.txt"), "100\n");
    await writeFile(join(repo, "evaluator.js"), `
      import { readFile } from "node:fs/promises";
      const value = Number((await readFile("src/point_add/candidate.txt", "utf8")).trim());
      process.stdout.write(JSON.stringify({
        schema: "yukon-kg.dungeness-evaluation.v1",
        score: value,
        qualification: {
          classicalOutput: "passed",
          ancillae: "passed",
          globalPhase: "passed",
          reverseExecution: "passed"
        }
      }));
    `);
    await runProcess("git", ["init"], { cwd: repo });
    await runProcess("git", ["config", "user.name", "Fixture"], { cwd: repo });
    await runProcess("git", ["config", "user.email", "fixture@example.com"], { cwd: repo });
    await runProcess("git", ["add", "."], { cwd: repo });
    await runProcess("git", ["commit", "-m", "fixture"], { cwd: repo });
    const revision = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const adapter = parseDungenessAdapter(adapterValue(revision));
    adapter.checkpoints = adapter.checkpoints.map((item) => ({ ...item, gitRef: revision }));
    const protocol = freezeAdaptiveProtocol({
      adapter,
      dungenessPin: { repo: "fixture", sha: revision },
      atlasReleaseId: "1".repeat(64),
      atlasManifestSha256: "2".repeat(64),
      model: "openai/gpt-5.4",
      provider: "fixture",
      decoding: { temperature: 0, maxTokens: 512 },
      seed: "fixture-seed",
      createdAt: "2026-08-27T00:00:00.000Z",
      budget: {
        turns: 4,
        rootTokens: 10_000,
        descendantTokens: 1,
        evaluatorCalls: 2,
        wallClockMs: 60_000,
        costUsd: 1,
      },
    });
    const assignment = protocol.calibration.assignments.find((item) => item.arm === "state_adaptive");
    const completions = [
      {
        content: "",
        toolCalls: [
          {
            id: "write-1",
            function: {
              name: "write_file",
              arguments: JSON.stringify({ path: "src/point_add/candidate.txt", content: "90\n" }),
            },
          },
          {
            id: "evaluate-1",
            function: {
              name: "evaluate",
              arguments: JSON.stringify({ proposalId: "lower-fixture-score" }),
            },
          },
        ],
        usage: { total_tokens: 100, cost: 0.01 },
        provider: "fixture",
        systemFingerprint: "fixture-v1",
      },
      {
        content: "",
        toolCalls: [{
          id: "finish-1",
          function: { name: "finish", arguments: JSON.stringify({ summary: "done" }) },
        }],
        usage: { total_tokens: 20, cost: 0.002 },
        provider: "fixture",
        systemFingerprint: "fixture-v1",
      },
    ];
    const result = await runDungenessCampaign({
      assignment,
      protocol,
      adapter,
      checkpoint: adapter.checkpoints[0],
      briefText: "{}",
      dungenessRepo: repo,
      runRoot: runs,
      completionFn: async () => completions.shift(),
    });
    expect(result.bestValidScore).toBe(90);
    expect(result.normalizedGain).toBeCloseTo(0.1);
    expect(result.evaluatorCalls).toBe(1);
    expect(result.provenanceViolations).toEqual([]);
    expect(result.hiddenAdjudication).toHaveLength(1);
    expect(result.providerRoutes).toEqual(["fixture"]);
  });
});
