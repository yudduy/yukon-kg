import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadIndexedAtlasRelease } from "../src/atlas-local.js";
import {
  ECDSA_USER_CASES,
  ECDSA_USER_VIEW_SCHEMA,
  WORKING_KNOWLEDGE_SCHEMA,
  analyzeUserRepresentationExperiment,
  buildEcdsaUserView,
  buildEcdsaWorkingKnowledgeBrief,
  compileUserDecision,
  ideasFromRelease,
  renderWorkingKnowledgePage,
} from "../src/atlas-runtime/index.ts";
import { sha256 } from "../src/protocol.js";

const loaded = await loadIndexedAtlasRelease("default");
const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
const view = buildEcdsaUserView(brief, sha256(brief));
const html = renderWorkingKnowledgePage(view);
const experiment = analyzeUserRepresentationExperiment(brief, ideasFromRelease(loaded.release));

describe("compileUserDecision", () => {
  test("doNow leads with Barrett and keeps admitted isolations out of the next-action list", () => {
    const decision = compileUserDecision(brief);
    expect(decision.doNow[0]?.id).toBe("disc:barrett-vs-solinas");
    expect(decision.doNow.some((item) => item.id === "disc:barrett-vs-solinas")).toBe(true);
    expect(decision.doNow.some((item) => item.id.includes("adaptive-phase"))).toBe(false);
    expect(decision.knownLocalMoves[0]?.id).toContain("adaptive-phase-correction");
    expect(decision.avoid.some((item) => item.id === "hazard:seed-grinding")).toBe(true);
    expect(decision.avoid.some((item) => item.id === "avoid:karatsuba-ping-pong")).toBe(true);
    expect(decision.avoid.some((item) => item.id.includes("fermat-inversion"))).toBe(true);
  });

  test("knownLocalMoves include Solinas as a Toffoli-up product win", () => {
    const decision = compileUserDecision(brief);
    const solinas = decision.knownLocalMoves.find((item) => item.id.includes("solinas-reduction"));
    expect(solinas).toBeDefined();
    expect(solinas?.reason).toMatch(/Toffoli rose/i);
  });
});

describe("user view packet", () => {
  test("wraps the brief and pins the SHA-256", () => {
    expect(view.schema).toBe(ECDSA_USER_VIEW_SCHEMA);
    expect(view.briefSha256).toHaveLength(64);
    expect(view.briefSha256).toBe(sha256(brief));
    expect(view.brief.schema).toBe(WORKING_KNOWLEDGE_SCHEMA);
    expect(view.decision.doNow[0]?.id).toBe("disc:barrett-vs-solinas");
  });
});

describe("HTML landing page", () => {
  test("leads with frontier, qubits, Toffoli, and the admitted isolations", () => {
    expect(html).toContain('data-testid="frontier-score"');
    expect(html).toContain('data-frontier-score="1182644586"');
    expect(html).toContain('data-qubits="1150"');
    expect(html).toContain("Adaptive phase correction");
    expect(html).toContain("Solinas reduction");
    expect(html).toContain("Quantum–classical comparator");
  });

  test("names the do / don't packet and Barrett as the next discriminator", () => {
    expect(html).toContain('data-testid="decision"');
    expect(html).toContain("Do not treat nonce / seed grinding as a circuit mechanism");
    expect(html).toContain("Barrett reciprocal reduction");
    expect(html).toContain('data-discriminator-id="disc:barrett-vs-solinas"');
    expect(html).toContain('href="./working-knowledge.json"');
    expect(html).toContain('href="./index.json"');
  });

  test("does not dump the submission archive as the home view", () => {
    expect(html).not.toContain("949 submissions");
    expect(html).toContain("archive is sealed");
  });
});

describe("user-representation experiment", () => {
  test("covers the eight frozen user questions", () => {
    expect(ECDSA_USER_CASES).toHaveLength(8);
    expect(experiment.totals.working_knowledge.cases).toBe(8);
    expect(experiment.totals.archive_promotions.cases).toBe(8);
  });

  test("archive promotions misleads on seed grinding and largest isolated effect", () => {
    const archive = Object.fromEntries(experiment.results.archive_promotions.map((row) => [row.caseId, row]));
    expect(archive["seed-grinding-mechanism"]?.pass).toBe(false);
    expect(archive["largest-isolated-effect"]?.pass).toBe(false);
    expect(archive["largest-isolated-effect"]?.answer.toLowerCase()).toMatch(/nonce|seed/);
  });

  test("working-knowledge answers all eight and is adopted", () => {
    expect(experiment.totals.working_knowledge.passed).toBe(8);
    expect(experiment.totals.archive_promotions.passed).toBeLessThan(8);
    expect(experiment.adoptedRepresentation).toBe("working_knowledge");
    expect(experiment.reason).toMatch(/promotions misled/i);
  });
});

describe("checked-in presentation matches a live compile", () => {
  test("working-knowledge.json and index.html are byte-stable", async () => {
    const jsonPath = join(import.meta.dir, "../docs/ecdsa/working-knowledge.json");
    const htmlPath = join(import.meta.dir, "../docs/ecdsa/index.html");
    const onDiskJson = await readFile(jsonPath, "utf8");
    const onDiskHtml = await readFile(htmlPath, "utf8");
    expect(onDiskJson).toBe(`${JSON.stringify(view, null, 2)}\n`);
    expect(onDiskHtml).toBe(html);
  });
});
