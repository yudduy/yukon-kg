import { CONDITIONS } from "./atlas-duplicate-protocol.js";
import { canonicalStringify, sha256 } from "./protocol.js";

export const ATLAS_ACCESS_ANALYSIS_SCHEMA = "yukon.atlas-access-analysis.v1";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function finiteNumber(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${context} must be a finite nonnegative number`);
  }
  return value;
}

function selectReachablePath(conditionReport, context) {
  if (conditionReport?.status !== "PASS") return null;
  if (conditionReport.sharedPath !== undefined) return conditionReport.sharedPath;
  if (!Array.isArray(conditionReport.targets)) throw new Error(`${context} has no target paths`);
  const passing = conditionReport.targets
    .filter((path) => path.status === "PASS")
    .sort((left, right) => (
      finiteNumber(left.calls, `${context}.calls`) - finiteNumber(right.calls, `${context}.calls`)
      || finiteNumber(left.returnedBytes, `${context}.returnedBytes`) - finiteNumber(right.returnedBytes, `${context}.returnedBytes`)
    ));
  return passing[0] ?? null;
}

function caseMetadata(fixture) {
  const cases = [...(fixture?.pilot ?? []), ...(fixture?.confirmatory ?? [])];
  const metadata = new Map();
  for (const candidate of cases) {
    if (typeof candidate?.id !== "string" || candidate.id === "") throw new Error("fixture case has no ID");
    if (metadata.has(candidate.id)) throw new Error(`duplicate fixture case ${candidate.id}`);
    metadata.set(candidate.id, {
      classification: candidate.gold?.classification ?? "unknown",
      lexicalOverlap: candidate.strata?.lexicalOverlap ?? "unknown",
      witnessRole: candidate.strata?.witnessRole ?? "unknown",
      evidenceScope: candidate.strata?.evidenceScope ?? "unknown",
    });
  }
  return metadata;
}

function pairedSummary(rows, treatment, control, metric) {
  const differences = rows.map((row) => row[treatment][metric] - row[control][metric]);
  return {
    cases: rows.length,
    meanTreatment: mean(rows.map((row) => row[treatment][metric])),
    meanControl: mean(rows.map((row) => row[control][metric])),
    meanDifference: mean(differences),
    medianDifference: median(differences),
    treatmentLower: differences.filter((value) => value < 0).length,
    ties: differences.filter((value) => value === 0).length,
    treatmentHigher: differences.filter((value) => value > 0).length,
  };
}

function summarizeRows(rows) {
  return {
    cases: rows.length,
    conditions: Object.fromEntries(CONDITIONS.map((condition) => [condition, {
      meanCalls: mean(rows.map((row) => row[condition].calls)),
      medianCalls: median(rows.map((row) => row[condition].calls)),
      meanReturnedBytes: mean(rows.map((row) => row[condition].returnedBytes)),
      medianReturnedBytes: median(rows.map((row) => row[condition].returnedBytes)),
    }])),
    comparisons: {
      flatVsRawCalls: pairedSummary(rows, "flat", "raw", "calls"),
      flatVsRawBytes: pairedSummary(rows, "flat", "raw", "returnedBytes"),
      flatPlusBriefVsFlatCalls: pairedSummary(rows, "flat_plus_brief", "flat", "calls"),
      flatPlusBriefVsFlatBytes: pairedSummary(rows, "flat_plus_brief", "flat", "returnedBytes"),
    },
  };
}

function stratumKey(row) {
  return [row.retrievalKind, row.lexicalOverlap, row.witnessRole, row.evidenceScope].join("|");
}

export function analyzeAtlasAccess(reachability, fixture) {
  if (reachability?.schema !== "yukon.atlas-reachability-report") {
    throw new Error("unsupported Atlas reachability report");
  }
  const metadata = caseMetadata(fixture);
  const rows = [];
  const failedByCondition = Object.fromEntries(CONDITIONS.map((condition) => [condition, []]));
  for (const report of reachability.caseReports ?? []) {
    const meta = metadata.get(report.caseId);
    if (meta === undefined) throw new Error(`reachability case ${report.caseId} is absent from the fixture`);
    const paths = {};
    for (const condition of CONDITIONS) {
      const conditionReport = report.conditionReports?.[condition];
      const path = selectReachablePath(conditionReport, `${report.caseId}.${condition}`);
      if (path === null) {
        failedByCondition[condition].push(report.caseId);
        continue;
      }
      paths[condition] = {
        calls: finiteNumber(path.calls, `${report.caseId}.${condition}.calls`),
        returnedBytes: finiteNumber(path.returnedBytes, `${report.caseId}.${condition}.returnedBytes`),
      };
    }
    if (CONDITIONS.every((condition) => paths[condition] !== undefined)) {
      rows.push({
        caseId: report.caseId,
        retrievalKind: report.retrievalKind,
        ...meta,
        ...paths,
      });
    }
  }
  rows.sort((left, right) => compareText(left.caseId, right.caseId));
  const grouped = new Map();
  for (const row of rows) {
    const key = stratumKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const analysis = {
    schema: ATLAS_ACCESS_ANALYSIS_SCHEMA,
    protocolVersion: reachability.protocolVersion ?? fixture.protocolVersion ?? null,
    reachabilityBudget: {
      callLimit: reachability.callLimit,
      returnedByteLimit: reachability.byteLimit,
    },
    input: {
      cases: reachability.caseReports?.length ?? 0,
      fixtureSha256: fixture.fixtureSha256 ?? sha256(canonicalStringify(fixture)),
      reachabilitySha256: sha256(canonicalStringify(reachability)),
    },
    admission: {
      allArmReachableCases: rows.length,
      excludedCases: (reachability.caseReports?.length ?? 0) - rows.length,
      failedByCondition: Object.fromEntries(CONDITIONS.map((condition) => [
        condition,
        failedByCondition[condition].sort(compareText),
      ])),
    },
    overall: summarizeRows(rows),
    byRetrievalKind: Object.fromEntries(["positive", "negative"].map((kind) => [
      kind,
      summarizeRows(rows.filter((row) => row.retrievalKind === kind)),
    ])),
    byStratum: Object.fromEntries([...grouped.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => [key, summarizeRows(value)])),
    rows,
    interpretationBoundary: [
      "These are deterministic oracle traversal costs over a finite reviewed court, not agent success rates.",
      "The automatic recovery path is a fixed target-aware procedure, not a proof of globally minimal retrieval cost.",
      "A flat or brief advantage in tool calls can trade off against returned bytes and construction cost.",
    ],
  };
  analysis.analysisSha256 = sha256(canonicalStringify(analysis));
  return analysis;
}

