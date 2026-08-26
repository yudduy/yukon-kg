#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { canonicalStringify } from "./protocol.js";
import { QUERY_BYTE_LIMIT, QUERY_CALL_LIMIT, writeCanonicalJson } from "./atlas-duplicate-protocol.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SEARCH_RESULT_LIMIT = 8;
const SEARCH_SNIPPET_BYTES = 120;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const CORPUS_INDEX_CACHE = new WeakMap();
const SEARCH_CURSOR_PREFIX = "search:";
const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "through", "to", "versus", "with", "without",
]);
const TECHNICAL_TOKEN_ROOTS = new Map([
  ["accumulation", "accumulate"],
  ["accumulator", "accumulate"],
  ["addition", "add"],
  ["comparator", "compare"],
  ["comparison", "compare"],
  ["controlled", "control"],
  ["multiplication", "multiply"],
  ["multiplier", "multiply"],
  ["subtraction", "subtract"],
  ["subtractor", "subtract"],
  ["termination", "terminate"],
  ["uncomputation", "uncompute"],
]);

function normalizeToken(token) {
  const technicalRoot = TECHNICAL_TOKEN_ROOTS.get(token);
  if (technicalRoot !== undefined) return technicalRoot;
  if (/^\d+$/u.test(token) || token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  if (token.endsWith("e") && token.length > 5) return token.slice(0, -1);
  return token;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !SEARCH_STOP_WORDS.has(token))
    .map(normalizeToken);
}

function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

function termFrequencies(documentTokens) {
  const frequencies = new Map();
  for (const token of documentTokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function corpusIndex(corpus) {
  const cached = CORPUS_INDEX_CACHE.get(corpus);
  if (cached !== undefined) return cached;
  const searchRecordIds = Array.isArray(corpus.searchRecordIds) ? new Set(corpus.searchRecordIds) : null;
  const documents = corpus.records.filter((record) => searchRecordIds === null || searchRecordIds.has(record.id)).map((record) => {
    const documentTokens = tokenize(`${record.label} ${record.searchText}`);
    return { record, documentTokens, frequencies: termFrequencies(documentTokens) };
  });
  const index = {
    documents,
    averageLength: documents.length === 0
      ? 0
      : documents.reduce((total, document) => total + document.documentTokens.length, 0) / documents.length,
  };
  CORPUS_INDEX_CACHE.set(corpus, index);
  return index;
}

function rankRecords(corpus, queryTokens) {
  const { documents, averageLength } = corpusIndex(corpus);
  const documentFrequencies = new Map(queryTokens.map((token) => [
    token,
    documents.reduce((total, document) => total + Number(document.frequencies.has(token)), 0),
  ]));
  return documents.map((document) => {
    let score = 0;
    let matchedTerms = 0;
    for (const token of queryTokens) {
      const termFrequency = document.frequencies.get(token) ?? 0;
      if (termFrequency === 0) continue;
      matchedTerms += 1;
      const documentFrequency = documentFrequencies.get(token) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + ((documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)));
      const lengthNormalization = averageLength === 0
        ? 1
        : 1 - BM25_B + (BM25_B * document.documentTokens.length / averageLength);
      score += inverseDocumentFrequency * (
        termFrequency * (BM25_K1 + 1)
        / (termFrequency + (BM25_K1 * lengthNormalization))
      );
    }
    return { record: document.record, score, matchedTerms };
  });
}

function snippet(record, queryTokens) {
  const text = `${record.label} ${record.searchText}`.replace(/\s+/gu, " ");
  const lower = text.toLowerCase();
  const offsets = queryTokens.map((token) => lower.indexOf(token)).filter((offset) => offset >= 0);
  const start = Math.max(0, (offsets.length === 0 ? 0 : Math.min(...offsets)) - 80);
  return text.slice(start, start + SEARCH_SNIPPET_BYTES);
}

function encodeSearchCursor(query, offset) {
  return `${SEARCH_CURSOR_PREFIX}${Buffer.from(JSON.stringify({ query, offset })).toString("base64url")}`;
}

function decodeSearchCursor(cursor) {
  if (!cursor.startsWith(SEARCH_CURSOR_PREFIX)) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor.slice(SEARCH_CURSOR_PREFIX.length), "base64url").toString("utf8"));
    if (typeof value.query !== "string" || !Number.isSafeInteger(value.offset) || value.offset < SEARCH_RESULT_LIMIT) return null;
    return value;
  } catch {
    return null;
  }
}

