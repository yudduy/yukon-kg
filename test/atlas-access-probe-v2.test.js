import { describe, expect, test } from "bun:test";
import {
  buildAccessMessagesV2,
  executeAtlasAccessSessionV2,
} from "../src/atlas-access-probe-v2.js";

const candidate = {
  id: "case-v2",
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

describe("Atlas access probe v2", () => {
  test("makes every scored enum and field spelling explicit", () => {
    const messages = buildAccessMessagesV2(candidate);
    expect(messages[1].content).toContain('"classification":"prior_attempt"');
    expect(messages[1].content).toContain('"decision":"reject_duplicate"');
    expect(messages[1].content).toContain('"sourceRefs"');
    expect(messages[1].content).toContain("return exactly one best grounded match");
  });

  test("scores the original gold contract after adding the prompt repair", async () => {
    const finalResponse = {
      classification: "prior_attempt",
      decision: "reject_duplicate",
      ideaIds: ["idea:x"],
      matches: candidate.gold.acceptableMatches,
      caveats: [],
    };
    const corpus = {
      records: [{
        id: "attempt",
        kind: "flat_attempt",
        label: "optimization",
        searchText: "optimization",
        body: candidate.gold.acceptableMatches[0],
      }],
      searchRecordIds: ["attempt"],
      pages: {},
    };
    const evidenceIndex = {
      ideaIds: new Set(["idea:x"]),
      matchByKey: new Map([["submission-1\0change-1", {
        ...candidate.gold.acceptableMatches[0],
        ideaIds: ["idea:x"],
      }]]),
    };
    const completions = [
      {
        id: "tool-turn",
        model: "test/model",
        message: {
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "atlas_query", arguments: '{"operation":"search","argument":"optimization"}' },
          }],
        },
        usage: { cost: 0 },
      },
      {
        id: "final-turn",
        model: "test/model",
        message: { content: JSON.stringify(finalResponse) },
        usage: { cost: 0 },
      },
    ];
    const result = await executeAtlasAccessSessionV2({
      candidate,
      corpus,
      evidenceIndex,
      model: "test/model",
      complete: async () => completions.shift(),
    });
    expect(result.score.pass).toBe(true);
    expect(result.audit.valid).toBe(true);
  });
});
