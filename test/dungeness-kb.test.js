import { describe, expect, test } from "bun:test";
import { loadIndexedAtlasRelease } from "../src/atlas-local.js";
import {
  buildEcdsaWorkingKnowledgeBrief,
  ideasFromRelease,
} from "../src/atlas-runtime/index.ts";
import {
  ARMS,
  CONTEXT_BYTE_LIMIT,
  PILOT_CASES,
  analyzeReachability,
  buildKnowledgeEvidenceIndex,
  compileKnowledgeVariants,
  deterministicShuffle,
  parseModelAnswer,
  scoreAnswer,
  scoreKnowledgeAnswer,
  scorePilot,
} from "../src/dungeness-kb-protocol.js";

const loaded = await loadIndexedAtlasRelease("default");
const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
const variants = compileKnowledgeVariants(
  brief,
  ideasFromRelease(loaded.release),
  loaded.release.submissions.submissions,
);
const evidenceIndex = buildKnowledgeEvidenceIndex(brief);

describe("dungeness knowledge variants", () => {
  test("compile five equal-budget arms without doNow", () => {
    expect(Object.keys(variants).sort()).toEqual([...ARMS].sort());
    for (const arm of ARMS) {
      expect(variants[arm].bytes).toBeLessThanOrEqual(CONTEXT_BYTE_LIMIT);
      expect(variants[arm].text).not.toContain('"doNow"');
      expect(variants[arm].sha256).toHaveLength(64);
      expect(() => JSON.parse(variants[arm].text)).not.toThrow();
    }
  });

  test("state_brief carries scores, hazards, and open cuts", () => {
    const text = variants.state_brief.text;
    expect(text).toContain("Adaptive phase correction");
    expect(text).toContain("1182644586");
    expect(text).toContain("512");
    expect(text).toContain("Barrett");
    expect(text).toContain("Nonce / seed grinding");
    expect(text).toContain("proposed_unverified");
    expect(text).toContain("archive_observation_only");
    expect(text).not.toContain("What isolated move is worth trying next");
  });

  test("winner_only ranks nonce grinding first", () => {
    const payload = JSON.parse(variants.winner_only.text);
    expect(payload.ideas[0].name).toMatch(/nonce|seed/i);
    expect(payload.ideas[0].promoted).toBeGreaterThan(100);
  });

  test("state_brief is reachable for every frozen case", () => {
    const rows = analyzeReachability(variants);
    expect(rows.every((row) => row.perArm.state_brief)).toBe(true);
    expect(rows.filter((row) => row.claimed.includes("state_brief") && !row.ok)).toEqual([]);
  });
});

describe("dungeness knowledge scoring", () => {
  test("accepts exact answers and every allowed representation proposal", () => {
    const next = PILOT_CASES.find((item) => item.id === "representation-proposal");
    const largest = PILOT_CASES.find((item) => item.id === "largest-isolated-effect");
    expect(scoreAnswer("Barrett", next)).toBe(true);
    expect(scoreAnswer("disc:half-gcd", next)).toBe(true);
    expect(scoreAnswer("Adaptive phase correction", largest)).toBe(true);
    expect(scoreAnswer("Nonce grinding", largest)).toBe(false);
    expect(scoreAnswer("", largest)).toBe(false);
  });

  test("requires a real directly supporting source reference", () => {
    const seedGrinding = PILOT_CASES.find((item) => item.id === "seed-grinding-mechanism");
    const valid = parseModelAnswer(JSON.stringify({
      answer: "no",
      rationale: "It is an evaluator hazard, not an admitted mechanism.",
      sourceRefs: ["hazard:seed-grinding"],
    }));
    expect(scoreKnowledgeAnswer(valid, seedGrinding, evidenceIndex)).toMatchObject({
      pass: true,
      decisionCorrect: true,
      citationCorrect: true,
      fabricated: false,
    });

    const fabricated = parseModelAnswer(JSON.stringify({
      answer: "no",
      rationale: "Invented citation.",
      sourceRefs: ["hazard:not-real"],
    }));
    expect(scoreKnowledgeAnswer(fabricated, seedGrinding, evidenceIndex)).toMatchObject({
      pass: false,
      fabricated: true,
    });

    const indirect = parseModelAnswer(JSON.stringify({
      answer: "no",
      rationale: "A neighboring idea does not prove the hazard.",
      sourceRefs: ["idea:candidate:seed-grinding:7647dab7dc"],
    }));
    expect(scoreKnowledgeAnswer(indirect, seedGrinding, evidenceIndex)).toMatchObject({
      pass: false,
      citationCorrect: false,
    });
  });

  test("rejects malformed, empty, oversized, and duplicate-citation responses", () => {
    expect(parseModelAnswer("not json").valid).toBe(false);
    expect(parseModelAnswer('{"answer":"","rationale":"","sourceRefs":["x"]}').valid).toBe(false);
    expect(parseModelAnswer('{"answer":"no","rationale":"","sourceRefs":["x","x"]}').valid).toBe(false);
    expect(parseModelAnswer(JSON.stringify({
      answer: "no",
      rationale: "x".repeat(3000),
      sourceRefs: ["hazard:seed-grinding"],
    })).valid).toBe(false);
  });

  test("randomizes cells deterministically from the run seed", () => {
    const cells = PILOT_CASES.flatMap((userCase) => ARMS.map((arm) => ({ caseId: userCase.id, arm })));
    expect(deterministicShuffle(cells, "run-a")).toEqual(deterministicShuffle(cells, "run-a"));
    expect(deterministicShuffle(cells, "run-a")).not.toEqual(deterministicShuffle(cells, "run-b"));
  });

  test("adoption requires state_brief to beat winner_only on the gate", () => {
    const results = PILOT_CASES.flatMap((userCase) => ARMS.map((arm) => ({
      caseId: userCase.id,
      arm,
      pass: arm === "state_brief",
    })));
    const report = scorePilot(results);
    expect(report.adopted).toBe("state_brief");
    expect(report.totals.state_brief.passed).toBe(8);
    expect(report.totals.winner_only.passed).toBe(0);
    expect(report.missed).toEqual([]);
  });

  test("records missed cases without claiming the winner_only gate failed", () => {
    const results = PILOT_CASES.flatMap((userCase) => ARMS.map((arm) => ({
      caseId: userCase.id,
      arm,
      pass: arm === "state_brief" && userCase.id !== "representation-proposal",
    })));
    const report = scorePilot(results);
    expect(report.adopted).toBeNull();
    expect(report.missed).toEqual(["representation-proposal"]);
    expect(report.gate.every((item) => item.state_brief && !item.winner_only)).toBe(true);
    expect(report.reason).toContain("representation-proposal");
  });
});
