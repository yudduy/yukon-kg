import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ATLAS_DUPLICATE_MODELS,
  ATLAS_DUPLICATE_PROTOCOL_VERSION,
  CONDITIONS,
  PINNED_MANIFEST_SHA256,
  PINNED_RELEASE_ID,
  QUERY_BYTE_LIMIT,
  QUERY_CALL_LIMIT,
  REPEAT_COUNT,
  analyzeConfirmatoryResults,
  assessPilotResults,
  buildAttemptFacts,
  buildEvidenceIndex,
  exactMcNemar,
  materializeConditionCorpora,
  scoreCaseResponse,
  validateCaseFixture,
} from "../src/atlas-duplicate-protocol.js";
import {
  auditSessionEvents,
  loadPinnedAtlas,
  preflight,
  report,
  runConfirmatory,
  runPilot,
} from "../src/atlas-duplicate-mve.js";
import { executeQuery, queryCorpus } from "../src/atlas-query.js";
import { canonicalStringify, sha256 } from "../src/protocol.js";

let temporaryDirectory;

beforeAll(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-duplicate-test-"));
});

afterAll(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}, 30_000);

function gold(classification = "no_prior_attempt", index = 0) {
  const positive = classification === "prior_attempt";
  return {
    classification,
    decision: positive ? "reject_duplicate" : "investigate_novel",
    ideaIds: [`idea-${index}`],
    acceptableMatches: positive ? [{
      changeId: `change-${index}`,
      submissionId: `submission-${index}`,
      status: "promoted",
      outcome: `outcome-${index}`,
      sourceRefs: [`change:submission-${index}:change-${index}`, `submission:submission-${index}`],
    }] : [],
  };
}

function testReceipt(index, neighbor = 0) {
  const suffix = `${index}-neighbor-${neighbor}`;
  return {
    changeId: `change-${suffix}`,
    submissionId: `submission-${suffix}`,
    status: "rejected",
    outcome: `outcome-${suffix}`,
    sourceRefs: [`change:submission-${suffix}:change-${suffix}`, `submission:submission-${suffix}`],
  };
}

function experimentCase(index, classification, pilot = false) {
  const decision = gold(classification, index);
  const retrieval = {
    searchProbes: [`natural search probe ${index}`],
    negativeNeighbors: classification === "prior_attempt" ? [] : [testReceipt(index, 0), testReceipt(index, 1)],
  };
  const decisionSha256 = sha256({ gold: decision, negativeNeighbors: retrieval.negativeNeighbors });
  return {
    id: `${pilot ? "pilot" : "case"}-${index}`,
    query: `Change the arithmetic implementation in case ${index}.`,
    directionBlockId: `${pilot ? "pilot-direction" : "direction"}-${index}`,
    strata: {
      lexicalOverlap: index % 4 === 0 ? "low" : "ordinary",
      witnessRole: !pilot && index < 6 ? "nonrepresentative" : classification === "prior_attempt" ? "representative" : "none",
      evidenceScope: classification === "prior_attempt" ? index % 2 === 0 ? "focused" : "bundled" : "none",
    },
    gold: decision,
    retrieval,
    reviews: [
      { reviewerId: "reviewer-a", decisionSha256, rationale: "Matched against the sealed source." },
      { reviewerId: "reviewer-b", decisionSha256, rationale: "Independently matched against the sealed source." },
    ],
  };
}

function caseFixture() {
  const fixture = {
    schema: "yukon.atlas-duplicate-cases",
    schemaVersion: 2,
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    release: { id: PINNED_RELEASE_ID, manifestSha256: PINNED_MANIFEST_SHA256 },
    frozenAt: "2026-08-24T12:00:00.000Z",
    pilot: Array.from({ length: 6 }, (_, index) => experimentCase(index, index < 4 ? "prior_attempt" : "no_prior_attempt", true)),
    confirmatory: Array.from({ length: 24 }, (_, index) => experimentCase(index, index < 18 ? "prior_attempt" : "no_prior_attempt")),
  };
  return { ...fixture, fixtureSha256: sha256(fixture) };
}

function rehashFixture(fixture) {
  const { fixtureSha256: _ignored, ...frozen } = fixture;
  fixture.fixtureSha256 = sha256(frozen);
  return fixture;
}

