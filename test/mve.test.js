import { afterEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodexRunner,
  EXECUTOR_SCHEMA,
  Semaphore,
  applyExactReplacements,
  checkCandidateIntegrity,
  codexConfigArguments,
  enabledMcpServers,
  extractCodexResult,
  networkCanaryEvidence,
  promptSurfaceViolations,
  reportRun,
  runBlock,
  runTuningBlock,
  runProcess,
  resumeRun,
  sealedHarnessSuffix,
  tuningCandidatesForBlock,
} from "../src/mve.js";

const temporaries = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yukon-kg-test-"));
  temporaries.push(directory);
  return directory;
}

async function fixtureSource() {
  const root = await temporaryDirectory();
  const file = path.join(root, "src", "point_add", "trailmix_ludicrous", "square", "product_register.rs");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, [
    "fn candidate_surface() {}",
    "pub(super) fn selfcheck() {",
    "    // sealed harness",
    "}",
    "",
  ].join("\n"));
  return root;
}

function fakeCodexResult(message, threadId) {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: threadId }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(message) } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } }),
    "",
  ].join("\n");
  return {
    process: { exitCode: 0, stdout, stderr: "", durationMs: 1 },
    events: stdout.trim().split("\n").map(JSON.parse),
    threadId,
    lastMessage: JSON.stringify(message),
    usage: { input_tokens: 100, output_tokens: 20 },
    errorItems: [],
    attempts: [],
  };
}

class FakeCodexRunner {
  constructor({ invalidExecutorCall = null } = {}) {
    this.calls = 0;
    this.executorCalls = 0;
    this.invalidExecutorCall = invalidExecutorCall;
  }

  async invokeWithRetries(options) {
    this.calls += 1;
    if (options.prompt.startsWith("You are the allocator")) {
      const packetText = options.prompt.split("Decision packet:\n")[1].split("\n\nMost recent host result:")[0];
      const packet = JSON.parse(packetText);
      const base = packet.frontier.at(-1);
      return fakeCodexResult({
        baseArtifactId: base.artifactId,
        interventionFamily: `family-${this.calls}`,
        hypothesis: "A local rewrite reduces the duplicate endpoint.",
        falsifier: "The duplicate endpoint does not decrease.",
        branchBrief: `Add one neutral optimization marker ${this.calls}.`,
        rationale: "The branch isolates one local mechanism.",
        planUpdate: "Test a separate local mechanism next.",
      }, options.sessionId ?? `session-${this.calls}`);
    }
    this.executorCalls += 1;
    if (this.executorCalls === this.invalidExecutorCall) {
      return fakeCodexResult({ status: "no_patch", summary: "No admissible edit.", replacements: [] }, `executor-${this.calls}`);
    }
    return fakeCodexResult({
      status: "implemented",
      summary: "Added the assigned marker.",
      replacements: [{
        old: "pub(super) fn selfcheck()",
        new: `// fake-optimization-${this.executorCalls}\npub(super) fn selfcheck()`,
      }],
    }, `executor-${this.calls}`);
  }
}

class FakeScorer {
  async twice(workspace) {
    const file = path.join(workspace, "src", "point_add", "trailmix_ludicrous", "square", "product_register.rs");
    const source = await fs.readFile(file, "utf8");
    const optimizations = [...source.matchAll(/fake-optimization/gu)].length;
    const score = 1_000 - optimizations;
    return {
      validity: "valid",
      score: {
        emittedToffoli: score,
        executedToffoli: score,
        peakQubits: 1,
        score,
        reproductions: 2,
      },
      reproductions: [],
    };
  }
}

class FakeTuningCodexRunner {
  constructor({ invalidCall = null } = {}) {
    this.calls = 0;
    this.invalidCall = invalidCall;
  }

