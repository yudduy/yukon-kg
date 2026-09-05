import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  RESEARCH_EVENT_SCHEMA,
  adaptDungenessTrustedExport,
  appendDungenessEvents,
  assertNoAdvisoryDerivation,
  assertSafeRelativePath,
  buildEcdsaVerificationPlan,
  canonicalStringify,
  compileDungenessEvents,
  compileDungenessCampaign,
  compileResearchViews,
  countDeterministicTokens,
  loadCompiledResearchView,
  loadDatedEcdsaCalibrationCohort,
  serializeResearchEvent,
  sha256,
  validateResearchEvent,
  writeResearchViews,
} from "../src/research-view.js";

const TARGET = Object.freeze({ taskId: "task-1", metricName: "cost", direction: "-" });

function sourceSets() {
  const core = {
    releaseId: "fixture-release",
    manifestSha256: "a".repeat(64),
    sources: [{ path: "runs/fixture.json", sha256: "b".repeat(64) }],
  };
  return [{ sourceSetId: sha256(core), ...core }];
}

function intervention(id, ideaId = "idea:a", site = "src/a.js::f") {
  return {
    changeId: `change-${id}`,
    constraintIds: ["constraint:cost"],
    ideaIds: [ideaId],
    phase: "unknown",
    relation: "instance_of",
    reviewDisposition: null,
    site,
    title: `Change ${id}`,
  };
}

function event(id, createdAt, {
  score = 100,
  gain = 0,
  status = "promoted",
  admission = "unknown",
  comparatorArtifactId = "prior",
  comparatorHops = 1,
  interventions = [intervention(id)],
  routeInterpretation = "focused",
  policyCoupled = false,
} = {}) {
  const diffText = `diff --git a/src/${id}.js b/src/${id}.js\n`;
  return {
    schema: RESEARCH_EVENT_SCHEMA,
    eventId: id,
    sequence: { kind: "timestamp", value: createdAt },
    baseArtifactId: "prior",
    baseArtifactSha256: "a".repeat(64),
    candidateArtifactId: `artifact-${id}`,
    candidateArtifactSha256: "b".repeat(64),
    commitSha: id.padEnd(40, "0").slice(0, 40),
    changeSet: {
      diff: { text: diffText, sha256: sha256(diffText) },
      changedPaths: [`src/${id}.js`],
      changedSymbols: [`symbol_${id}`],
      configuration: { knob: id },
    },
    interventions,
    conditions: {
      taskId: TARGET.taskId,
      checkpointId: "checkpoint-1",
      bundleSize: interventions.length,
      policyCoupled,
      routeInterpretation,
      hasUnresolved: false,
      configuration: null,
      seed: null,
      environment: null,
      harness: null,
    },
    execution: {
      evaluationId: null,
      modelProvider: null,
      modelId: null,
      reasoningEffort: null,
      modelCost: null,
      evaluationCost: null,
      totalCost: null,
    },
    outcome: {
      status,
      sourceStatus: status,
      validity: score === null ? "invalid" : "valid",
      classification: "artifact_and_measurement",
      metricName: TARGET.metricName,
      direction: TARGET.direction,
      score,
      comparatorArtifactId,
      comparatorScore: comparatorArtifactId === null || score === null ? null : score + gain,
      comparatorHops,
      rawDelta: gain === null ? null : -gain,
      directionalGain: gain,
      scope: "whole_artifact",
      admission,
    },
    provenance: {
      sourceSetId: sourceSets()[0].sourceSetId,
      evidenceSha256: ["b".repeat(64)],
      selectors: [{ sourceRef: 0, selector: `event:${id}` }],
    },
  };
}