function fixtureEvidenceIndex(fixture) {
  const cases = [...fixture.pilot, ...fixture.confirmatory];
  const matchByKey = new Map();
  for (const candidate of cases) {
    for (const match of [...candidate.gold.acceptableMatches, ...candidate.retrieval.negativeNeighbors]) {
      matchByKey.set(`${match.submissionId}\0${match.changeId}`, {
        ...match,
        ideaIds: candidate.gold.ideaIds,
        sourceRefs: [...match.sourceRefs],
      });
    }
  }
  return {
    ideaIds: new Set(cases.flatMap((candidate) => candidate.gold.ideaIds)),
    matchByKey,
    sourceRefs: new Set(cases.flatMap((candidate) => (
      [...candidate.gold.acceptableMatches, ...candidate.retrieval.negativeNeighbors].flatMap((match) => match.sourceRefs)
    ))),
  };
}

function conditionResults(cases, passCounts) {
  const results = new Map();
  const countFor = (model, condition) => {
    const scoped = passCounts[model] ?? passCounts;
    return scoped[condition] ?? (condition === "flat_plus_brief" ? scoped.brief : undefined) ?? 0;
  };
  for (const model of ATLAS_DUPLICATE_MODELS) {
    for (const condition of CONDITIONS) {
      const count = countFor(model, condition);
      cases.forEach((candidate, index) => {
        for (let repeat = 1; repeat <= REPEAT_COUNT; repeat += 1) {
          results.set(`${candidate.id}:${condition}:${model}:r${repeat}`, {
            score: { pass: index < count, fabricated: false, negativeFalsePositive: false },
          });
        }
      });
    }
  }
  return results;
}

function commandEvents(command = "/bin/zsh -lc './atlas-query search \"ladder\"'") {
  return [
    { type: "item.started", item: { id: "item-1", type: "command_execution", command, status: "in_progress" } },
    { type: "item.completed", item: { id: "item-1", type: "command_execution", command, status: "completed", exit_code: 0 } },
    { type: "item.completed", item: { id: "item-2", type: "agent_message", text: "{}" } },
  ];
}

describe("frozen case protocol", () => {
  test("accepts exactly six pilot and 24 independently reviewed confirmatory cases", () => {
    const validated = validateCaseFixture(caseFixture());
    expect(validated.pilot).toHaveLength(6);
    expect(validated.pilot.filter((candidate) => candidate.gold.classification === "prior_attempt")).toHaveLength(4);
    expect(validated.pilot.filter((candidate) => candidate.gold.classification === "no_prior_attempt")).toHaveLength(2);
    expect(validated.confirmatory.filter((candidate) => candidate.gold.classification === "prior_attempt")).toHaveLength(18);
    expect(validated.confirmatory.filter((candidate) => candidate.gold.classification === "no_prior_attempt")).toHaveLength(6);
  });

  test("rejects reviewer reuse, disagreement, and a changed frozen payload", () => {
    const reused = caseFixture();
    reused.pilot[0].reviews[1].reviewerId = reused.pilot[0].reviews[0].reviewerId;
    rehashFixture(reused);
    expect(() => validateCaseFixture(reused)).toThrow();

    const disagreement = caseFixture();
    disagreement.confirmatory[0].reviews[1].decisionSha256 = "0".repeat(64);
    rehashFixture(disagreement);
    expect(() => validateCaseFixture(disagreement)).toThrow("reviewer decisions do not match");

    const changed = caseFixture();
    changed.confirmatory[0].query = "Changed after review.";
    expect(() => validateCaseFixture(changed)).toThrow("frozen hash differs");

    const unbalancedPilot = caseFixture();
    unbalancedPilot.pilot[0].gold = {
      ...unbalancedPilot.pilot[0].gold,
      classification: "no_prior_attempt",
      decision: "investigate_novel",
      acceptableMatches: [],
    };
    unbalancedPilot.pilot[0].retrieval.negativeNeighbors = [testReceipt(100, 0), testReceipt(100, 1)];
    const pilotDecisionSha256 = sha256({
      gold: unbalancedPilot.pilot[0].gold,
      negativeNeighbors: unbalancedPilot.pilot[0].retrieval.negativeNeighbors,
    });
    for (const review of unbalancedPilot.pilot[0].reviews) review.decisionSha256 = pilotDecisionSha256;
    rehashFixture(unbalancedPilot);
    expect(() => validateCaseFixture(unbalancedPilot)).toThrow("pilot cases must contain 4 positive and 2 negative cases");
  });

  test("requires gold receipts to contain their full linked source-reference set", () => {
    const fixture = caseFixture();
    const evidenceIndex = fixtureEvidenceIndex(fixture);
    const candidate = fixture.pilot[0];
    candidate.gold.acceptableMatches[0].sourceRefs.pop();
    const decisionSha256 = sha256({ gold: candidate.gold, negativeNeighbors: candidate.retrieval.negativeNeighbors });
    for (const review of candidate.reviews) review.decisionSha256 = decisionSha256;
    rehashFixture(fixture);
    expect(() => validateCaseFixture(fixture, evidenceIndex)).toThrow("full linked source-reference set");
  });

  test("keeps change-level Idea membership narrower than submission routes", () => {
    const submission = {
      id: "submission-one",
      classification: "artifact",
      status: "rejected",
      detailShard: "submission-details/one.json",
      changes: [{ id: "change-one" }],
    };
    const release = {
      submissions: { submissions: [submission] },
      decomposition: { ideas: [{ ideaId: "idea-witness" }, { ideaId: "idea-route-only" }] },
      submissionRouteById: new Map([[submission.id, {
        submissionId: submission.id,
        ideaIds: ["idea-witness", "idea-route-only"],
      }]]),
      mutationWitnessById: new Map([["change-one", {
        witnessId: "change-one",
        ideaIds: ["idea-witness"],
        mappingIdeaId: "idea-witness",
      }]]),
    };
    const indexed = buildEvidenceIndex(release);
    expect(indexed.matchByKey.get("submission-one\0change-one").ideaIds).toEqual(["idea-witness"]);
  });
});

