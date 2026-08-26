import { CONDITIONS } from "./atlas-duplicate-protocol.js";
import { queryCorpus } from "./atlas-query.js";
import { canonicalStringify } from "./protocol.js";

export const MAX_SEARCH_PROBES_PER_CASE = 3;
export const REQUIRED_NEGATIVE_NEIGHBORS = 2;
export const REACHABILITY_CALL_LIMIT = 11;
export const REACHABILITY_BYTE_LIMIT = 22 * 1024;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function receiptKey(receipt) {
  return `${receipt.submissionId}\0${receipt.changeId}`;
}

function resultBytes(result) {
  return Buffer.byteLength(`${canonicalStringify(result)}\n`);
}

function arraysEqual(left, right) {
  return canonicalStringify([...left].sort()) === canonicalStringify([...right].sort());
}

function normalizeStringArray(value, context) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${context} must be a non-empty array`);
  const strings = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") throw new Error(`${context}[${index}] must be a non-empty string`);
    return entry;
  });
  if (new Set(strings).size !== strings.length) throw new Error(`${context} must not contain duplicates`);
  return strings;
}

function normalizeReceipt(receipt, evidenceIndex, context) {
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error(`${context} must be an object`);
  const expected = evidenceIndex.matchByKey.get(receiptKey(receipt));
  if (expected === undefined) throw new Error(`${context} does not resolve to the pinned evidence index`);
  const sourceRefs = normalizeStringArray(receipt.sourceRefs, `${context}.sourceRefs`).sort(compareText);
  if (receipt.status !== expected.status || receipt.outcome !== expected.outcome || !arraysEqual(sourceRefs, expected.sourceRefs)) {
    throw new Error(`${context} must match the exact pinned status, outcome, and source refs`);
  }
  return {
    submissionId: receipt.submissionId,
    changeId: receipt.changeId,
    status: receipt.status,
    outcome: receipt.outcome,
    sourceRefs,
    ideaIds: [...(expected.ideaIds ?? [])].sort(compareText),
  };
}

function rawSubmissionId(recordId) {
  return recordId.startsWith("raw:submission:") ? recordId.slice("raw:submission:".length) : null;
}

function rawChangeParts(recordId) {
  if (!recordId.startsWith("raw:change:")) return null;
  const remainder = recordId.slice("raw:change:".length);
  const boundary = remainder.indexOf(":");
  if (boundary < 0) return null;
  return {
    submissionId: remainder.slice(0, boundary),
    changeId: remainder.slice(boundary + 1),
  };
}

function rawDetailId(recordId) {
  return recordId.startsWith("raw:detail:") ? recordId.slice("raw:detail:".length) : null;
}

function rawRouteId(recordId) {
  return recordId.startsWith("raw:route:") ? recordId.slice("raw:route:".length) : null;
}

function rawWitnessId(recordId) {
  return recordId.startsWith("raw:witness:") ? recordId.slice("raw:witness:".length) : null;
}

function ideaDirectionId(recordId) {
  return recordId.startsWith("idea:") ? recordId.slice("idea:".length) : null;
}

function deriveFlatAttemptId(item) {
  if (!item?.submissionId || !item?.changeId || !item?.ideaId) return null;
  return `attempt:${item.submissionId}:${item.changeId}:${item.ideaId}`;
}

function surfaceSubmissionReferences(state, submissionId, detailShard = null) {
  if (typeof submissionId !== "string" || submissionId === "") return;
  for (const id of [`raw:submission:${submissionId}`, `raw:route:${submissionId}`, `raw:detail:${submissionId}`]) {
    if (state.recordIds.has(id)) state.surfacedIds.add(id);
  }
  if (typeof detailShard === "string" && detailShard !== "" && state.recordIds.has(`raw:detail:${submissionId}`)) {
    state.surfacedIds.add(`raw:detail:${submissionId}`);
  }
}

function surfaceSourceReference(state, sourceRef) {
  if (typeof sourceRef !== "string") return;
  let match = /^submission:([^:]+)$/u.exec(sourceRef);
  if (match !== null) return surfaceSubmissionReferences(state, match[1]);
  match = /^route:([^:]+)$/u.exec(sourceRef);
  if (match !== null) return surfaceSubmissionReferences(state, match[1]);
  match = /^change:([^:]+):(.+)$/u.exec(sourceRef);
  if (match !== null) {
    surfaceSubmissionReferences(state, match[1]);
    if (state.recordIds.has(`raw:change:${match[1]}:${match[2]}`)) state.surfacedIds.add(`raw:change:${match[1]}:${match[2]}`);
    return;
  }
  match = /^witness:(.+)$/u.exec(sourceRef);
  if (match !== null && state.recordIds.has(`raw:witness:${match[1]}`)) state.surfacedIds.add(`raw:witness:${match[1]}`);
}

function surfaceBodyReferences(state, value) {
  if (Array.isArray(value)) {
    for (const entry of value) surfaceBodyReferences(state, entry);
    return;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      surfaceSourceReference(state, value);
      const evidenceMatch = /^ev:([0-9a-f-]{36}):/u.exec(value);
      if (evidenceMatch !== null) surfaceSubmissionReferences(state, evidenceMatch[1]);
      const changeMatch = /^([0-9a-f-]{36})::m\d+$/u.exec(value);
      if (changeMatch !== null) {
        surfaceSubmissionReferences(state, changeMatch[1]);
        if (state.recordIds.has(`raw:witness:${value}`)) state.surfacedIds.add(`raw:witness:${value}`);
        if (state.recordIds.has(`raw:change:${changeMatch[1]}:${value}`)) state.surfacedIds.add(`raw:change:${changeMatch[1]}:${value}`);
      }
    }
    return;
  }
  const submissionId = typeof value.submissionId === "string"
    ? value.submissionId
    : typeof value.id === "string" && /^[0-9a-f-]{36}$/u.test(value.id)
      ? value.id
      : null;
  if (submissionId !== null) surfaceSubmissionReferences(state, submissionId, value.detailShard);
  const changeId = typeof value.changeId === "string"
    ? value.changeId
    : typeof value.witnessId === "string"
      ? value.witnessId
      : typeof value.id === "string" && value.id.includes("::m")
        ? value.id
        : null;
  if (changeId !== null) {
    if (state.recordIds.has(`raw:witness:${changeId}`)) state.surfacedIds.add(`raw:witness:${changeId}`);
    if (submissionId !== null && state.recordIds.has(`raw:change:${submissionId}:${changeId}`)) {
      state.surfacedIds.add(`raw:change:${submissionId}:${changeId}`);
    }
  }
  const ideaId = typeof value.ideaId === "string" ? value.ideaId : null;
  if (ideaId !== null) {
    for (const id of [`idea:${ideaId}`, `raw:idea:${ideaId}`, `raw:dossier:${ideaId}`]) {
      if (state.recordIds.has(id)) state.surfacedIds.add(id);
    }
  }
  for (const entry of Object.values(value)) surfaceBodyReferences(state, entry);
}

function targetMetadata(receipt) {
  return {
    ...receipt,
    flatAttemptIds: receipt.ideaIds.map((ideaId) => `attempt:${receipt.submissionId}:${receipt.changeId}:${ideaId}`),
  };
}

function createTraversalState(corpus, targets) {
  return {
    corpus,
    recordIds: new Set(corpus.records.map((record) => record.id)),
    targets,
    calls: [],
    returnedBytes: 0,
    surfacedIds: new Set(),
    surfacedCursors: new Set(),
    readIds: new Set(),
    pagedCursors: new Set(),
    searchedQueries: new Set(),
    derivedQueries: new Set(),
    searchCursorQueries: new Map(),
    searchPageCounts: new Map(),
    readResults: [],
    observedAttempts: new Map(),
    failures: [],
  };
}

function markObservedTargets(state) {
  for (const target of state.targets) {
    if (state.observedAttempts.has(receiptKey(target))) continue;
    const observedFlat = state.readResults
      .flatMap((result) => result.operation === "read" && result.kind === "flat_attempt" ? [result.body] : [])
      .concat(state.readResults.flatMap((result) => result.operation === "page" ? result.page?.items ?? [] : []))
      .some((candidate) => (
        candidate.submissionId === target.submissionId
        && candidate.changeId === target.changeId
        && candidate.status === target.status
        && candidate.outcome === target.outcome
        && arraysEqual(candidate.sourceRefs ?? [], target.sourceRefs)
      ));
    const rawRefs = new Set();
    let rawSubmission = null;
    let rawChange = null;
    for (const result of state.readResults) {
      const sourceRef = result.body?.sourceRef;
      if (typeof sourceRef === "string") rawRefs.add(sourceRef);
      if (result.kind === "raw_submission" && result.body?.id === target.submissionId) rawSubmission = result.body;
      if (result.kind === "raw_change" && result.body?.id === target.changeId) rawChange = result.body;
    }
    const observedRaw = target.sourceRefs.some((ref) => rawRefs.has(ref))
      && rawSubmission?.status === target.status
      && rawSubmission?.classification === target.outcome
      && rawChange?.id === target.changeId;
    if (observedFlat || observedRaw) state.observedAttempts.set(receiptKey(target), true);
  }
}

function recordStep(state, operation, argument, result) {
  const bytes = resultBytes(result);
  state.returnedBytes += bytes;
  state.calls.push({ operation, argument, bytes });
  state.readResults.push({ operation, argument, ...result });
  if (operation === "search") {
    state.searchedQueries.add(argument);
    for (const item of result.results ?? []) state.surfacedIds.add(item.id);
    if (typeof result.nextCursor === "string") {
      state.surfacedCursors.add(result.nextCursor);
      state.searchCursorQueries.set(result.nextCursor, argument);
    }
  }
  if (operation === "read") {
    state.readIds.add(argument);
    surfaceBodyReferences(state, result.body);
    if (result.kind === "raw_change") {
      const submissionId = result.body?.submissionId;
      const changeId = result.body?.id;
      if (typeof submissionId === "string") {
        state.surfacedIds.add(`raw:submission:${submissionId}`);
        state.surfacedIds.add(`raw:route:${submissionId}`);
        state.surfacedIds.add(`raw:detail:${submissionId}`);
      }
      if (typeof changeId === "string") state.surfacedIds.add(`raw:witness:${changeId}`);
    }
    if (result.kind === "raw_submission") {
      const submissionId = result.body?.id;
      if (typeof submissionId === "string") {
        state.surfacedIds.add(`raw:route:${submissionId}`);
        state.surfacedIds.add(`raw:detail:${submissionId}`);
      }
    }
    if (result.kind === "idea_direction" && typeof result.body?.attemptPageCursor === "string") {
      state.surfacedCursors.add(result.body.attemptPageCursor);
    }
    const idea = result.kind === "idea_direction" ? result.body?.idea : result.kind === "raw_idea" ? result.body : null;
    if (typeof idea?.title === "string" && typeof idea?.summary === "string") {
      state.derivedQueries.add(`${idea.title} ${idea.summary}`);
    }
  }
  if (operation === "page") {
    state.pagedCursors.add(argument);
    const nextCursor = result.page?.nextCursor;
    if (result.page?.kind === "search_results" && typeof result.page?.query === "string") {
      const query = result.page.query;
      state.searchPageCounts.set(query, (state.searchPageCounts.get(query) ?? 0) + 1);
      if (typeof nextCursor === "string") state.searchCursorQueries.set(nextCursor, query);
    }
    if (typeof nextCursor === "string") state.surfacedCursors.add(nextCursor);
    for (const item of result.page?.items ?? []) {
      if (typeof item?.id === "string") state.surfacedIds.add(item.id);
      const attemptId = deriveFlatAttemptId(item);
      if (attemptId !== null) state.surfacedIds.add(attemptId);
    }
  }
  markObservedTargets(state);
}

function performSearch(state, query) {
  const result = queryCorpus(state.corpus, "search", query);
  recordStep(state, "search", query, result);
  return result;
}

function performRead(state, id, { enforceReachability = true } = {}) {
  if (enforceReachability && !state.surfacedIds.has(id)) {
    state.failures.push(`read ${id} was not surfaced by search or deterministic derivation`);
    return { operation: "read", id, error: "unauthorized_read" };
  }
  const result = queryCorpus(state.corpus, "read", id);
  recordStep(state, "read", id, result);
  return result;
}

function performPage(state, cursor, { enforceReachability = true } = {}) {
  if (enforceReachability && !state.surfacedCursors.has(cursor)) {
    state.failures.push(`page ${cursor} was not surfaced by search or deterministic derivation`);
    return { operation: "page", cursor, error: "unauthorized_page" };
  }
  const result = queryCorpus(state.corpus, "page", cursor);
  recordStep(state, "page", cursor, result);
  return result;
}

function allTargetsRecovered(state) {
  return state.targets.every((target) => state.observedAttempts.get(receiptKey(target)) === true);
}

function cursorMatchesTarget(cursor, target) {
  return target.ideaIds.some((ideaId) => cursor.includes(ideaId) || cursor.includes(encodeURIComponent(ideaId)));
}

function nextAutomaticAction(state) {
  const remainingTargets = state.targets.filter((target) => !state.observedAttempts.get(receiptKey(target)));
  const candidates = [];
  for (const target of remainingTargets) {
    for (const attemptId of target.flatAttemptIds) {
      if (state.surfacedIds.has(attemptId) && !state.readIds.has(attemptId)) {
        candidates.push({ priority: 1, operation: "read", argument: attemptId });
      }
    }
    const rawChange = `raw:change:${target.submissionId}:${target.changeId}`;
    if (state.surfacedIds.has(rawChange) && !state.readIds.has(rawChange)) candidates.push({ priority: 2, operation: "read", argument: rawChange });
    const rawSubmission = `raw:submission:${target.submissionId}`;
    if (state.surfacedIds.has(rawSubmission) && !state.readIds.has(rawSubmission)) candidates.push({ priority: 3, operation: "read", argument: rawSubmission });
    const rawWitness = `raw:witness:${target.changeId}`;
    if (state.surfacedIds.has(rawWitness) && !state.readIds.has(rawWitness)) candidates.push({ priority: 4, operation: "read", argument: rawWitness });
    const rawRoute = `raw:route:${target.submissionId}`;
    if (state.surfacedIds.has(rawRoute) && !state.readIds.has(rawRoute)) candidates.push({ priority: 5, operation: "read", argument: rawRoute });
    for (const ideaId of target.ideaIds) {
      const ideaRecord = `idea:${ideaId}`;
      if (state.surfacedIds.has(ideaRecord) && !state.readIds.has(ideaRecord)) candidates.push({ priority: 7, operation: "read", argument: ideaRecord });
      const rawDossier = `raw:dossier:${ideaId}`;
      if (state.surfacedIds.has(rawDossier) && !state.readIds.has(rawDossier)) candidates.push({ priority: 8, operation: "read", argument: rawDossier });
      const rawIdea = `raw:idea:${ideaId}`;
      if (state.surfacedIds.has(rawIdea) && !state.readIds.has(rawIdea)) candidates.push({ priority: 8, operation: "read", argument: rawIdea });
    }
    for (const query of state.derivedQueries) {
      if (!state.searchedQueries.has(query)) candidates.push({ priority: 9, operation: "search", argument: query });
    }
    for (const cursor of state.surfacedCursors) {
      if (!state.pagedCursors.has(cursor) && cursorMatchesTarget(cursor, target)) {
        candidates.push({ priority: 8, operation: "page", argument: cursor });
      }
      if (!state.pagedCursors.has(cursor) && cursor.startsWith("search:")) {
        const query = state.searchCursorQueries.get(cursor);
        if (query !== undefined && (state.searchPageCounts.get(query) ?? 0) < 1) {
          candidates.push({ priority: 9, operation: "page", argument: cursor });
        }
      }
    }
    const rawDetail = `raw:detail:${target.submissionId}`;
    if (state.surfacedIds.has(rawDetail) && !state.readIds.has(rawDetail)) candidates.push({ priority: 11, operation: "read", argument: rawDetail });
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left.priority - right.priority || compareText(left.argument, right.argument));
  return candidates[0];
}

function finalizePathReport(state, { callLimit, byteLimit }) {
  if (state.calls.length > callLimit) state.failures.push(`path used ${state.calls.length} calls, limit ${callLimit}`);
  if (state.returnedBytes > byteLimit) state.failures.push(`path returned ${state.returnedBytes} bytes, limit ${byteLimit}`);
  const missingTargets = state.targets.filter((target) => !state.observedAttempts.get(receiptKey(target))).map((target) => receiptKey(target));
  if (missingTargets.length > 0) state.failures.push(`missing target receipts: ${missingTargets.join(", ")}`);
  return {
    status: state.failures.length === 0 ? "PASS" : "FAIL",
    calls: state.calls.length,
    returnedBytes: state.returnedBytes,
    failures: [...new Set(state.failures)],
    trace: state.calls,
    recoveredTargets: [...state.observedAttempts.keys()].sort(compareText),
  };
}

export function replayNaturalTrace(corpus, trace, targets, { callLimit = REACHABILITY_CALL_LIMIT, byteLimit = REACHABILITY_BYTE_LIMIT } = {}) {
  const state = createTraversalState(corpus, targets.map(targetMetadata));
  for (const step of trace) {
    if (step.operation === "search") performSearch(state, step.argument);
    else if (step.operation === "read") performRead(state, step.argument, { enforceReachability: true });
    else if (step.operation === "page") performPage(state, step.argument, { enforceReachability: true });
    else state.failures.push(`unsupported operation ${step.operation}`);
  }
  return finalizePathReport(state, { callLimit, byteLimit });
}

function autoRecoverTargets(corpus, targets, searchProbes, { callLimit, byteLimit }) {
  const state = createTraversalState(corpus, targets.map(targetMetadata));
  for (const query of searchProbes) performSearch(state, query);
  while (!allTargetsRecovered(state)) {
    const action = nextAutomaticAction(state);
    if (action === null) break;
    if (action.operation === "read") performRead(state, action.argument, { enforceReachability: true });
    else if (action.operation === "page") performPage(state, action.argument, { enforceReachability: true });
    else performSearch(state, action.argument);
    if (state.calls.length > callLimit || state.returnedBytes > byteLimit) break;
  }
  return finalizePathReport(state, { callLimit, byteLimit });
}

export function validateCaseRetrieval(candidate, evidenceIndex) {
  if (candidate.retrieval === undefined) {
    return { status: "PENDING", reason: "retrieval not reviewed yet" };
  }
  const retrieval = candidate.retrieval;
  if (retrieval === null || typeof retrieval !== "object" || Array.isArray(retrieval)) throw new Error(`case ${candidate.id} retrieval must be an object`);
  const searchProbes = normalizeStringArray(retrieval.searchProbes, `case ${candidate.id} retrieval.searchProbes`);
  if (searchProbes.length > MAX_SEARCH_PROBES_PER_CASE) {
    throw new Error(`case ${candidate.id} retrieval.searchProbes may contain at most ${MAX_SEARCH_PROBES_PER_CASE} probes`);
  }
  if (candidate.gold.classification === "prior_attempt") {
    if (retrieval.negativeNeighbors !== undefined && retrieval.negativeNeighbors.length !== 0) {
      throw new Error(`positive case ${candidate.id} must not define retrieval.negativeNeighbors`);
    }
    return {
      status: "READY",
      kind: "positive",
      searchProbes,
      targets: candidate.gold.acceptableMatches.map((receipt, index) => normalizeReceipt(receipt, evidenceIndex, `case ${candidate.id} gold.acceptableMatches[${index}]`)),
    };
  }
  if (!Array.isArray(retrieval.negativeNeighbors) || retrieval.negativeNeighbors.length !== REQUIRED_NEGATIVE_NEIGHBORS) {
    throw new Error(`negative case ${candidate.id} must define exactly ${REQUIRED_NEGATIVE_NEIGHBORS} retrieval.negativeNeighbors`);
  }
  return {
    status: "READY",
    kind: "negative",
    searchProbes,
    targets: retrieval.negativeNeighbors.map((receipt, index) => normalizeReceipt(receipt, evidenceIndex, `case ${candidate.id} retrieval.negativeNeighbors[${index}]`)),
  };
}

export function verifyCaseReachability(corpora, candidate, evidenceIndex, { callLimit = REACHABILITY_CALL_LIMIT, byteLimit = REACHABILITY_BYTE_LIMIT } = {}) {
  const retrieval = validateCaseRetrieval(candidate, evidenceIndex);
  if (retrieval.status === "PENDING") {
    return {
      caseId: candidate.id,
      directionBlockId: candidate.directionBlockId,
      status: "PENDING",
      reason: retrieval.reason,
    };
  }
  const conditionReports = Object.fromEntries(CONDITIONS.map((condition) => {
    if (retrieval.kind === "positive") {
      const targetReports = retrieval.targets.map((target) => autoRecoverTargets(corpora[condition], [target], retrieval.searchProbes, { callLimit, byteLimit }));
      return [condition, {
        status: targetReports.some((report) => report.status === "PASS") ? "PASS" : "FAIL",
        targets: targetReports,
        acceptableTargetRule: "at_least_one",
      }];
    }
    const shared = autoRecoverTargets(corpora[condition], retrieval.targets, retrieval.searchProbes, { callLimit, byteLimit });
    return [condition, { status: shared.status, sharedPath: shared }];
  }));
  const status = CONDITIONS.every((condition) => conditionReports[condition].status === "PASS") ? "PASS" : "FAIL";
  return {
    caseId: candidate.id,
    directionBlockId: candidate.directionBlockId,
    status,
    retrievalKind: retrieval.kind,
    searchProbes: retrieval.searchProbes,
    conditionReports,
  };
}

export function verifyAtlasFixtureReachability(corpora, cases, evidenceIndex, { callLimit = REACHABILITY_CALL_LIMIT, byteLimit = REACHABILITY_BYTE_LIMIT } = {}) {
  const orderedCases = [...cases].sort((left, right) => compareText(left.id, right.id));
  const caseReports = orderedCases.map((candidate) => verifyCaseReachability(corpora, candidate, evidenceIndex, { callLimit, byteLimit }));
  const readyCases = caseReports.filter((report) => report.status !== "PENDING");
  const failedCases = readyCases.filter((report) => report.status === "FAIL");
  const pendingCases = caseReports.filter((report) => report.status === "PENDING");
  return {
    schema: "yukon.atlas-reachability-report",
    schemaVersion: 1,
    status: failedCases.length > 0 || pendingCases.length > 0 ? "FAIL" : "PASS",
    callLimit,
    byteLimit,
    readyCases: readyCases.length,
    pendingCases: pendingCases.length,
    failedCases: failedCases.length,
    caseReports,
    corrections: [
      ...failedCases.map((report) => `reachability failed for ${report.caseId}`),
      ...pendingCases.map((report) => `reachability has not been reviewed for ${report.caseId}`),
    ],
  };
}