function fixtureCompilation() {
  const events = [
    event("1", "2026-08-27T00:00:00.000Z", {
      interventions: [intervention("1a"), intervention("1b", "idea:b", "src/b.js::g")],
      routeInterpretation: "mixed",
      policyCoupled: true,
    }),
    event("2", "2026-08-27T00:01:00.000Z", { score: 90, gain: 10 }),
    event("3", "2026-08-27T00:02:00.000Z", {
      score: 90,
      gain: 10,
      comparatorArtifactId: null,
      comparatorHops: null,
      interventions: [intervention("3", "idea:c", "src/c.js::h")],
    }),
  ];
  return compileResearchViews({
    events,
    sourceSets: sourceSets(),
    target: TARGET,
    cutoff: "2026-08-27T00:02:00.000Z",
    cutoffSealSha256: "c".repeat(64),
  });
}

function trustedDungenessExport(createdAt) {
  const diffText = "--- a/src/d.js\n+++ b/src/d.js\n@@ -1 +1 @@\n-old\n+new\n";
  const parent = "3".repeat(64);
  const candidate = "4".repeat(64);
  return {
    schema: "dungeness.trusted-research-events.v1",
    run: { id: "run-4", ref: "run:users/bx/run-4" },
    selection: ["0004"],
    task: { ref: TARGET.taskId, id: "task-1", interface: "file-v1", candidate: { allowed_paths: ["src/d.js"] } },
    checkpoint: { ref: "checkpoint-1", id: "checkpoint-1", repository: {}, interface: "file-v1", web_cutoff: createdAt },
    seed: { initialization: { mode: "checkpoint" }, evaluation_baseline: { content_sha256: parent }, checkpoint_commit: "a".repeat(40) },
    environment: { model: { provider: "provider", upstream_id: "model" }, resources: {}, policies: {}, limits: {} },
    harness: { adapter: {}, evaluation: {}, verifier: {} },
    events: [{
      evaluation_id: "0004",
      created_at: createdAt,
      candidate_commit_sha: null,
      parent_content_sha256: parent,
      content_sha256: candidate,
      candidate_paths: ["src/d.js"],
      payload: { algorithm: "tree-sha256-v1", sha256: candidate, file_count: 1, bytes: 3, files: [{ path: "src/d.js", sha256: "5".repeat(64), bytes: 3 }] },
      exact_diff: { sha256: sha256(diffText), text: diffText },
      changes: { paths: ["src/d.js"], symbols: ["fn d"], config: ["KNOB"], detection: "trusted-diff-v1" },
      development_outcome: {
        valid: true,
        status: "ok",
        metric: { name: TARGET.metricName, direction: "minimize", value: 85 },
        measurement: {
          status: "valid",
          validity: "valid",
          metric_name: TARGET.metricName,
          direction: TARGET.direction,
          score: 85,
          comparator_content_sha256: parent,
          comparator_score: 90,
          comparator_hops: 1,
          raw_delta: -5,
          directional_gain: 5,
          admission: "admitted",
        },
      },
      cost: { scope: "cumulative-at-evaluation" },
      timing: { elapsed_ms: 100, cumulative_elapsed_ms: 100 },
      budget: { evaluations_used: 1, evaluations_limit: 4 },
      provenance: { event_path: "usage/evaluations/0004/event.json", event_sha256: "6".repeat(64), source_transport_sha256: "7".repeat(64) },
      execution: {
        evaluation_id: "0004",
        model_provider: "provider",
        model_id: "model",
        reasoning_effort: "high",
        model_cost: { normalized_usd: 1 },
        evaluation_cost: { evaluations: 1, compute_ms: 100 },
        total_cost: { normalized_usd: null, evaluation_compute_ms: 100 },
      },
    }],
  };
}