describe("sealed query wrapper", () => {
  const corpus = {
    records: [
      { id: "one", kind: "attempt", label: "Carry ladder", searchText: "nearby carry optimization", body: { value: 1 } },
      { id: "two", kind: "attempt", label: "Window table", searchText: "precompute points", body: { value: 2 } },
    ],
    pages: { next: { items: [1, 2], page: { nextCursor: null } } },
  };

  test("offers the same deterministic search, read, and page operations", () => {
    expect(queryCorpus(corpus, "search", "carry").results.map((result) => result.id)).toEqual(["one"]);
    expect(queryCorpus(corpus, "read", "two").body).toEqual({ value: 2 });
    expect(queryCorpus(corpus, "page", "next").page.items).toEqual([1, 2]);
  });

  test("breaks equal search scores by record ID, not treatment record kind", () => {
    const tied = {
      records: [
        { id: "z-raw", kind: "raw_change", label: "carry", searchText: "carry", body: {} },
        { id: "a-brief", kind: "direction_brief", label: "carry", searchText: "carry", body: {} },
        { id: "m-flat", kind: "flat_attempt", label: "carry", searchText: "carry", body: {} },
      ],
      pages: {},
    };
    expect(queryCorpus(tied, "search", "carry").results.map((result) => result.id)).toEqual([
      "a-brief",
      "m-flat",
      "z-raw",
    ]);
  });

  test("uses one tokenized BM25 ranking and returns at most eight stable references", () => {
    const ranked = {
      records: [
        { id: "focused", kind: "flat_attempt", label: "modular shift", searchText: "direct shifted arithmetic", body: {} },
        { id: "verbose", kind: "raw_change", label: "modular shift", searchText: `${"unrelated ".repeat(80)}direct shifted arithmetic`, body: {} },
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `tail-${String(index).padStart(2, "0")}`,
          kind: "raw_change",
          label: "shift",
          searchText: "generic arithmetic",
          body: {},
        })),
      ],
      pages: {},
    };
    const first = queryCorpus(ranked, "search", "direct-shifted arithmetic");
    const second = queryCorpus(ranked, "search", "direct-shifted arithmetic");
    expect(first).toEqual(second);
    expect(first.results[0].id).toBe("focused");
    expect(first.results).toHaveLength(8);
  });

  test("serializes concurrent accounting and never returns over the byte budget", async () => {
    const corpusPath = path.join(temporaryDirectory, "corpus.json");
    const statePath = path.join(temporaryDirectory, "state.json");
    await fs.writeFile(corpusPath, JSON.stringify(corpus));
    const outputs = await Promise.all(Array.from({ length: QUERY_CALL_LIMIT + 2 }, () => executeQuery({
      corpusPath,
      statePath,
      operation: "search",
      argument: "carry",
    })));
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    expect(state.calls).toBe(QUERY_CALL_LIMIT + 2);
    expect(state.history).toHaveLength(QUERY_CALL_LIMIT + 2);
    expect(state.returnedBytes).toBeLessThanOrEqual(QUERY_BYTE_LIMIT);
    expect(outputs.reduce((total, output) => total + output.bytes, 0)).toBe(state.returnedBytes);
  });
});

