import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeAtlasDuplicatePilotRun,
  renderAtlasDuplicateDiagnosticTable,
  writeAtlasDuplicatePilotDiagnostic,
} from "../src/atlas-duplicate-diagnostics.js";

const RUN_DIRECTORY = process.env.ATLAS_DUPLICATE_DIAGNOSTIC_RUN
  ?? path.resolve(import.meta.dir, "..", ".runs", "atlas-duplicate", "2026-08-25T05-08-53-575Z-671ebb8d");
const diagnosticTest = existsSync(path.join(RUN_DIRECTORY, "manifest.json")) ? test : test.skip;

let temporaryDirectory;

beforeAll(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-duplicate-diagnostic-"));
});

afterAll(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe("atlas duplicate pilot diagnostics", () => {
  diagnosticTest("derives stable first-failure diagnostics for the v3 pilot run", async () => {
    const diagnostic = await analyzeAtlasDuplicatePilotRun(RUN_DIRECTORY);
    expect(diagnostic.schema).toBe("yukon.atlas-duplicate-diagnostic");
    expect(diagnostic.protocolVersion).toBe("yukon-kg.atlas-duplicate.v3");
    expect(diagnostic.rows).toHaveLength(18);
    expect(diagnostic.summary).toEqual({
      totalsByCondition: {
        brief: { passed: 2, sessions: 6 },
        flat: { passed: 2, sessions: 6 },
        raw: { passed: 0, sessions: 6 },
      },
      totalsByFirstFailure: {
        decision: 0,
        discovery: 9,
        drill_down: 0,
        evidence: 3,
        none: 4,
        output: 2,
      },
    });

    const briefWin = diagnostic.rows.find((row) => row.caseId === "pilot-positive-02" && row.condition === "brief");
    expect(briefWin).toEqual({
      auditViolations: [],
      calls: 4,
      caseId: "pilot-positive-02",
      condition: "brief",
      finalAnswerBytes: 806,
      firstFailure: "none",
      openedRefs: ["brief:candidate:in-place-multiplication:b6f8aa1086"],
      pass: true,
      requiredFields: [],
      retrievedBytes: 10167,
      scoreFailures: [],
      scoringReason: "passed",
      searchHit: {
        commandCall: 1,
        query: "square helper spill restore shift correction high half doubles halves",
        recordId: "brief:candidate:in-place-multiplication:b6f8aa1086",
        searchRank: 6,
      },
    });

    const briefOutput = diagnostic.rows.find((row) => row.caseId === "pilot-negative-02" && row.condition === "brief");
    expect(briefOutput).toEqual({
      auditViolations: ["session exceeded the answer-token budget"],
      calls: 8,
      caseId: "pilot-negative-02",
      condition: "brief",
      finalAnswerBytes: 235,
      firstFailure: "output",
      openedRefs: [
        "raw:change:155ebc56-b6e3-42c1-8246-0556cd8e8e80:155ebc56-b6e3-42c1-8246-0556cd8e8e80::m1",
        "raw:detail:b543b2d1-a34c-4675-a6f4-6e84d8e83f2b",
      ],
      pass: false,
      requiredFields: ["answerTokens"],
      retrievedBytes: 11896,
      scoreFailures: ["session exceeded the answer-token budget"],
      scoringReason: "session exceeded the answer-token budget",
      searchHit: null,
    });

    const rawEvidence = diagnostic.rows.find((row) => row.caseId === "pilot-positive-06" && row.condition === "raw");
    expect(rawEvidence).toEqual({
      auditViolations: [],
      calls: 6,
      caseId: "pilot-positive-06",
      condition: "raw",
      finalAnswerBytes: 434,
      firstFailure: "evidence",
      openedRefs: [
        "raw:detail:2ae22188-5229-4d47-9775-73126eca82f2",
        "raw:submission:2ae22188-5229-4d47-9775-73126eca82f2",
      ],
      pass: false,
      requiredFields: ["ideaIds", "matches.outcome"],
      retrievedBytes: 10599,
      scoreFailures: [
        "response contains an Idea outside the acceptable gold set",
        "response contains a fabricated ID or source reference",
        "match 2ae22188-5229-4d47-9775-73126eca82f2/2ae22188-5229-4d47-9775-73126eca82f2::m1 is not an exact acceptable match",
      ],
      scoringReason: "response contains an Idea outside the acceptable gold set; response contains a fabricated ID or source reference; match 2ae22188-5229-4d47-9775-73126eca82f2/2a…",
      searchHit: {
        commandCall: 1,
        query: "ECDSA symmetric squaring partial products two-bit carry window forward inverse",
        recordId: "raw:detail:2ae22188-5229-4d47-9775-73126eca82f2",
        searchRank: 2,
      },
    });
  });

  diagnosticTest("writes a byte-stable diagnostic artifact and compact table", async () => {
    const output = path.join(temporaryDirectory, "diagnostic.json");
    const first = await writeAtlasDuplicatePilotDiagnostic(RUN_DIRECTORY, output);
    const firstBytes = await fs.readFile(output, "utf8");
    const second = await writeAtlasDuplicatePilotDiagnostic(RUN_DIRECTORY, output);
    const secondBytes = await fs.readFile(output, "utf8");
    expect(firstBytes).toBe(secondBytes);
    expect(first.diagnostic).toEqual(second.diagnostic);

    const table = renderAtlasDuplicateDiagnosticTable(first.diagnostic);
    expect(table).toContain("first_failure");
    expect(table).toContain("pilot-positive-02");
    expect(table).toContain("pilot-negative-02");
    expect(table).toContain("pilot-positive-06");
  });
});
