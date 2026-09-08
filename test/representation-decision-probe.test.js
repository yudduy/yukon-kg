import { describe, expect, test } from "bun:test";
import {
  CORE_ARMS,
  POSITIVE_CONTROL_ARM,
  analyzeProbeResults,
  buildDecisionProbeCases,
  buildProbeMessages,
  createDecisionProbeCase,
  parseProbeResponse,
  scoreProbeResponse,
} from "../src/representation-decision-probe.js";
import { canonicalStringify, sha256 } from "../src/research-view.js";

describe("representation decision probe", () => {
  test("crosses the three factors deterministically with equal core evidence", () => {
    const first = buildDecisionProbeCases({ seed: "fixture", variants: 1 });
    const second = buildDecisionProbeCases({ seed: "fixture", variants: 1 });
    expect(canonicalStringify(first)).toBe(canonicalStringify(second));
    expect(first).toHaveLength(8);
    expect(new Set(first.map((probeCase) => probeCase.caseId)).size).toBe(8);
    expect(first.filter((probeCase) => probeCase.oracle.decisionClass === "chronology")).toHaveLength(3);
    expect(first.filter((probeCase) => probeCase.oracle.decisionClass === "frontier")).toHaveLength(3);
    expect(first.filter((probeCase) => probeCase.oracle.decisionClass === "comparison")).toHaveLength(2);

    for (const probeCase of first) {
      const common = CORE_ARMS.map((arm) => {
        const { index: _index, packet_id: _packetId, ...rest } = probeCase.packets[arm];
        return canonicalStringify(rest);
      });
      expect(new Set(common).size).toBe(1);
      expect(sha256(JSON.parse(common[0]).atoms)).toBe(probeCase.atomsSha256);
      expect(new Set(Object.values(probeCase.indexHashes)).size).toBe(3);
      for (const arm of [...CORE_ARMS, POSITIVE_CONTROL_ARM]) {
        expect(canonicalStringify(probeCase.packets[arm])).not.toMatch(/(?:^|[^A-Za-z0-9])R[012](?:[^A-Za-z0-9]|$)|representation|treatment/i);
        expect(buildProbeMessages(probeCase.packets[arm])).toHaveLength(2);
      }
    }
  });

  test("creates exactly one useful comparison only when that factor is present", () => {
    const comparison = createDecisionProbeCase("fixture", {
      selectionLoad: true,
      comparisonOpportunity: true,
      comparisonActionable: true,
    });
    expect(comparison.diagnostics.r2OneConditionDifferentCount).toBe(1);
    expect(comparison.diagnostics.r2MixedOutcomeCount).toBe(1);
    expect(comparison.oracle.decisionClass).toBe("comparison");

    const unactionable = createDecisionProbeCase("fixture", {
      selectionLoad: true,
      comparisonOpportunity: true,
      comparisonActionable: false,
    });
    expect(unactionable.oracle.decisionClass).toBe("frontier");
    const absent = createDecisionProbeCase("fixture", {
      selectionLoad: false,
      comparisonOpportunity: false,
      comparisonActionable: true,
    });
    expect(absent.diagnostics.r2OneConditionDifferentCount).toBe(0);
    expect(absent.diagnostics.r2MixedOutcomeCount).toBe(0);
    expect(absent.oracle.decisionClass).toBe("chronology");
  });

  test("parses a final JSON object from reasoning and scores exact grounding", () => {
    const probeCase = createDecisionProbeCase("fixture", {
      selectionLoad: true,
      comparisonOpportunity: true,
      comparisonActionable: true,
    });
    const response = JSON.stringify({
      action_id: probeCase.oracle.actionId,
      evidence_event_ids: probeCase.oracle.evidenceEventIds,
    });
    expect(parseProbeResponse(`analysis first\n${response}`).valid).toBe(true);
    const score = scoreProbeResponse(probeCase, "R2", response);
    expect(score.correct).toBe(true);
    expect(score.groundedCorrect).toBe(true);
    expect(scoreProbeResponse(probeCase, "R2", "not json").valid).toBe(false);
  });

  test("detects a selective, positive-control-sensitive mechanism pattern", () => {
    const cases = buildDecisionProbeCases({ seed: "analysis", variants: 1 });
    const rows = [];
    for (const model of ["model-a", "model-b"]) {
      for (const probeCase of cases) {
        for (const arm of [...CORE_ARMS, POSITIVE_CONTROL_ARM]) {
          const correct = arm === POSITIVE_CONTROL_ARM
            || (probeCase.oracle.decisionClass === "chronology" && arm === "R0")
            || (probeCase.oracle.decisionClass === "frontier" && ["R1", "R2"].includes(arm))
            || (probeCase.oracle.decisionClass === "comparison" && arm === "R2");
          rows.push({
            model,
            caseId: probeCase.caseId,
            arm,
            oracleDecisionClass: probeCase.oracle.decisionClass,
            score: { valid: true, correct, groundedCorrect: correct },
            usage: { prompt_tokens: 100, completion_tokens: 20 },
            costUsd: 0.001,
          });
        }
      }
    }
    const analysis = analyzeProbeResults(rows);
    expect(analysis.gates.positiveControlPassed).toBe(true);
    expect(analysis.gates.r1MechanismPassed).toBe(true);
    expect(analysis.gates.r2MechanismPassed).toBe(true);
    expect(analysis.gates.classificationMechanismPassed).toBe(true);
  });
});