function searchCorpus(corpus, query, offset = 0) {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return { results: [], nextCursor: null };
  const ranked = rankRecords(corpus, queryTokens)
    .filter(({ matchedTerms }) => matchedTerms > 0)
    .sort((left, right) => (
      right.score - left.score
      || compareText(left.record.id, right.record.id)
    ));
  const concepts = ranked.filter(({ record }) => record.kind === "idea_direction" || record.kind === "raw_idea" || record.kind === "raw_dossier");
  const evidence = ranked.filter(({ record }) => record.kind !== "idea_direction" && record.kind !== "raw_idea" && record.kind !== "raw_dossier");
  const diversified = [];
  while (concepts.length > 0 || evidence.length > 0) {
    const selectedConcepts = concepts.splice(0, Math.min(2, concepts.length));
    diversified.push(...selectedConcepts);
    diversified.push(...evidence.splice(0, Math.min(SEARCH_RESULT_LIMIT - selectedConcepts.length, evidence.length)));
    while (diversified.length % SEARCH_RESULT_LIMIT !== 0 && (concepts.length > 0 || evidence.length > 0)) {
      diversified.push(...(evidence.length > 0 ? evidence.splice(0, 1) : concepts.splice(0, 1)));
    }
  }
  const results = diversified
    .slice(offset, offset + SEARCH_RESULT_LIMIT)
    .map(({ record, matchedTerms }) => ({ id: record.id, kind: record.kind, label: record.label, matchedTerms, snippet: snippet(record, queryTokens) }));
  return {
    results,
    nextCursor: offset + SEARCH_RESULT_LIMIT < diversified.length
      ? encodeSearchCursor(query, offset + SEARCH_RESULT_LIMIT)
      : null,
  };
}

export function queryCorpus(corpus, operation, argument) {
  if (operation === "search") {
    const page = searchCorpus(corpus, argument);
    return { operation, query: argument, ...page };
  }
  if (operation === "read") {
    const record = corpus.records.find((candidate) => candidate.id === argument);
    return record === undefined
      ? { operation, id: argument, error: "record_not_found" }
      : { operation, id: argument, kind: record.kind, label: record.label, body: record.body };
  }
  if (operation === "page") {
    const searchCursor = decodeSearchCursor(argument);
    if (searchCursor !== null) {
      const page = searchCorpus(corpus, searchCursor.query, searchCursor.offset);
      return {
        operation,
        cursor: argument,
        page: { kind: "search_results", query: searchCursor.query, items: page.results, nextCursor: page.nextCursor },
      };
    }
    const page = corpus.pages?.[argument];
    return page === undefined
      ? { operation, cursor: argument, error: "page_not_found" }
      : { operation, cursor: argument, page };
  }
  return { operation, error: "unknown_operation" };
}

function boundedOutput(result, state) {
  const candidate = `${canonicalStringify(result)}\n`;
  const candidateBytes = Buffer.byteLength(candidate);
  if (state.returnedBytes + candidateBytes <= state.byteLimit) return { output: candidate, bytes: candidateBytes };
  const remainingBytes = Math.max(0, state.byteLimit - state.returnedBytes);
  const fallback = `${canonicalStringify({ error: "returned_byte_budget_exceeded", remainingBytes })}\n`;
  const fallbackBytes = Buffer.byteLength(fallback);
  return fallbackBytes <= remainingBytes
    ? { output: fallback, bytes: fallbackBytes }
    : { output: "", bytes: 0 };
}

export async function executeQuery({ corpusPath, statePath, operation, argument }) {
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) {
        throw new Error(`could not acquire Atlas query budget lock: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    const corpus = JSON.parse(await fs.readFile(corpusPath, "utf8"));
    let state;
    try {
      state = JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = { calls: 0, returnedBytes: 0, callLimit: QUERY_CALL_LIMIT, byteLimit: QUERY_BYTE_LIMIT, history: [] };
    }
    state.calls += 1;
    let result;
    if (state.calls > state.callLimit) result = { error: "query_call_budget_exceeded", callLimit: state.callLimit };
    else result = queryCorpus(corpus, operation, argument);
    const bounded = boundedOutput(result, state);
    state.returnedBytes += bounded.bytes;
    state.history.push({ call: state.calls, operation, argument, returnedBytes: bounded.bytes });
    await writeCanonicalJson(statePath, state);
    return { ...bounded, state };
  } finally {
    try {
      await fs.rmdir(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const [operation, ...argumentParts] = argv;
  const corpusPath = process.env.ATLAS_QUERY_CORPUS;
  const statePath = process.env.ATLAS_QUERY_STATE;
  if (!corpusPath || !statePath) throw new Error("ATLAS_QUERY_CORPUS and ATLAS_QUERY_STATE must be set by the sealed launcher");
  if (!operation || !["search", "read", "page"].includes(operation) || argumentParts.length !== 1) {
    throw new Error("usage: atlas-query search|read|page <one argument>");
  }
  const result = await executeQuery({
    corpusPath: path.resolve(corpusPath),
    statePath: path.resolve(statePath),
    operation,
    argument: argumentParts[0],
  });
  process.stdout.write(result.output);
  if (result.state.calls > result.state.callLimit) process.exitCode = 2;
}

if (import.meta.main) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
