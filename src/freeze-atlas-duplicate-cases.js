#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadPinnedAtlas } from "./atlas-duplicate-mve.js";
import {
  ATLAS_DUPLICATE_PROTOCOL_VERSION,
  PINNED_MANIFEST_SHA256,
  PINNED_RELEASE_ID,
  buildEvidenceIndex,
  validateCaseFixture,
  writeCanonicalJson,
} from "./atlas-duplicate-protocol.js";
import { sha256 } from "./protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE = path.join(ROOT, ".runs", "atlas-duplicate", "candidate-cases-v5.json");
const DEFAULT_REFRESH = path.join(ROOT, ".runs", "atlas-duplicate", "case-refresh-v6.json");
const DEFAULT_THIRD_PROBES = path.join(ROOT, ".runs", "atlas-duplicate", "query-probes-third-v4.json");
const DEFAULT_REVIEW_A = path.join(ROOT, ".runs", "atlas-duplicate", "fresh-review-a-v5.json");
const DEFAULT_REVIEW_B = path.join(ROOT, ".runs", "atlas-duplicate", "fresh-review-b-v5.json");
const DEFAULT_REVIEW_REFRESH_A = path.join(ROOT, ".runs", "atlas-duplicate", "review-refresh-a-v6.json");
const DEFAULT_REVIEW_REFRESH_B = path.join(ROOT, ".runs", "atlas-duplicate", "review-refresh-b-v6.json");
const DEFAULT_OUTPUT = path.join(ROOT, "fixtures", "atlas-duplicate-cases.json");

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

function normalizeGold(gold, evidenceIndex) {
  return {
    classification: gold.classification,
    decision: gold.decision,
    ideaIds: [...gold.ideaIds].sort(),
    acceptableMatches: gold.acceptableMatches.map((match) => {
      const expected = evidenceIndex.matchByKey.get(`${match.submissionId}\0${match.changeId}`);
      if (expected === undefined) throw new Error(`unknown match ${match.submissionId}/${match.changeId}`);
      return {
        changeId: expected.changeId,
        submissionId: expected.submissionId,
        status: expected.status,
        outcome: expected.outcome,
        sourceRefs: expected.sourceRefs,
      };
    }),
  };
}

function normalizeRetrieval(retrieval, evidenceIndex) {
  return {
    searchProbes: [...retrieval.searchProbes],
    negativeNeighbors: retrieval.negativeNeighbors.map((match) => {
      const expected = evidenceIndex.matchByKey.get(`${match.submissionId}\0${match.changeId}`);
      if (expected === undefined) throw new Error(`unknown negative neighbor ${match.submissionId}/${match.changeId}`);
      return {
        changeId: expected.changeId,
        submissionId: expected.submissionId,
        status: expected.status,
        outcome: expected.outcome,
        sourceRefs: expected.sourceRefs,
      };
    }),
  };
}

function reviewMap(review) {
  return new Map(review.cases.map((entry) => {
    if (entry.verdict !== "accept" || entry.corrections !== null) {
      throw new Error(`${review.reviewerId} did not accept ${entry.id}`);
    }
    const reviewerId = entry.reviewerId ?? review.reviewerId;
    if (typeof reviewerId !== "string" || reviewerId === "") throw new Error(`reviewer ID is missing for ${entry.id}`);
    return [entry.id, { reviewerId, rationale: entry.rationale }];
  }));
}

function frozenFixtureValue(fixture) {
  const { fixtureSha256: _ignored, ...frozen } = fixture;
  return frozen;
}

export async function freezeCases({
  candidatePath = DEFAULT_CANDIDATE,
  refreshPath = DEFAULT_REFRESH,
  thirdProbesPath = DEFAULT_THIRD_PROBES,
  reviewAPath = DEFAULT_REVIEW_A,
  reviewBPath = DEFAULT_REVIEW_B,
  reviewRefreshAPath = DEFAULT_REVIEW_REFRESH_A,
  reviewRefreshBPath = DEFAULT_REVIEW_REFRESH_B,
  outputPath = DEFAULT_OUTPUT,
  frozenAt = new Date().toISOString(),
} = {}) {
  const [baseCandidate, refresh, thirdProbes, reviewA, reviewB, reviewRefreshA, reviewRefreshB, loaded] = await Promise.all([
    readJson(candidatePath),
    readJson(refreshPath),
    readJson(thirdProbesPath),
    readJson(reviewAPath),
    readJson(reviewBPath),
    readJson(reviewRefreshAPath),
    readJson(reviewRefreshBPath),
    loadPinnedAtlas(),
  ]);
  const replacementById = new Map(refresh.confirmatoryReplacements.map((candidate) => [candidate.id, candidate]));
  const retrievalById = new Map(Object.entries(refresh.confirmatoryRetrieval));
  const addThirdProbe = (candidate) => {
    const thirdProbe = thirdProbes[candidate.id];
    if (typeof thirdProbe !== "string" || thirdProbe === "") throw new Error(`missing blind third probe for ${candidate.id}`);
    return {
      ...candidate,
      retrieval: {
        ...candidate.retrieval,
        searchProbes: [...candidate.retrieval.searchProbes, thirdProbe],
      },
    };
  };
  const candidate = {
    ...baseCandidate,
    pilot: refresh.pilot.map(addThirdProbe),
    confirmatory: baseCandidate.confirmatory.map((entry) => (
      replacementById.get(entry.id) ?? { ...entry, retrieval: retrievalById.get(entry.id) }
    )).map(addThirdProbe),
  };
  const evidenceIndex = buildEvidenceIndex(loaded.release, loaded.detailsBySubmission);
  const reviewsA = reviewMap({ ...reviewA, cases: [...reviewA.cases, ...reviewRefreshA.cases] });
  const reviewsB = reviewMap({ ...reviewB, cases: [...reviewB.cases, ...reviewRefreshB.cases] });

  const normalizeCase = (candidateCase) => {
    const gold = normalizeGold(candidateCase.gold, evidenceIndex);
    const retrieval = normalizeRetrieval(candidateCase.retrieval, evidenceIndex);
    const sourceReviews = [reviewsA.get(candidateCase.id), reviewsB.get(candidateCase.id)];
    if (sourceReviews.some((review) => review === undefined)) {
      throw new Error(`case ${candidateCase.id} does not have two independent reviews`);
    }
    const decisionSha256 = sha256({ gold, negativeNeighbors: retrieval.negativeNeighbors });
    return {
      id: candidateCase.id,
      query: candidateCase.query,
      directionBlockId: candidateCase.directionBlockId,
      strata: candidateCase.strata,
      gold,
      retrieval,
      reviews: sourceReviews.map((review) => ({
        reviewerId: review.reviewerId,
        decisionSha256,
        rationale: review.rationale,
      })),
    };
  };

  const fixture = {
    schema: "yukon.atlas-duplicate-cases",
    schemaVersion: 2,
    protocolVersion: ATLAS_DUPLICATE_PROTOCOL_VERSION,
    release: { id: PINNED_RELEASE_ID, manifestSha256: PINNED_MANIFEST_SHA256 },
    frozenAt,
    pilot: candidate.pilot.map(normalizeCase),
    confirmatory: candidate.confirmatory.map(normalizeCase),
  };
  fixture.fixtureSha256 = sha256(frozenFixtureValue(fixture));
  validateCaseFixture(fixture, evidenceIndex);
  await writeCanonicalJson(outputPath, fixture);
  return fixture;
}

if (import.meta.main) {
  freezeCases().then((fixture) => {
    process.stdout.write(`${JSON.stringify({ fixtureSha256: fixture.fixtureSha256, output: DEFAULT_OUTPUT })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
