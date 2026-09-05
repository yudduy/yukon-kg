import { describe, expect, test } from "bun:test";
import {
  analyzeAtlasAccessProbe,
  executeAtlasAccessSession,
  parseAccessResponse,
} from "../src/atlas-access-probe.js";

const candidate = {
  id: "case-1",
  query: "Use the recorded optimization.",
  gold: {
    classification: "prior_attempt",
    decision: "reject_duplicate",
    ideaIds: ["idea:x"],
    acceptableMatches: [{
      submissionId: "submission-1",
      changeId: "change-1",
      status: "promoted",
      outcome: "artifact_and_measurement",
      sourceRefs: ["submission:submission-1"],
    }],
  },
};

const response = {
  classification: "prior_attempt",
  decision: "reject_duplicate",
  ideaIds: ["idea:x"],
  matches: candidate.gold.acceptableMatches,
  caveats: [],
};

describe("Atlas access probe", () => {
  test("parses a fenced exact response", () => {
    expect(parseAccessResponse(`\`\`\`json\n${JSON.stringify(response)}\n\`\`\``)).toEqual(response);
  });

  test("runs a function-tool turn and scores the grounded final answer", async () => {
    const completions = [
      {
        id: "tool-turn",
        model: "test/model",
        message: {
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "atlas_query", arguments: '{"operation":"search","argument":"optimization"}' } }],
        },
        usage: { cost: 0.01 },
      },
      {
        id: "final-turn",
        model: "test/model",
        message: { content: JSON.stringify(response) },
        usage: { cost: 0.02 },
      },
    ];
    const corpus = {
      records: [{ id: "attempt", kind: "flat_attempt", label: "optimization", searchText: "optimization", body: response.matches[0] }],
      searchRecordIds: ["attempt"],
      pages: {},
    };
    const evidenceIndex = {
      ideaIds: new Set(["idea:x"]),
      matchByKey: new Map([["submission-1\0change-1", { ...response.matches[0], ideaIds: ["idea:x"] }]]),
    };
    const result = await executeAtlasAccessSession({
      candidate,
      corpus,
      evidenceIndex,
      model: "test/model",
      complete: async () => completions.shift(),
    });
    expect(result.audit.commandCount).toBe(1);
    expect(result.audit.valid).toBe(true);
    expect(result.score.pass).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.03);
  });

  test("applies the frozen pilot gates per model", () => {
    const models = ["m1", "m2"];
    const rows = [];
    for (const model of models) {
      for (let index = 0; index < 6; index += 1) {
        for (const arm of ["raw", "flat", "flat_plus_brief", "pointer"]) {
          const pass = arm !== "raw" || index >= 2;
          rows.push({
            model,
            caseId: `c${index}`,
            arm,
            score: { pass, fabricated: false },
            audit: { commandCount: 1, returnedBytes: 100 },
            costUsd: 0.01,
          });
        }
      }
    }
    const analysis = analyzeAtlasAccessProbe(rows, { models, caseCount: 6 });
    expect(analysis.comparisons["m1:flat_vs_raw"]).toEqual({ cases: 6, wins: 2, losses: 0, ties: 4, netWins: 2 });
    expect(analysis.gates).toEqual({
      pointerSensitive: true,
      coreDistinguishing: true,
      flatMechanism: true,
      zeroFabrication: true,
      proceed: true,
    });
  });
});

