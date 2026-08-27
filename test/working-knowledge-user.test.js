import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadIndexedAtlasRelease } from "../src/atlas-local.js";
import {
  ECDSA_USER_CASES,
  ECDSA_USER_VIEW_SCHEMA,
  ECDSA_USER_VIEW_SCHEMA_VERSION,
  WORKING_KNOWLEDGE_SCHEMA,
  analyzeUserRepresentationExperiment,
  buildEcdsaUserView,
  buildEcdsaWorkingKnowledgeBrief,
  ideasFromRelease,
  renderWorkingKnowledgePage,
} from "../src/atlas-runtime/index.ts";
import { sha256 } from "../src/protocol.js";

const loaded = await loadIndexedAtlasRelease("default");
const brief = buildEcdsaWorkingKnowledgeBrief(loaded.release, loaded.experimentDetails);
const view = buildEcdsaUserView(brief, sha256(brief));
const html = renderWorkingKnowledgePage(view);
const experiment = analyzeUserRepresentationExperiment(brief, ideasFromRelease(loaded.release));

describe("user view packet", () => {
  test("wraps the brief without a doNow ranking", () => {
    expect(view.schema).toBe(ECDSA_USER_VIEW_SCHEMA);
    expect(view.schemaVersion).toBe(ECDSA_USER_VIEW_SCHEMA_VERSION);
    expect(view.briefSha256).toHaveLength(64);
    expect(view.briefSha256).toBe(sha256(brief));
    expect(view.brief.schema).toBe(WORKING_KNOWLEDGE_SCHEMA);
    expect(view).not.toHaveProperty("decision");
    expect(view.brief.supportedMechanisms[0]?.ideaId).toBe("candidate:adaptive-phase-correction:a391ebef3b");
    expect(view.brief.nextDiscriminators.some((item) => item.discriminatorId === "disc:barrett-vs-solinas")).toBe(true);
  });
});

describe("HTML landing page", () => {
  test("leads with frontier, qubits, Toffoli, and admitted isolations", () => {
    expect(html).toContain('data-testid="frontier-score"');
    expect(html).toContain('data-frontier-score="1182644586"');
    expect(html).toContain('data-qubits="1150"');
    expect(html).toContain("Adaptive phase correction");
    expect(html).toContain("Solinas reduction");
    expect(html).toContain("Quantum–classical comparator");
  });

  test("is an inventory of scores and open cuts, not a next-move ranking", () => {
    expect(html).toContain("does not recommend a next experiment");
    expect(html).not.toContain("What isolated move is worth trying next");
    expect(html).not.toContain('data-decision="do"');
    expect(html).not.toContain("<div class=\"eyebrow\">Do</div>");
    expect(html).not.toContain("<div class=\"eyebrow\">Don't</div>");
    expect(html).not.toContain("<div class=\"eyebrow\">Reuse</div>");
    expect(html).toContain("Barrett reciprocal reduction");
    expect(html).toContain('data-discriminator-id="disc:barrett-vs-solinas"');
    expect(html).toContain("proposed unverified");
    expect(html).toContain("Archive-only coverage signals");
    expect(html).toContain("inventory, not proof");
    expect(html).toContain("Nonce / seed grinding");
    expect(html).toContain('href="./working-knowledge.json"');
    expect(html).toContain('href="./index.json"');
  });

  test("does not dump the submission archive as the home view", () => {
    expect(html).not.toContain('data-section="submissions"');
    expect(html).not.toMatch(/<tbody>[\s\S]*submission:/);
    expect(html).toContain("archive is sealed");
    expect(html).toContain("JSON packet");
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