describe("strict session audit and deterministic scoring", () => {
  test("admits only the three query command forms with exact state accounting", () => {
    const result = {
      events: commandEvents(),
      process: { exitCode: 0, timedOut: false },
      usage: { output_tokens: 50 },
    };
    const state = {
      calls: 1,
      returnedBytes: 100,
      history: [{ call: 1, operation: "search", argument: "ladder", returnedBytes: 100 }],
    };
    expect(auditSessionEvents(result, state)).toMatchObject({ valid: true, commandCount: 1, returnedBytes: 100 });
    expect(auditSessionEvents({ ...result, events: commandEvents("/bin/zsh -lc 'cat corpus.json'") }, state).valid).toBe(false);
    expect(auditSessionEvents(result, { ...state, calls: 2 }).valid).toBe(false);
    expect(auditSessionEvents({ ...result, usage: null }, state).valid).toBe(false);
    expect(auditSessionEvents({ ...result, lastMessage: "{}", usage: { output_tokens: 1_200, reasoning_output_tokens: 300 } }, state)).toMatchObject({
      valid: true,
      responseBytes: 2,
    });
    expect(auditSessionEvents({ ...result, lastMessage: "x".repeat(6_145), usage: { output_tokens: 1_301, reasoning_output_tokens: 300 } }, state).valid).toBe(false);
  });

  test("counts references surfaced by a paginated search page as discovered", () => {
    const command = "/bin/zsh -lc './atlas-query page \"search:cursor\"'";
    const events = commandEvents(command);
    events[1].item.aggregated_output = JSON.stringify({
      operation: "page",
      cursor: "search:cursor",
      page: {
        kind: "search_results",
        items: [{ id: "attempt:submission:change:idea", label: "Attempt" }],
        nextCursor: null,
      },
    });
    const audit = auditSessionEvents({
      events,
      process: { exitCode: 0, timedOut: false },
      usage: { output_tokens: 10 },
      lastMessage: "{}",
    }, {
      calls: 1,
      returnedBytes: 100,
      history: [{ call: 1, operation: "page", argument: "search:cursor", returnedBytes: 100 }],
    });
    expect(audit).toMatchObject({
      valid: true,
      retrieval: {
        searchResultIds: ["attempt:submission:change:idea"],
        pagedCursors: ["search:cursor"],
      },
    });
  });

  test("accepts subsets of a chosen receipt's citations and gold Idea placements", () => {
    const candidate = experimentCase(3, "prior_attempt");
    candidate.gold.ideaIds.push("idea-alternate");
    const match = candidate.gold.acceptableMatches[0];
    match.sourceRefs.push("detail:submission-details/aa.json#submission-3", "route:submission-3", "witness:change-3");
    const evidenceIndex = {
      ideaIds: new Set(candidate.gold.ideaIds),
      matchByKey: new Map([[`${match.submissionId}\0${match.changeId}`, match]]),
      sourceRefs: new Set(match.sourceRefs),
    };
    const response = {
      classification: candidate.gold.classification,
      decision: candidate.gold.decision,
      ideaIds: [candidate.gold.ideaIds[1]],
      matches: [{ ...match, sourceRefs: [match.sourceRefs[2]] }],
      caveats: [],
    };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true })).toMatchObject({
      pass: true,
      wholeAnswer: true,
      decision: true,
      citation: true,
      protocol: true,
    });
    expect(scoreCaseResponse(candidate, response, evidenceIndex, {
      valid: true,
      retrieval: {
        searchResultIds: [`attempt:${match.submissionId}:${match.changeId}:${candidate.gold.ideaIds[0]}`],
        receipts: [{ ...match, sourceRefs: [match.sourceRefs[0]] }],
      },
    })).toMatchObject({ discovery: true, evidence: true });

    const emptyIdeas = structuredClone(response);
    emptyIdeas.ideaIds = [];
    expect(scoreCaseResponse(candidate, emptyIdeas, evidenceIndex, { valid: true }).pass).toBe(false);

    const nongoldIdea = structuredClone(response);
    nongoldIdea.ideaIds = ["idea-real-but-not-gold"];
    evidenceIndex.ideaIds.add("idea-real-but-not-gold");
    expect(scoreCaseResponse(candidate, nongoldIdea, evidenceIndex, { valid: true })).toMatchObject({ pass: false, fabricated: false, decision: false });

    const fabricated = structuredClone(response);
    fabricated.matches[0].submissionId = "invented";
    expect(scoreCaseResponse(candidate, fabricated, evidenceIndex, { valid: true })).toMatchObject({ pass: false, fabricated: true });
    const fabricatedIdea = structuredClone(response);
    fabricatedIdea.ideaIds = ["idea-invented"];
    expect(scoreCaseResponse(candidate, fabricatedIdea, evidenceIndex, { valid: true })).toMatchObject({ pass: false, fabricated: true });
  });

  test("rejects a globally real citation that is unrelated to the chosen receipt", () => {
    const candidate = experimentCase(4, "prior_attempt");
    const match = candidate.gold.acceptableMatches[0];
    const unrelated = "submission:another-real-submission";
    const evidenceIndex = {
      ideaIds: new Set(candidate.gold.ideaIds),
      matchByKey: new Map([[`${match.submissionId}\0${match.changeId}`, match]]),
      sourceRefs: new Set([...match.sourceRefs, unrelated]),
    };
    const response = {
      classification: candidate.gold.classification,
      decision: candidate.gold.decision,
      ideaIds: candidate.gold.ideaIds,
      matches: [{ ...match, sourceRefs: [unrelated] }],
      caveats: [],
    };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true })).toMatchObject({ pass: false, fabricated: true, citation: false });
  });

  test("preserves the exact promotion failed status spelling", () => {
    const candidate = experimentCase(5, "prior_attempt");
    const match = candidate.gold.acceptableMatches[0];
    match.status = "promotion failed";
    const evidenceIndex = {
      ideaIds: new Set(candidate.gold.ideaIds),
      matchByKey: new Map([[`${match.submissionId}\0${match.changeId}`, match]]),
      sourceRefs: new Set(match.sourceRefs),
    };
    const response = {
      classification: candidate.gold.classification,
      decision: candidate.gold.decision,
      ideaIds: candidate.gold.ideaIds,
      matches: [match],
      caveats: [],
    };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true }).pass).toBe(true);
    response.matches[0] = { ...match, status: "promotion_failed" };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true }).pass).toBe(false);
  });

  test("marks any negative-case match as a false positive", () => {
    const candidate = experimentCase(23, "no_prior_attempt");
    const response = {
      classification: "prior_attempt",
      decision: "reject_duplicate",
      ideaIds: candidate.gold.ideaIds,
      matches: [{
        changeId: "known-change",
        submissionId: "known-submission",
        status: "promoted",
        outcome: "known",
        sourceRefs: ["submission:known-submission"],
      }],
      caveats: [],
    };
    const evidenceIndex = {
      ideaIds: new Set(candidate.gold.ideaIds),
      matchByKey: new Map([["known-submission\0known-change", response.matches[0]]]),
      sourceRefs: new Set(response.matches[0].sourceRefs),
    };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true })).toMatchObject({
      pass: false,
      negativeFalsePositive: true,
    });
  });

  test("allows negative cases to omit Ideas or return a gold subset", () => {
    const candidate = experimentCase(23, "no_prior_attempt");
    candidate.gold.ideaIds.push("idea-negative-alternate");
    const evidenceIndex = {
      ideaIds: new Set(candidate.gold.ideaIds),
      matchByKey: new Map(),
      sourceRefs: new Set(),
    };
    const response = {
      classification: candidate.gold.classification,
      decision: candidate.gold.decision,
      ideaIds: [],
      matches: [],
      caveats: [],
    };
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true }).pass).toBe(true);
    response.ideaIds = [candidate.gold.ideaIds[1]];
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true }).pass).toBe(true);
    evidenceIndex.ideaIds.add("idea-real-but-not-negative-gold");
    response.ideaIds = ["idea-real-but-not-negative-gold"];
    expect(scoreCaseResponse(candidate, response, evidenceIndex, { valid: true })).toMatchObject({ pass: false, fabricated: false, decision: false });
  });
});