describe("ResearchEvent schema", () => {
  test("serializes immutable events canonically and keeps one whole-artifact outcome", () => {
    const bundled = event("1", "2026-08-27T00:00:00.000Z", {
      interventions: [intervention("a"), intervention("b")],
    });
    expect(validateResearchEvent(bundled)).toBe(bundled);
    expect(serializeResearchEvent(bundled)).toBe(canonicalStringify(bundled));
    expect(bundled.interventions).toHaveLength(2);
    expect(bundled.outcome.scope).toBe("whole_artifact");
    expect(Object.hasOwn(bundled.interventions[0], "outcome")).toBe(false);
  });

  test("rejects unknown coercion, advisory derivation, and unsafe paths", () => {
    const coerced = event("1", "2026-08-27T00:00:00.000Z");
    coerced.conditions.configuration = "unknown";
    expect(() => validateResearchEvent(coerced)).toThrow("use null");
    expect(() => assertNoAdvisoryDerivation({ recommendation: "measure a" })).toThrow("advisory field");
    expect(() => assertNoAdvisoryDerivation({ statement: "You should measure a" })).toThrow("advisory language");
    expect(() => assertSafeRelativePath("../secret.json")).toThrow("escapes");
    expect(() => assertSafeRelativePath("%2e%2e/secret.json")).toThrow("escapes");
  });

  test("retains authored none enums without treating them as missing data", () => {
    const configured = event("1", "2026-08-27T00:00:00.000Z");
    configured.conditions.environment = {
      verifier: { network: "none" },
      model: { reasoningSummary: "none" },
    };
    expect(validateResearchEvent(configured)).toBe(configured);
  });

  test("requires explicit fields instead of silently dropping undefined", () => {
    const invalid = event("1", "2026-08-27T00:00:00.000Z");
    invalid.conditions.seed = undefined;
    expect(() => validateResearchEvent(invalid)).toThrow("undefined");
  });
});