  async invokeWithRetries(options) {
    this.calls += 1;
    const packetText = options.prompt.split("Decision packet:\n")[1].split("\n\nMost recent host result:")[0];
    const packet = JSON.parse(packetText);
    if (this.calls === this.invalidCall) return fakeCodexResult({ nope: true }, `tuning-${this.calls}`);
    const condition = packet.condition;
    const candidate = condition === "blinded" && packet.evidence.length >= 6
      ? (packet.instruction.includes("four fresh") ? packet.candidates[0] : packet.candidates.at(-1))
      : packet.candidates.at(-1);
    return fakeCodexResult({
      candidateId: candidate.candidateId,
      hypothesis: `The ${candidate.candidateId} setting changes the operation and qubit tradeoff.`,
      falsifier: "The repeated host score does not improve.",
      rationale: "The candidate isolates one configuration region.",
      planUpdate: "Compare the next available configuration region.",
    }, options.sessionId ?? `tuning-${this.calls}`);
  }
}

class FakeTuningScorer {
  constructor() {
    this.calls = 0;
  }

  async twice(_workspace, _targetDirectory, environment = {}) {
    this.calls += 1;
    const ladder = Number(environment.SUB4_SQUARE_LADDER);
    const seedLadders = new Set([8, 32, 36, 54, 58, 62, 66, 80, 96, 98, 144, 192]);
    const score = seedLadders.has(ladder) ? 1_000 : 1_000 - ladder;
    return {
      validity: "valid",
      score: {
        emittedToffoli: score,
        executedToffoli: score,
        peakQubits: 1,
        score,
        reproductions: 2,
      },
      reproductions: [],
    };
  }
}

afterEach(async () => {
  while (temporaries.length > 0) await fs.rm(temporaries.pop(), { recursive: true, force: true });
});