describe("admission statistics", () => {
  const cases = validateCaseFixture(caseFixture()).confirmatory;

  test("uses the exact two-sided McNemar probability", () => {
    const control = Array(8).fill(false);
    const treatment = Array(8).fill(true);
    expect(exactMcNemar(control, treatment)).toEqual({ controlOnly: 0, treatmentOnly: 8, discordant: 8, pValue: 0.0078125 });
  });

  test("adopts the brief only when it clears the flat gate and also beats raw", () => {
    const analysis = analyzeConfirmatoryResults(cases, conditionResults(cases, { raw: 0, flat: 8, brief: 16 }));
    expect(analysis.comparisons["gpt-5.6-luna:flat_vs_raw"].supported).toBe(true);
    expect(analysis.comparisons["gpt-5.6-luna:flat_plus_brief_vs_flat"].supported).toBe(true);
    expect(analysis.decision).toBe("ADOPT_FLAT_PLUS_BRIEF");
  });

  test("falls back to flat or current Atlas according to the preregistered table", () => {
    expect(analyzeConfirmatoryResults(cases, conditionResults(cases, { raw: 0, flat: 8, brief: 8 })).decision).toBe("ADOPT_FLAT_INDEX");
    expect(analyzeConfirmatoryResults(cases, conditionResults(cases, { raw: 6, flat: 7, brief: 8 })).decision).toBe("RETAIN_CURRENT_ATLAS");
  });

  test("requires a non-floor, non-ceiling pilot with two distinguishing cases", () => {
    const pilot = validateCaseFixture(caseFixture()).pilot;
    expect(assessPilotResults(pilot, conditionResults(pilot, { raw: 2, flat: 3, brief: 4 })).status).toBe("PASS");
    expect(assessPilotResults(pilot, conditionResults(pilot, { raw: 6, flat: 6, brief: 6 })).status).toBe("FAIL");
  });
});