describe("deterministic representation compiler", () => {
  test("keeps atom bytes equal while adding R0, R1, and R2 indexes", () => {
    const compilation = fixtureCompilation();
    const tables = Object.values(compilation.views).map((view) => canonicalStringify(view.payload.atomTable));
    expect(new Set(tables).size).toBe(1);
    expect(compilation.views.R0.index.chronology).toHaveLength(3);
    expect(compilation.views.R1.index.frontier).toHaveLength(2);
    expect(compilation.views.R1.index.target).toEqual(TARGET);
    expect(compilation.views.R1.index.artifactLineage).toHaveLength(3);
    expect(compilation.views.R1.index.conditions.conditionGroups.groups.length).toBeGreaterThan(0);
    expect(compilation.views.R1.index.conditions.interventionGroups.groups.length).toBeGreaterThan(0);
    expect(compilation.views.R2.index.unresolved.bundledAttribution).toHaveLength(1);
    expect(compilation.views.R2.index.unresolved.mixedObservedOutcomes).toHaveLength(1);
    expect(compilation.views.R2.index.unresolved.unreplicatedPositiveGain.length).toBeGreaterThan(0);
    expect(compilation.views.R2.index.unresolved.missingMatchedControl).toHaveLength(1);

    const left = event("4", "2026-08-27T00:03:00.000Z");
    const right = event("5", "2026-08-27T00:04:00.000Z");
    right.conditions.seed = { value: 2 };
    const matched = compileResearchViews({
      events: [left, right],
      sourceSets: sourceSets(),
      target: TARGET,
      cutoff: "2026-08-27T00:04:00.000Z",
      cutoffSealSha256: "d".repeat(64),
    });
    expect(matched.views.R2.index.unresolved.oneConditionDifferent).toEqual([
      ["seed", "0", "1"],
    ]);
  });

  test("is byte deterministic and content-addresses payloads and manifests", () => {
    const first = fixtureCompilation();
    const second = fixtureCompilation();
    for (const representation of ["R0", "R1", "R2"]) {
      expect(first.views[representation].atomsBytes).toBe(second.views[representation].atomsBytes);
      expect(first.views[representation].indexMarkdown).toBe(second.views[representation].indexMarkdown);
      expect(first.views[representation].tree.sha256).toBe(second.views[representation].tree.sha256);
    }
  });

  test("indexes condition groups without duplicating recorded condition payloads", () => {
    const recordedEnvironment = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`condition-${String(index).padStart(3, "0")}`, index]),
    );
    const events = Array.from({ length: 1 }, (_, index) => {
      const item = event(
        String(index + 1),
        `2026-08-27T00:0${index}:00.000Z`,
        { score: 100 - index, gain: index },
      );
      item.conditions.environment = recordedEnvironment;
      return item;
    });
    const compilation = compileResearchViews({
      events,
      sourceSets: sourceSets(),
      target: TARGET,
      cutoff: "2026-08-27T00:00:00.000Z",
      cutoffSealSha256: "e".repeat(64),
    });
    expect(compilation.views.R1.index.conditions.conditionGroups.groups).toHaveLength(1);
    expect(compilation.views.R1.indexMarkdown).not.toContain("condition-000");
    expect(compilation.views.R1.audit.observedTokens.index).toBeLessThanOrEqual(4_000);
    expect(compilation.views.R2.audit.observedTokens.index).toBeLessThanOrEqual(4_000);
  });

  test("seals the cutoff and enforces both deterministic token limits", () => {
    const future = event("1", "2026-08-27T00:03:00.000Z");
    expect(() => compileResearchViews({
      events: [future],
      sourceSets: sourceSets(),
      target: TARGET,
      cutoff: "2026-08-27T00:02:00.000Z",
      cutoffSealSha256: "c".repeat(64),
    })).toThrow("after the sealed cutoff");
    expect(() => compileResearchViews({
      events: [event("1", "2026-08-27T00:00:00.000Z")],
      sourceSets: sourceSets(),
      target: TARGET,
      cutoff: "2026-08-27T00:00:00.000Z",
      cutoffSealSha256: "c".repeat(64),
      limits: { total: 10, index: 10 },
    })).toThrow("payload uses");
    expect(countDeterministicTokens("12345")).toBe(3);
  });

  test("writes and reloads verified content-addressed artifacts", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "yukon-research-view-"));
    try {
      const compilation = fixtureCompilation();
      const written = await writeResearchViews(compilation, temporary);
      expect(written).toHaveLength(3);
      const mountedAtoms = await Promise.all(written.map((row) => fs.readFile(path.join(row.payloadPath, "atoms.json"), "utf8")));
      expect(new Set(mountedAtoms).size).toBe(1);
      for (const row of written) {
        const manifest = JSON.parse(await fs.readFile(row.manifestPath, "utf8"));
        expect(manifest.data.renderer.commit).toMatch(/^[0-9a-f]{40}$/u);
        expect(manifest.data.renderer.source_sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(manifest.data.renderer.source_files.map((file) => file.path)).toEqual([
          "src/research-view-cli.js",
          "src/research-view.js",
        ]);
        const mounted = `${await fs.readFile(path.join(row.payloadPath, "atoms.json"), "utf8")}\n${await fs.readFile(path.join(row.payloadPath, "index.md"), "utf8")}`;
        expect(mounted).not.toMatch(/"representation"\s*:/iu);
        expect(mounted).not.toMatch(/(?:^|[^A-Za-z0-9])R[012](?:[^A-Za-z0-9]|$)/u);
      }
      const loaded = await loadCompiledResearchView(written.find((row) => row.representation === "R2").manifestPath);
      expect(loaded.payload.atomSetSha256).toBe(compilation.atomSetSha256);
      expect(loaded.manifest.data.tokens.index).toBeGreaterThan(0);
      const buildPath = path.resolve(import.meta.dir, "../../eval/adapters/harbor/build.py");
      const resolverCheck = [
        "import importlib.util,json,sys",
        "from pathlib import Path",
        "spec=importlib.util.spec_from_file_location('dungeness_build',sys.argv[1])",
        "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)",
        "root=Path(sys.argv[2]);manifest=Path(sys.argv[3]);record=json.loads(manifest.read_text())",
        "ref=f\"research-view:{record['namespace']}/{record['id']}\"",
        "resolved=module.resolve_content_record(ref,record_type='research-view',root=root)",
        "assert (resolved['payload_path']/'index.md').is_file()",
        "print(resolved['payload']['sha256'])",
      ].join(";");
      const resolvedHash = execFileSync("python3", ["-c", resolverCheck, buildPath, temporary, written[0].manifestPath], { encoding: "utf8" }).trim();
      expect(resolvedHash).toBe(written[0].payloadSha256);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

describe("calibration and Dungeness adapters", () => {
  test("compiles the sealed 54-event ECDSA cohort inside both budgets", async () => {
    const cohort = await loadDatedEcdsaCalibrationCohort({ expectedCount: 54 });
    const compilation = compileResearchViews({
      events: cohort.events,
      sourceSets: cohort.sourceSets,
      target: cohort.target,
      cutoff: cohort.cutoff,
      cutoffSealSha256: cohort.cutoffSealSha256,
    });
    expect(cohort.selection.excludedUndated).toBe(895);
    expect(compilation.views.R2.audit.observedTokens.total).toBeLessThanOrEqual(32_000);
    expect(compilation.views.R2.audit.observedTokens.index).toBeLessThanOrEqual(4_000);
  });

  test("binds non-overlapping lineage windows to executable ECDSA verification", async () => {
    const cohort = await loadDatedEcdsaCalibrationCohort({ expectedCount: 54 });
    const selection = JSON.parse(await fs.readFile(path.resolve(
      import.meta.dir,
      "../studies/dungeness-representation-v1/v26-ecdsa-history-selection.json",
    ), "utf8"));
    const first = buildEcdsaVerificationPlan(cohort, selection);
    const second = buildEcdsaVerificationPlan(cohort, selection);
    expect(first.schema).toBe("yukon.ecdsa-verification-plan.v1");
    expect(first.windows).toHaveLength(2);
    expect(first.target.metric_name).toBe("ecdsafail_score");
    expect(first.events).toHaveLength(14);
    expect(first.windows.every((window) => window.headroom_meaningful_gains >= 1)).toBe(true);
    expect(sha256(first)).toBe(sha256(second));
    expect(first.events.at(-1).roles).toContain("reference");
  });

  test("adapts an explicit trusted export and appends it after a sealed history", () => {
    const history = fixtureCompilation().views.R0.payload;
    const exported = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    const adapted = adaptDungenessTrustedExport(exported, {
      sourcePath: "runs/run-4/research-events.json",
      sourceSha256: "d".repeat(64),
    });
    const next = appendDungenessEvents(history, adapted);
    expect(next.views.R0.payload.atomTable).toHaveLength(4);
    expect(next.views.R0.payload.historyCutoff).toBe("2026-08-27T00:03:00.000Z");
    expect(next.views.R1.index.frontier).toHaveLength(1);
  });

  test("preserves recorded interventions from trusted export v2", () => {
    const exported = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    exported.schema = "dungeness.trusted-research-events.v2";
    exported.events[0].interventions = [intervention("historical", "idea:window", "src/d.js::d")];
    const adapted = adaptDungenessTrustedExport(exported, {
      sourcePath: "research-event-exports/history-v2.json",
      sourceSha256: "e".repeat(64),
    });
    expect(adapted.events[0].interventions).toHaveLength(1);
    expect(adapted.events[0].conditions.bundleSize).toBe(1);
    expect(adapted.events[0].interventions[0].ideaIds).toEqual(["idea:window"]);
  });

  test("projects bulky trusted transport fields to content-addressed summaries", () => {
    const exported = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    const adapted = adaptDungenessTrustedExport(exported, {
      sourcePath: "research-event-exports/compact.json",
      sourceSha256: "f".repeat(64),
    });
    const conditions = adapted.events[0].conditions;
    expect(conditions.configuration.payload).toEqual({
      algorithm: "tree-sha256-v1",
      bytes: 3,
      fileCount: 1,
      sha256: exported.events[0].content_sha256,
    });
    expect(conditions.configuration.payload.files).toBeUndefined();
    expect(conditions.seed).toEqual({ sha256: sha256(exported.seed) });
    expect(conditions.environment).toEqual({ sha256: sha256(exported.environment) });
    expect(conditions.harness).toEqual({ sha256: sha256(exported.harness) });
    expect(adapted.events[0].provenance.evidenceSha256).not.toContain(
      exported.events[0].payload.files[0].sha256,
    );
  });

  test("rejects an inconsistent trusted payload manifest before compacting it", () => {
    const exported = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    exported.events[0].payload.bytes += 1;
    expect(() => adaptDungenessTrustedExport(exported, {
      sourcePath: "research-event-exports/bad-payload.json",
      sourceSha256: "f".repeat(64),
    })).toThrow("byte count differs from its manifest");
  });

  test("compiles a first sealed history directly from a trusted export", () => {
    const exported = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    const adapted = adaptDungenessTrustedExport(exported, {
      sourcePath: "research-event-exports/run-4.json",
      sourceSha256: "d".repeat(64),
    });
    const first = compileDungenessEvents(adapted);
    const second = compileDungenessEvents(adapted);
    expect(adapted.checkpoint).toBe("checkpoint-1");
    expect(first.views.R0.payload.historyCutoff).toBe("2026-08-27T00:03:00.000Z");
    expect(first.views.R0.payload.cutoffSealSha256).toBe(second.views.R0.payload.cutoffSealSha256);
    expect(first.views.R0.tree.sha256).toBe(second.views.R0.tree.sha256);
  });

  test("compiles a multi-session campaign and retains zero-event sources", () => {
    const firstExport = trustedDungenessExport("2026-08-27T00:03:00.000Z");
    firstExport.run = { id: "run-1", ref: "run:users/bx/run-1" };
    firstExport.events[0].evaluation_id = "0001";
    firstExport.events[0].execution.evaluation_id = "0001";
    firstExport.selection = ["0001"];
    const zeroExport = trustedDungenessExport("2026-08-27T00:04:00.000Z");
    zeroExport.run = { id: "run-2", ref: "run:users/bx/run-2" };
    zeroExport.events = [];
    zeroExport.selection = [];
    zeroExport.task.metric = { name: TARGET.metricName, direction: "minimize" };
    const adapted = [firstExport, zeroExport].map((exported, index) => adaptDungenessTrustedExport(exported, {
      sourcePath: `research-event-exports/run-${index + 1}.json`,
      sourceSha256: String(index + 1).repeat(64),
    }));
    const first = compileDungenessCampaign(adapted, {
      campaignManifestSha256: "a".repeat(64),
    });
    const second = compileDungenessCampaign(adapted, {
      campaignManifestSha256: "a".repeat(64),
    });
    expect(first.views.R0.payload.atomTable).toHaveLength(1);
    expect(first.views.R0.payload.sourceSets).toHaveLength(2);
    expect(first.views.R0.tree.sha256).toBe(second.views.R0.tree.sha256);
  });

  test("rejects retroactive Dungeness events and metric-contract drift", () => {
    const history = fixtureCompilation().views.R0.payload;
    const exported = trustedDungenessExport("2026-08-26T00:00:00.000Z");
    const adapted = adaptDungenessTrustedExport(exported, {
      sourcePath: "runs/run-4/research-events.json",
      sourceSha256: "d".repeat(64),
    });
    expect(() => appendDungenessEvents(history, adapted)).toThrow("not strictly after");
    expect(() => appendDungenessEvents(history, { ...adapted, target: { ...TARGET, direction: "+" } }))
      .toThrow("metric contract differs");
  });
});