describe("runtime primitives", () => {
  test("assigns block-specific opaque options and keeps the optimum out of the shared seed slate", () => {
    const first = tuningCandidatesForBlock("block-1");
    const second = tuningCandidatesForBlock("block-2");
    expect(first).toHaveLength(92);
    expect(first.every((candidate) => /^option-[0-9a-f]{12}$/u.test(candidate.candidateId))).toBe(true);
    expect(first.map((candidate) => candidate.candidateId)).not.toEqual(second.map((candidate) => candidate.candidateId));
    const seeds = first.filter((candidate) => candidate.preludeSeed);
    expect(seeds).toHaveLength(12);
    expect(seeds.some((candidate) => [44, 46].includes(candidate.ladder))).toBe(false);
  });

  test("distinguishes enabled skills from generic wrappers and parses host MCP diagnostics", () => {
    expect(promptSurfaceViolations("<skills_instructions>\n<apps_instructions>\n<plugins_instructions>"))
      .toEqual([]);
    expect(promptSurfaceViolations("- summarize: helper (file: /tmp/summarize/SKILL.md)"))
      .toEqual(["prompt surface still includes enabled skill entries"]);
    expect(enabledMcpServers([
      "Name              Command  Status",
      "computer-history  x        enabled",
      "deepwiki          y        enabled",
      "computer-use      z        disabled",
    ].join("\n"))).toEqual(["computer-history", "deepwiki"]);
  });

  test("extracts session, message, usage, and errors from Codex JSONL", () => {
    const processResult = {
      exitCode: 0,
      stderr: "",
      stdout: [
        '{"type":"thread.started","thread_id":"thread-1"}',
        '{"type":"item.completed","item":{"type":"error","message":"warning"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
      ].join("\n"),
    };
    const result = extractCodexResult(processResult);
    expect(result.threadId).toBe("thread-1");
    expect(result.lastMessage).toBe('{"ok":true}');
    expect(result.usage.input_tokens).toBe(10);
    expect(result.errorItems).toEqual(["warning"]);
  });

  test("applies only exact, unique source replacements", () => {
    expect(EXECUTOR_SCHEMA.required).toContain("replacements");
    expect(applyExactReplacements("alpha\nbeta\n", [{ old: "beta", new: "gamma" }])).toBe("alpha\ngamma\n");
    expect(() => applyExactReplacements("alpha alpha", [{ old: "alpha", new: "beta" }])).toThrow("matched 2");
    expect(() => applyExactReplacements("alpha", [{ old: "alpha", new: "alpha" }])).toThrow("does not change");
  });

  test("judges network isolation from completed command output", () => {
    const event = (aggregatedOutput) => ({
      type: "item.completed",
      item: { type: "command_execution", aggregated_output: aggregatedOutput },
    });
    expect(networkCanaryEvidence([event("curl failed\nNETWORK_BLOCKED")])).toMatchObject({ blocked: true, open: false });
    expect(networkCanaryEvidence([event("NETWORK_OPEN")])).toMatchObject({ blocked: false, open: true });
    expect(networkCanaryEvidence([{
      type: "item.started",
      item: { type: "command_execution", command: "printf NETWORK_BLOCKED", aggregated_output: "" },
    }])).toMatchObject({ blocked: false, open: false });
  });

  test("retries only infrastructure failures that occur before model output", async () => {
    const runner = new CodexRunner({ skills: [] });
    let calls = 0;
    runner.invoke = async () => {
      calls += 1;
      if (calls < 3) {
        const failed = fakeCodexResult({ ignored: true }, `failed-${calls}`);
        failed.process.exitCode = 1;
        failed.lastMessage = null;
        return failed;
      }
      return fakeCodexResult({ ok: true }, "completed");
    };
    const recovered = await runner.invokeWithRetries({});
    expect(recovered.threadId).toBe("completed");
    expect(recovered.attempts).toHaveLength(3);

    calls = 0;
    runner.invoke = async () => {
      calls += 1;
      const modelFailure = fakeCodexResult({ invalid: true }, "model-failure");
      modelFailure.process.exitCode = 1;
      return modelFailure;
    };
    const consumed = await runner.invokeWithRetries({});
    expect(consumed.process.exitCode).toBe(1);
    expect(consumed.attempts).toHaveLength(1);
    expect(calls).toBe(1);
  });

  test("removes shell tools from worker profiles but retains them for the network canary", () => {
    const worker = codexConfigArguments({ reasoning: "medium", skills: [] });
    const canary = codexConfigArguments({ reasoning: "low", skills: [], allowShell: true });
    expect(worker.join(" ")).toContain("--disable shell_tool");
    expect(worker.join(" ")).toContain("--disable unified_exec");
    expect(worker.join(" ")).toContain("mcp_servers={}");
    expect(worker.join(" ")).toContain("--disable multi_agent_v2");
    expect(worker.join(" ")).toContain("--disable enable_fanout");
    expect(canary.join(" ")).not.toContain("--disable shell_tool");
  });

  test("can remove inherited host context from child processes", async () => {
    const result = await runProcess("zsh", ["-c", "printf %s ${MVE_HOST_CONTEXT-unset}"], {
      env: { MVE_HOST_CONTEXT: "present" },
      unsetEnv: ["MVE_HOST_CONTEXT"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("unset");
  });

  test("enforces concurrency", async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let maximum = 0;
    await Promise.all(Array.from({ length: 8 }, () => semaphore.use(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Bun.sleep(5);
      active -= 1;
    })));
    expect(maximum).toBe(2);
  });

  test("records process timeouts", async () => {
    const result = await runProcess(process.execPath, ["-e", "await Bun.sleep(500)"], { timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("rejects changes outside the product file and inside the sealed harness", async () => {
    const root = await fixtureSource();
    await Bun.$`git init -q`.cwd(root);
    await Bun.$`git config user.name Test`.cwd(root);
    await Bun.$`git config user.email test@invalid`.cwd(root);
    await Bun.$`git add -A`.cwd(root);
    await Bun.$`git commit -q -m baseline`.cwd(root);
    const suffix = await sealedHarnessSuffix(root);
    const outside = path.join(root, "src", "other.rs");
    await fs.writeFile(outside, "changed\n");
    await Bun.$`git add -N src/other.rs`.cwd(root);
    expect((await checkCandidateIntegrity(root, suffix)).reason).toBe("outside_allowed_file");
    await fs.rm(outside);
    const file = path.join(root, "src", "point_add", "trailmix_ludicrous", "square", "product_register.rs");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("sealed harness", "tampered harness"));
    expect((await checkCandidateIntegrity(root, suffix)).reason).toBe("protected_harness_modified");
  });
});

describe("full block state machine", () => {
  test("rejects resuming the retired source-mutation protocol", async () => {
    const runDirectory = await temporaryDirectory();
    await fs.writeFile(path.join(runDirectory, "manifest.json"), JSON.stringify({ protocolVersion: "yukon-kg.handoff-mve.v1" }));
    await expect(resumeRun(runDirectory)).rejects.toThrow("retired protocol");
    const report = await reportRun(runDirectory);
    expect(report.rows[0]).toMatchObject({
      area: "Retired source-mutation pilot",
      verdict: "TASK_UNINFORMATIVE",
    });
    expect(report.proceedToLiveCourt).toBe(false);

    const incompleteDirectory = await temporaryDirectory();
    await fs.writeFile(path.join(incompleteDirectory, "manifest.json"), JSON.stringify({ protocolVersion: "yukon-kg.handoff-mve.v5" }));
    const incompleteReport = await reportRun(incompleteDirectory);
    expect(incompleteReport.rows[0]).toMatchObject({
      area: "Retired incomplete protocol",
      verdict: "INVALID",
    });
  });

  test("runs 6 + 4x4 evaluations and resumes without extra model calls", async () => {
    const source = await fixtureSource();
    const runDirectory = await temporaryDirectory();
    const codexRunner = new FakeCodexRunner({ invalidExecutorCall: 3 });
    const scorer = new FakeScorer();
    const schemas = {
      allocator: path.join(runDirectory, "allocator.json"),
      executor: path.join(runDirectory, "executor.json"),
    };
    await fs.writeFile(schemas.allocator, "{}");
    await fs.writeFile(schemas.executor, "{}");
    const harnessSuffix = await sealedHarnessSuffix(source);
    const baselineArtifact = {
      artifactId: "baseline",
      path: source,
      validity: "valid",
      score: {
        emittedToffoli: 1_000,
        executedToffoli: 1_000,
        peakQubits: 1,
        score: 1_000,
        reproductions: 2,
      },
    };
    const options = {
      blockId: "fixture-block",
      runDirectory,
      baselineArtifact,
      codexRunner,
      scorer,
      schemas,
      harnessSuffix,
    };
    const first = await runBlock(options);
    expect(first.apparatusStatus).toBe("PASS");
    expect(Object.values(first.conditions).map((condition) => condition.evaluations)).toEqual([4, 4, 4, 4]);
    expect(codexRunner.calls).toBe(44);
    expect(codexRunner.executorCalls).toBe(22);
    const invalidPrelude = JSON.parse(await fs.readFile(path.join(
      runDirectory,
      "blocks",
      "fixture-block",
      "prelude",
      "2",
      "record.json",
    ), "utf8"));
    expect(invalidPrelude.validity).toBe("invalid");
    expect(invalidPrelude.reason).toBe("no_patch");
    const calls = codexRunner.calls;
    const second = await runBlock(options);
    expect(second).toEqual(first);
    expect(codexRunner.calls).toBe(calls);

    const interruptedRecord = path.join(
      runDirectory,
      "blocks",
      "fixture-block",
      "conditions",
      "D",
      "3",
      "record.json",
    );
    const completedResult = path.join(runDirectory, "blocks", "fixture-block", "result.json");
    await fs.rm(interruptedRecord);
    await fs.rm(completedResult);
    const resumed = await runBlock(options);
    expect(resumed.conditions).toEqual(first.conditions);
    expect(resumed.pilotEffects).toEqual(first.pilotEffects);
    expect(codexRunner.calls).toBe(calls);

    const slotDirectory = path.dirname(interruptedRecord);
    for (const filename of ["decision.json", "allocator-message.json"]) {
      const filenamePath = path.join(slotDirectory, filename);
      const saved = JSON.parse(await fs.readFile(filenamePath, "utf8"));
      saved.promptHash = "stale-packet-hash";
      await fs.writeFile(filenamePath, JSON.stringify(saved));
    }
    await fs.rm(interruptedRecord);
    await fs.rm(completedResult);
    await runBlock(options);
    expect(codexRunner.calls).toBe(calls + 2);
  }, 30_000);

  test("tuning search uses one allocator call per evaluation and resumes idempotently", async () => {
    const source = await fixtureSource();
    const runDirectory = await temporaryDirectory();
    const codexRunner = new FakeTuningCodexRunner({ invalidCall: 3 });
    const scorer = new FakeTuningScorer();
    const schemas = {
      allocator: path.join(runDirectory, "allocator.json"),
      tuningAllocator: path.join(runDirectory, "tuning-allocator.json"),
    };
    await fs.writeFile(schemas.allocator, "{}");
    await fs.writeFile(schemas.tuningAllocator, "{}");
    const baselineArtifact = {
      artifactId: "baseline",
      path: source,
      validity: "valid",
      score: {
        emittedToffoli: 1_000,
        executedToffoli: 1_000,
        peakQubits: 1,
        score: 1_000,
        reproductions: 2,
      },
    };
    const options = {
      blockId: "tuning-fixture-block",
      runDirectory,
      baselineArtifact,
      optimumScore: 850,
      codexRunner,
      scorer,
      schemas,
    };
    const first = await runTuningBlock(options);
    expect(first.apparatusStatus).toBe("PASS");
    expect(first.taskInformativeness.status).toBe("PASS");
    expect(Object.values(first.conditions).map((condition) => condition.evaluations)).toEqual([4, 4, 4, 4]);
    expect(codexRunner.calls).toBe(22);
    expect(scorer.calls).toBe(21);
    const invalidPrelude = JSON.parse(await fs.readFile(path.join(
      runDirectory,
      "blocks",
      "tuning-fixture-block",
      "prelude",
      "2",
      "record.json",
    ), "utf8"));
    expect(invalidPrelude.validity).toBe("invalid");
    expect(invalidPrelude.reason).toBe("allocator_selected_unknown_candidate");
    const calls = codexRunner.calls;
    const second = await runTuningBlock(options);
    expect(second).toEqual(first);
    expect(codexRunner.calls).toBe(calls);

    const interruptedRecord = path.join(
      runDirectory,
      "blocks",
      "tuning-fixture-block",
      "conditions",
      "D",
      "3",
      "record.json",
    );
    const completedResult = path.join(runDirectory, "blocks", "tuning-fixture-block", "result.json");
    await fs.rm(interruptedRecord);
    await fs.rm(completedResult);
    const resumed = await runTuningBlock(options);
    expect(resumed.conditions).toEqual(first.conditions);
    expect(resumed.pilotEffects).toEqual(first.pilotEffects);
    expect(codexRunner.calls).toBe(calls);

    const slotDirectory = path.dirname(interruptedRecord);
    for (const filename of ["decision.json", "allocator-message.json"]) {
      const filenamePath = path.join(slotDirectory, filename);
      const saved = JSON.parse(await fs.readFile(filenamePath, "utf8"));
      saved.promptHash = "stale-packet-hash";
      await fs.writeFile(filenamePath, JSON.stringify(saved));
    }
    await fs.rm(interruptedRecord);
    await fs.rm(completedResult);
    await runTuningBlock(options);
    expect(codexRunner.calls).toBe(calls + 1);
    expect(scorer.calls).toBe(21);
  }, 30_000);
});