describe("production Atlas boundary", () => {
  let loaded;
  const fixturePath = path.join("/Users/c-dnguyen/Documents/project/yukon-kg", "fixtures", "atlas-duplicate-cases.json");

  beforeAll(async () => {
    loaded = await loadPinnedAtlas();
  });

  test("loads every release role and detail through the verified production loader", () => {
    expect(loaded.release.manifest.releaseId).toBe(PINNED_RELEASE_ID);
    expect(loaded.release.pointer.manifestSha256).toBe(PINNED_MANIFEST_SHA256);
    expect(loaded.detailsBySubmission.size).toBe(949);
    expect(loaded.release.decomposition.mutationWitnesses).toHaveLength(2_311);
    expect(loaded.release.decomposition.submissionRoutes).toHaveLength(949);
  });

  test("keeps raw witnesses unjoined while flat and brief expose all 2,209 routed rows", () => {
    const facts = buildAttemptFacts(loaded.release, loaded.detailsBySubmission);
    const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
    expect(evidenceIndex.matchByKey.get(
      `9bc4575f-a8ac-4a60-9151-cd4bfcc4800f\0${"9bc4575f-a8ac-4a60-9151-cd4bfcc4800f::m1"}`,
    ).ideaIds).toContain(
      "candidate:toffoli-gate-network:d8fb823289",
    );
    const corpora = materializeConditionCorpora(loaded.release, loaded.detailsBySubmission, loaded.atlas);
    expect(facts).toHaveLength(2_209);
    expect(facts.every((fact) => fact.outcome === loaded.release.submissionById.get(fact.submissionId).classification)).toBe(true);
    expect(facts.every((fact) => fact.detail === undefined)).toBe(true);
    expect(facts.some((fact) => fact.status === "promotion failed")).toBe(true);
    expect(facts.some((fact) => fact.status === "promotion_failed")).toBe(false);
    expect(corpora.raw.records.filter((record) => record.kind === "raw_mutation_witness")).toHaveLength(2_311);
    expect(corpora.raw.records.some((record) => record.kind === "raw_attempt")).toBe(false);
    const rawEvidenceKinds = new Set([
      "raw_submission",
      "raw_change",
      "raw_submission_detail",
      "raw_mutation_witness",
      "raw_submission_route",
    ]);
    const rawEvidence = corpora.raw.records.filter((record) => rawEvidenceKinds.has(record.kind));
    expect(rawEvidence.every((record) => typeof record.body.sourceRef === "string")).toBe(true);
    expect(rawEvidence.find((record) => record.kind === "raw_submission").body.sourceRef).toStartWith("submission:");
    expect(rawEvidence.find((record) => record.kind === "raw_change").body.sourceRef).toStartWith("change:");
    expect(rawEvidence.find((record) => record.kind === "raw_submission_detail").body.sourceRef).toStartWith("detail:");
    expect(rawEvidence.find((record) => record.kind === "raw_mutation_witness").body.sourceRef).toStartWith("witness:");
    expect(rawEvidence.find((record) => record.kind === "raw_submission_route").body.sourceRef).toStartWith("route:");
    expect(evidenceIndex.matchByKey.get(`${facts[0].submissionId}\0${facts[0].changeId}`).sourceRefs).toEqual(facts[0].sourceRefs);
    expect(corpora.flat.records.filter((record) => record.kind === "flat_attempt")).toHaveLength(2_209);
    expect(corpora.flat.records.filter((record) => record.kind === "idea_direction")).toHaveLength(75);
    expect(corpora.flat_plus_brief.records.filter((record) => record.kind === "idea_direction")).toHaveLength(75);
    expect(Object.values(corpora.flat.pages).reduce((total, page) => total + page.items.length, 0)).toBe(2_209);
    expect(Object.values(corpora.flat_plus_brief.pages).reduce((total, page) => total + page.items.length, 0)).toBe(2_209);
    expect(queryCorpus(corpora.flat, "search", "carry")).toEqual(queryCorpus(corpora.flat_plus_brief, "search", "carry"));
    const briefIdeaId = corpora.flat_plus_brief.records.find((record) => record.kind === "idea_direction").id;
    expect(queryCorpus(corpora.flat, "read", briefIdeaId).body.evidenceBrief).toBe(undefined);
    expect(queryCorpus(corpora.flat_plus_brief, "read", briefIdeaId).body.evidenceBrief).toBeDefined();
    for (const page of Object.values(corpora.flat_plus_brief.pages)) {
      expect(page.page.nextCursor === null || corpora.flat_plus_brief.pages[page.page.nextCursor] !== undefined).toBe(true);
    }
    for (const record of corpora.flat.records.filter((record) => record.kind === "flat_attempt")) {
      expect(Buffer.byteLength(canonicalStringify(queryCorpus(corpora.flat, "read", record.id)))).toBeLessThan(QUERY_BYTE_LIMIT);
    }
    for (const record of corpora.flat_plus_brief.records.filter((record) => record.kind === "idea_direction")) {
      expect(Buffer.byteLength(canonicalStringify(queryCorpus(corpora.flat_plus_brief, "read", record.id)))).toBeLessThan(QUERY_BYTE_LIMIT);
    }
    for (const cursor of Object.keys(corpora.flat_plus_brief.pages)) {
      expect(Buffer.byteLength(canonicalStringify(queryCorpus(corpora.flat_plus_brief, "page", cursor)))).toBeLessThan(QUERY_BYTE_LIMIT);
    }
    expect(new Set(CONDITIONS.map((condition) => sha256(corpora[condition].sourceAtoms))).size).toBe(1);
    expect(new Set(CONDITIONS.map((condition) => sha256(corpora[condition].sourceRecordIds))).size).toBe(1);
    for (const condition of CONDITIONS) {
      const ids = new Set(corpora[condition].records.map((record) => record.id));
      expect(corpora[condition].sourceRecordIds.every((id) => ids.has(id))).toBe(true);
      expect(ids.size).toBe(corpora[condition].records.length);
    }
    expect(canonicalStringify(materializeConditionCorpora(
      loaded.release,
      loaded.detailsBySubmission,
      loaded.atlas,
    ))).toBe(canonicalStringify(corpora));
  });

  test("validates the frozen real fixture against the pinned Atlas release", async () => {
    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
    const validated = validateCaseFixture(fixture, evidenceIndex);
    expect(validated.pilot).toHaveLength(6);
    expect(validated.confirmatory).toHaveLength(24);
    expect(validated.confirmatory.filter((candidate) => candidate.gold.classification === "prior_attempt")).toHaveLength(18);
    expect(validated.confirmatory.filter((candidate) => candidate.gold.classification === "no_prior_attempt")).toHaveLength(6);
  });

  test("runs the atomic preflight, pilot, confirmatory, resume-safe report flow with a fake agent", async () => {
    const directory = path.join(temporaryDirectory, "fake-run");
    const facts = buildAttemptFacts(loaded.release, loaded.detailsBySubmission);
    const ideaIds = [...loaded.release.decompositionIdeaById.keys()];
    const makeCase = ({ index, prefix, fact = null, ideaId, negativeFacts = [] }) => {
      const positive = fact !== null;
      const caseGold = {
        classification: positive ? "prior_attempt" : "no_prior_attempt",
        decision: positive ? "reject_duplicate" : "investigate_novel",
        ideaIds: [positive ? fact.ideaId : ideaId],
        acceptableMatches: positive ? [{
          changeId: fact.changeId,
          submissionId: fact.submissionId,
          status: fact.status,
          outcome: fact.outcome,
          sourceRefs: [...fact.sourceRefs].sort(),
        }] : [],
      };
      const negativeNeighbors = negativeFacts.map((neighbor) => ({
        changeId: neighbor.changeId,
        submissionId: neighbor.submissionId,
        status: neighbor.status,
        outcome: neighbor.outcome,
        sourceRefs: [...neighbor.sourceRefs].sort(),
      }));
      const retrieval = { searchProbes: [`synthetic probe ${prefix} ${index}`], negativeNeighbors };
      const decisionSha256 = sha256({ gold: caseGold, negativeNeighbors });
      return {
        id: `${prefix}-${index}`,
        query: `Synthetic sealed proposal ${prefix} ${index}`,
        directionBlockId: `${prefix}-direction-${index}`,
        strata: {
          lexicalOverlap: index % 4 === 0 ? "low" : "ordinary",
          witnessRole: prefix === "confirmatory" && index < 6 ? "nonrepresentative" : positive ? "representative" : "none",
          evidenceScope: positive ? index % 2 === 0 ? "focused" : "bundled" : "none",
        },
        gold: caseGold,
        retrieval,
        reviews: [
          { reviewerId: "fake-reviewer-a", decisionSha256, rationale: "Fake deterministic review A." },
          { reviewerId: "fake-reviewer-b", decisionSha256, rationale: "Fake deterministic review B." },
        ],
      };
    };
    const unfrozen = {
      schema: "yukon.atlas-duplicate-cases",
      schemaVersion: 2,
      protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
      release: { id: PINNED_RELEASE_ID, manifestSha256: PINNED_MANIFEST_SHA256 },
      frozenAt: "2026-08-24T12:00:00.000Z",
      pilot: [
        ...facts.slice(0, 4).map((fact, index) => makeCase({ index, prefix: "pilot", fact })),
        ...ideaIds.slice(60, 62).map((ideaId, offset) => makeCase({
          index: 4 + offset,
          prefix: "pilot",
          ideaId,
          negativeFacts: facts.slice(100 + offset * 2, 102 + offset * 2),
        })),
      ],
      confirmatory: [
        ...facts.slice(10, 28).map((fact, index) => makeCase({ index, prefix: "confirmatory", fact })),
        ...ideaIds.slice(62, 68).map((ideaId, offset) => makeCase({
          index: 18 + offset,
          prefix: "confirmatory",
          ideaId,
          negativeFacts: facts.slice(200 + offset * 2, 202 + offset * 2),
        })),
      ],
    };
    const fixture = { ...unfrozen, fixtureSha256: sha256(unfrozen) };
    const fixturePath = path.join(temporaryDirectory, "fake-cases.json");
    await fs.writeFile(fixturePath, `${canonicalStringify(fixture)}\n`);
    const fakeLoader = async () => loaded;
    const preflightReport = await preflight(directory, {
      fixturePath,
      loader: fakeLoader,
      parity: { status: "PASS", corrections: [], evidence: "fake-deterministic-parity" },
      reachability: { status: "PASS", corrections: [], evidence: "fake-deterministic-reachability" },
      isolation: { status: "PASS", corrections: [], evidence: "fake-no-model-test" },
    });
    expect(preflightReport.status).toBe("PASS");
    expect(preflightReport.deterministic.counts).toEqual({
      ideas: 75,
      rawMutationWitnesses: 2_311,
      ideaRoutedCompilerRows: 2_209,
      submissionRoutes: 949,
      verifiedSubmissionDetails: 949,
    });
    let invocations = 0;
    const invokeAgent = async ({ cwd, candidate, condition }) => {
      invocations += 1;
      await fs.writeFile(path.join(cwd, "query-state.json"), canonicalStringify({
        calls: 1,
        returnedBytes: 100,
        callLimit: QUERY_CALL_LIMIT,
        byteLimit: QUERY_BYTE_LIMIT,
        history: [{ call: 1, operation: "search", argument: "ladder", returnedBytes: 100 }],
      }));
      const index = Number.parseInt(candidate.id.slice(candidate.id.lastIndexOf("-") + 1), 10);
      const threshold = candidate.id.startsWith("pilot-")
        ? { raw: 2, flat: 3, flat_plus_brief: 4 }[condition]
        : { raw: 1, flat: 9, flat_plus_brief: 17 }[condition];
      const passing = index < threshold;
      const response = passing ? {
        classification: candidate.gold.classification,
        decision: candidate.gold.decision,
        ideaIds: candidate.gold.ideaIds,
        matches: candidate.gold.acceptableMatches,
        caveats: [],
      } : {
        classification: "uncertain",
        decision: "uncertain",
        ideaIds: [],
        matches: [],
        caveats: ["Fake miss."],
      };
      const events = commandEvents();
      return {
        events,
        lastMessage: canonicalStringify(response),
        usage: { output_tokens: 100 },
        process: {
          command: "fake-codex",
          args: [],
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 1,
          stdout: `${events.map((event) => canonicalStringify(event)).join("\n")}\n`,
          stderr: "",
        },
      };
    };
    const pilot = await runPilot(directory, { loader: fakeLoader, invokeAgent, concurrency: 3 });
    expect(pilot.analysis.status).toBe("PASS");
    expect(invocations).toBe(6 * 3 * 2 * 3);
    await runPilot(directory, { loader: fakeLoader, invokeAgent, concurrency: 3 });
    expect(invocations).toBe(6 * 3 * 2 * 3);
    const confirmatory = await runConfirmatory(directory, { loader: fakeLoader, invokeAgent, concurrency: 6 });
    expect(confirmatory.analysis.decision).toBe("ADOPT_FLAT_PLUS_BRIEF");
    expect(invocations).toBe((6 + 24) * 3 * 2 * 3);
    await runConfirmatory(directory, { loader: fakeLoader, invokeAgent, concurrency: 6 });
    expect(invocations).toBe((6 + 24) * 3 * 2 * 3);
    expect((await report(directory)).decision).toBe("ADOPT_FLAT_PLUS_BRIEF");
  }, 30_000);
});
