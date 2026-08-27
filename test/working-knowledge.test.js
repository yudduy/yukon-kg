import { describe, expect, test } from "bun:test";
import { loadIndexedAtlasRelease } from "../src/atlas-local.js";
import {
  ECDSA_LITERATURE_OVERLAY,
  WORKING_KNOWLEDGE_SCHEMA,
  WORKING_KNOWLEDGE_SCHEMA_VERSION,
  buildEcdsaWorkingKnowledgeBrief,
  interventionFamilyFor,
} from "../src/atlas-runtime/working-knowledge.ts";
import { canonicalStringify, sha256 } from "../src/protocol.js";

const loaded = await loadIndexedAtlasRelease("default");

describe("ECDSA working-knowledge compiler", () => {
  const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
  const repeat = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);

  test("compiles a byte-stable presentation-plane brief from the current Atlas snapshot", () => {
    expect(brief.schema).toBe(WORKING_KNOWLEDGE_SCHEMA);
    expect(brief.schemaVersion).toBe(WORKING_KNOWLEDGE_SCHEMA_VERSION);
    expect(brief.compiledFrom.releaseId).toBe(loaded.release.pointer.id);
    expect(brief.compiledFrom.manifestSha256).toBe(loaded.release.pointer.manifestSha256);
    expect(sha256(brief)).toBe(sha256(repeat));
    expect(canonicalStringify(brief)).toBe(canonicalStringify(repeat));
  });

  test("does not promote seed grinding as a supported mechanism", () => {
    expect(interventionFamilyFor("candidate:seed-grinding:7647dab7dc", "search-and-tuning")).toBe("evaluator_hazard");
    expect(brief.supportedMechanisms.some((item) => item.family === "evaluator_hazard")).toBe(false);
    expect(brief.supportedMechanisms.some((item) => item.ideaId.includes("seed-grinding"))).toBe(false);
    const hazard = brief.evaluatorHazards.find((item) => item.hazardId === "hazard:seed-grinding");
    expect(hazard?.count).toBe(brief.corpusAccounting.seedGrindingSubmissions);
    expect(brief.corpusAccounting.seedGrindingSubmissions).toBeGreaterThan(brief.corpusAccounting.focused);
    expect(brief.corpusAccounting.seedGrindingPromoted).toBeGreaterThan(0);
  });

  test("promotes only jointly qualified one-change improvements, ranked by official delta", () => {
    expect(brief.supportedMechanisms.length).toBeGreaterThanOrEqual(5);
    expect(brief.supportedMechanisms.every((item) => item.evidenceLevel === "one_change_ablation")).toBe(true);
    expect(brief.supportedMechanisms.every((item) => item.officialDelta < 0)).toBe(true);
    const deltas = brief.supportedMechanisms.map((item) => item.officialDelta);
    expect(deltas).toEqual([...deltas].sort((left, right) => left - right));
    expect(brief.supportedMechanisms[0]?.ideaId).toBe("candidate:adaptive-phase-correction:a391ebef3b");
    expect(brief.supportedMechanisms[0]?.officialDelta).toBe(-66073800);
    expect(brief.supportedMechanisms.some((item) => item.ideaId === "candidate:quantum-classical-comparator:d9ffd5fcec")).toBe(true);
    expect(brief.supportedMechanisms.some((item) => item.ideaId === "candidate:gidney-s-temporary-and:d783751042")).toBe(true);
    expect(brief.supportedMechanisms.some((item) => (
      item.toffoliDelta !== null && item.toffoliDelta > 0 && item.officialDelta < 0
    ))).toBe(true);
  });

  test("keeps historical Karatsuba and ping-pong observations out of causal mechanisms", () => {
    expect(brief.supportedMechanisms.some((item) => item.ideaId.includes("karatsuba"))).toBe(false);
    expect(brief.unverifiedObservations.some((item) => item.ideaId.includes("karatsuba") || item.title.toLowerCase().includes("karatsuba"))).toBe(true);
    expect(brief.nextDiscriminators.some((item) => item.status === "historical_only")).toBe(true);
    expect(brief.nextDiscriminators.some((item) => item.status === "proposed_unverified" && item.discriminatorId === "disc:barrett-vs-solinas")).toBe(true);
  });

  test("does not turn zero promotions into negative knowledge", () => {
    const fermat = brief.coverageSignals.find((item) => item.ideaId.includes("fermat-inversion"));
    expect(fermat?.promoted).toBe(0);
    expect(fermat?.status).toBe("archive_observation_only");
    expect(brief.negativeKnowledge.some((item) => item.ideaId.includes("fermat-inversion"))).toBe(false);
    expect(brief.negativeKnowledge.every((item) => item.evidenceLevel === "one_change_ablation" && item.officialDelta >= 0)).toBe(true);
  });

  test("emits no-qualifying-receipt only from scoped matcher evidence", () => {
    const discriminatorId = "disc:barrett-vs-solinas";
    const scoped = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails, {
      discriminatorCoverage: new Map([[
        discriminatorId,
        {
          discriminatorId,
          matcherId: "matcher:barrett",
          matcherVersion: "1",
          evaluatorSha256: "a".repeat(64),
          qualifyingReceiptCount: 0,
          sourceRefs: ["ledger:campaign-001"],
        },
      ]]),
    });
    const barrett = scoped.nextDiscriminators.find((item) => item.discriminatorId === discriminatorId);
    expect(barrett?.status).toBe("no_qualifying_receipt");
    expect(barrett?.verification).toEqual({
      method: "evidence_ledger_matcher",
      releaseId: loaded.release.pointer.id,
      matcherId: "matcher:barrett",
      matcherVersion: "1",
      evaluatorSha256: "a".repeat(64),
      qualifyingReceiptCount: 0,
    });
  });

  test("separates literature overlay predicates from Atlas measurements", () => {
    expect(brief.literatureOverlay).toEqual([...ECDSA_LITERATURE_OVERLAY]);
    expect(brief.literatureOverlay.every((claim) => claim.predicate === "source_reported")).toBe(true);
    expect(brief.literatureOverlay.some((claim) => claim.applicability === "published-pareto")).toBe(true);
    expect(brief.literatureOverlay.some((claim) => claim.claimId === "lit:knowledge-presentation-not-strategy")).toBe(true);
    expect(brief.caveats.some((caveat) => /different contract/i.test(caveat))).toBe(true);
    expect(brief.boundAndGap.some((bound) => bound.constraintId === "constraint:ecdsa:qubit-count" && bound.limitKind === "pinned_floor" && bound.limitValue === 512)).toBe(true);
    expect(brief.currentFrontier[0]?.score).toBe(1182644586);
  });

  test("every Atlas-derived number unfolds to at least one source ref", () => {
    const rows = [
      ...brief.currentFrontier,
      ...brief.supportedMechanisms,
      ...brief.unverifiedObservations,
      ...brief.liveAlternatives,
      ...brief.coverageSignals,
      ...brief.negativeKnowledge,
      ...brief.evaluatorHazards,
      ...brief.nextDiscriminators,
    ];
    expect(rows.every((row) => row.sourceRefs.length > 0)).toBe(true);
    expect(brief.boundAndGap.every((bound) => bound.constraintId.startsWith("constraint:"))).toBe(true);
  });
});
