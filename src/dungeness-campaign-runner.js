import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { chatCompletion, pinnedOpenRouterModel } from "./openrouter.js";
import { runProcess } from "./mve.js";
import {
  appendSignedEvidenceReceipt,
  createEvidenceLedger,
  createEvidenceSigningKeyPair,
  ledgerSha256,
  reduceEvidenceLedger,
  serializeEvidenceLedger,
} from "./atlas-runtime/evidence-ledger.ts";
import { normalizedGain, sha256 } from "./dungeness-adaptive-protocol.js";

const MAX_READ_BYTES = 32 * 1024;
const MAX_WRITE_BYTES = 64 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 32 * 1024;

export const CAMPAIGN_TOOLS = Object.freeze([
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List repository files below an optional relative directory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 repository file. Paths are relative to the campaign worktree.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", minLength: 1 },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Search UTF-8 repository files with a regular expression.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["pattern"],
        properties: {
          pattern: { type: "string", minLength: 1 },
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write one UTF-8 file. Only the adapter's mutable source surface is allowed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate",
      description: "Run the pinned development evaluator and append a trusted receipt.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId"],
        properties: {
          proposalId: { type: "string", minLength: 1 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_receipts",
      description: "Read the append-only trusted evaluator receipts available to both experiment arms.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_adaptive_state",
      description: "Read the deterministic compact projection. Available only to the adaptive-state arm.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "write_procedure",
      description: "Store a session-local execution procedure. Available only in adaptive-procedure cells; cannot write evidence facts.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_procedures",
      description: "Read session-local execution procedures.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Stop the campaign when no further useful evaluator call remains.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: { summary: { type: "string" } },
      },
    },
  },
]);

function clipToolOutput(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") <= MAX_TOOL_OUTPUT_BYTES) return text;
  return JSON.stringify({
    truncated: true,
    bytes: Buffer.byteLength(text, "utf8"),
    prefix: Buffer.from(text).subarray(0, MAX_TOOL_OUTPUT_BYTES - 128).toString("utf8"),
  });
}

function safeRelative(value = "") {
  if (typeof value !== "string") throw new Error("path must be a string");
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("path escapes the campaign worktree");
  }
  if (normalized === ".git" || normalized.startsWith(".git/")) throw new Error(".git is not readable");
  return normalized === "." ? "" : normalized;
}

function absolutePath(root, relative) {
  const resolved = path.resolve(root, safeRelative(relative));
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootPrefix)) {
    throw new Error("path escapes the campaign worktree");
  }
  return resolved;
}

function mutablePrefixes(adapter) {
  return adapter.mutableGlobs.map((glob) => glob.replace(/\*.*$/u, ""));
}

function requireMutablePath(adapter, relative) {
  const normalized = safeRelative(relative);
  if (!mutablePrefixes(adapter).some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`path ${normalized} is outside the mutable source surface`);
  }
  return normalized;
}

async function listFiles(root, relative = "") {
  const start = absolutePath(root, relative);
  const output = [];
  async function walk(directory, prefix) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", "target", "node_modules"].includes(entry.name)) continue;
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(child, childPrefix);
      else if (entry.isFile()) output.push(childPrefix);
      if (output.length >= 2000) return;
    }
  }
  await walk(start, safeRelative(relative));
  return output;
}

async function mutableSourceDigest(root, adapter) {
  const hash = createHash("sha256");
  const all = await listFiles(root);
  const mutable = all.filter((relative) => mutablePrefixes(adapter).some((prefix) => relative.startsWith(prefix)));
  for (const relative of mutable.sort()) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(absolutePath(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function snapshotMutableSource(root, destination, adapter) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  for (const prefix of mutablePrefixes(adapter)) {
    const source = absolutePath(root, prefix);
    const target = path.join(destination, prefix);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(source, target, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function restoreMutableSnapshot(snapshot, worktree, adapter) {
  for (const prefix of mutablePrefixes(adapter)) {
    const source = path.join(snapshot, prefix);
    const target = absolutePath(worktree, prefix);
    await fs.rm(target, { recursive: true, force: true });
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(source, target, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function substituteCommand(command, values) {
  return command.map((part) => part.replace(/\{([a-zA-Z]+)\}/gu, (_match, key) => {
    if (!(key in values)) throw new Error(`unknown evaluator command placeholder {${key}}`);
    return values[key];
  }));
}

function failedQualification() {
  return {
    classicalOutput: "not_run",
    ancillae: "not_run",
    globalPhase: "not_run",
    reverseExecution: "not_run",
  };
}

export function parseDungenessEvaluation(processResult) {
  if (processResult.exitCode !== 0) {
    return { score: null, qualification: failedQualification(), valid: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(processResult.stdout);
  } catch {
    throw new Error("Dungeness evaluator stdout must be one JSON object");
  }
  if (parsed?.schema !== "yukon-kg.dungeness-evaluation.v1") {
    throw new Error("Dungeness evaluator returned the wrong schema");
  }
  const dimensions = ["classicalOutput", "ancillae", "globalPhase", "reverseExecution"];
  const qualification = {};
  for (const dimension of dimensions) {
    const status = parsed?.qualification?.[dimension];
    if (!["passed", "failed", "not_run"].includes(status)) {
      throw new Error(`Dungeness evaluator omitted qualification.${dimension}`);
    }
    qualification[dimension] = status;
  }
  const valid = dimensions.every((dimension) => qualification[dimension] === "passed");
  const score = Number.isFinite(parsed.score) ? parsed.score : null;
  if (valid && (score === null || score <= 0)) throw new Error("valid Dungeness evaluation requires a positive score");
  return { score, qualification, valid };
}

async function trackedChangesOutsideMutable(worktree, adapter) {
  const status = await runProcess("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: worktree });
  if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr}`);
  return status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3)).filter((relative) => (
    !mutablePrefixes(adapter).some((prefix) => relative.startsWith(prefix))
  ));
}

async function runEvaluator({ worktree, adapter, checkpoint, panel, runProcessFn = runProcess }) {
  const commandTemplate = panel === "hidden"
    ? adapter.evaluator.hiddenCommand
    : adapter.evaluator.developmentCommand;
  const command = substituteCommand(commandTemplate, {
    worktree,
    checkpointId: checkpoint.id,
    panel,
  });
  const result = await runProcessFn(command[0], command.slice(1), {
    cwd: worktree,
    timeoutMs: adapter.evaluator.timeoutMs,
    unsetEnv: ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "YUDDUY_GITHUB_TOKEN"],
  });
  return { process: result, evaluation: parseDungenessEvaluation(result), command };
}

async function appendLedgerFile(pathname, ledger) {
  const temporary = `${pathname}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(temporary, serializeEvidenceLedger(ledger), { mode: 0o600 });
  await fs.rename(temporary, pathname);
}

function commandReceipt(result) {
  return {
    argv: [result.command[0], ...result.command.slice(1)],
    exitCode: result.process.exitCode,
    stdoutSha256: sha256(result.process.stdout),
    stderrSha256: sha256(result.process.stderr),
  };
}

function campaignTools(arm, procedureMode) {
  return CAMPAIGN_TOOLS.filter((tool) => {
    if (tool.function.name === "read_adaptive_state") return arm === "state_adaptive";
    if (tool.function.name === "write_procedure") return procedureMode === "adaptive_procedures";
    return true;
  });
}

function campaignSystemPrompt({ briefText, assignment, budget }) {
  return [
    "Optimize the pinned ECDSA circuit using only the provided repository tools.",
    "The evaluator, harness, Cargo manifest, and files outside src/point_add/ are immutable.",
    "Do not use nonce grinding, identity padding, or operation-stream changes that only alter the sampled workload.",
    "Use one focused code change at a time and call evaluate for objective feedback.",
    "Evaluator receipts, not your prose, determine trusted state.",
    `Campaign arm: ${assignment.arm}. Procedure mode: ${assignment.procedureMode}.`,
    `Hard limits: ${budget.turns} turns, ${budget.rootTokens} root tokens, ${budget.evaluatorCalls} evaluator calls, $${budget.costUsd}.`,
    `Initial neutral state brief:\n${briefText}`,
  ].join("\n\n");
}

function parseToolArguments(toolCall) {
  try {
    const value = JSON.parse(toolCall?.function?.arguments ?? "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments are not an object");
    return value;
  } catch (error) {
    throw new Error(`invalid ${toolCall?.function?.name ?? "unknown"} arguments: ${error.message}`);
  }
}

async function executeTool(name, args, state) {
  if (name === "list_files") {
    return { files: await listFiles(state.worktree, args.path ?? "") };
  }
  if (name === "read_file") {
    const contents = await fs.readFile(absolutePath(state.worktree, args.path), "utf8");
    if (Buffer.byteLength(contents, "utf8") > MAX_READ_BYTES) {
      throw new Error(`file exceeds ${MAX_READ_BYTES} readable bytes`);
    }
    const lines = contents.split("\n");
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 300;
    return { path: safeRelative(args.path), offset, lines: lines.slice(offset, offset + limit) };
  }
  if (name === "search") {
    const expression = new RegExp(args.pattern, "iu");
    const files = await listFiles(state.worktree, args.path ?? "");
    const matches = [];
    for (const relative of files) {
      let contents;
      try {
        contents = await fs.readFile(absolutePath(state.worktree, relative), "utf8");
      } catch {
        continue;
      }
      for (const [index, line] of contents.split("\n").entries()) {
        if (expression.test(line)) matches.push({ path: relative, line: index + 1, text: line.slice(0, 500) });
        if (matches.length >= 200) return { matches, truncated: true };
      }
    }
    return { matches, truncated: false };
  }
  if (name === "write_file") {
    const relative = requireMutablePath(state.adapter, args.path);
    if (Buffer.byteLength(args.content ?? "", "utf8") > MAX_WRITE_BYTES) {
      throw new Error(`write exceeds ${MAX_WRITE_BYTES} bytes`);
    }
    const pathname = absolutePath(state.worktree, relative);
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await fs.writeFile(pathname, args.content);
    return { path: relative, sha256: sha256(args.content), bytes: Buffer.byteLength(args.content, "utf8") };
  }
  if (name === "read_receipts") {
    return {
      header: state.ledger.header,
      receipts: state.ledger.receipts.map((receipt) => ({
        proposalId: receipt.proposalId,
        sequence: receipt.sequence,
        artifactSha256: receipt.artifactSha256,
        qualification: receipt.qualification,
        score: receipt.score,
        receiptSha256: receipt.receiptSha256,
      })),
    };
  }
  if (name === "read_adaptive_state") {
    if (state.assignment.arm !== "state_adaptive") throw new Error("adaptive projection is unavailable in this arm");
    return { projection: reduceEvidenceLedger(state.ledger) };
  }
  if (name === "write_procedure") {
    if (state.assignment.procedureMode !== "adaptive_procedures") {
      throw new Error("procedure refinement is unavailable in this cell");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(args.id ?? "")) throw new Error("invalid procedure id");
    if (typeof args.text !== "string" || args.text.length === 0 || args.text.length > 4000) {
      throw new Error("procedure text must contain 1 to 4000 characters");
    }
    state.procedures.set(args.id, {
      id: args.id,
      text: args.text,
      version: (state.procedures.get(args.id)?.version ?? 0) + 1,
      trust: "untrusted_procedure",
    });
    return state.procedures.get(args.id);
  }
  if (name === "read_procedures") return { procedures: [...state.procedures.values()] };
  if (name === "finish") {
    state.finished = true;
    state.summary = typeof args.summary === "string" ? args.summary : "";
    return { finished: true };
  }
  if (name === "evaluate") {
    if (state.evaluatorCalls >= state.budget.evaluatorCalls) throw new Error("evaluator call budget exhausted");
    const outside = await trackedChangesOutsideMutable(state.worktree, state.adapter);
    if (outside.length > 0) {
      state.provenanceViolations.push(`files outside mutable surface changed: ${outside.join(", ")}`);
      throw new Error(state.provenanceViolations.at(-1));
    }
    const artifactSha256 = await mutableSourceDigest(state.worktree, state.adapter);
    const evaluated = await runEvaluator({
      worktree: state.worktree,
      adapter: state.adapter,
      checkpoint: state.checkpoint,
      panel: "development",
      runProcessFn: state.runProcessFn,
    });
    state.evaluatorCalls += 1;
    const proposalId = args.proposalId;
    state.ledger = appendSignedEvidenceReceipt(state.ledger, {
      createdAt: new Date().toISOString(),
      phase: "evaluation",
      proposalId,
      matcher: {
        matcherId: "matcher:exact-artifact",
        matcherVersion: "1",
        ideaId: null,
        membership: "matched",
      },
      baseCommitSha: state.checkpoint.gitRef,
      artifactSha256,
      protocolSha256: state.protocol.protocolSha256,
      evaluatorSha256: state.protocol.dungeness.adapterSha256,
      panelSha256: state.checkpoint.developmentPanelSha256,
      command: commandReceipt(evaluated),
      qualification: evaluated.evaluation.qualification,
      baselineScore: state.checkpoint.baselineScore,
      score: evaluated.evaluation.score,
      executor: {
        executorId: "host:dungeness-development",
        independenceKey: `${state.assignment.campaignId}:development`,
        authority: "pinned_evaluator",
      },
      budget: {
        rootTokens: state.rootTokens,
        descendantTokens: 0,
        costUsd: state.costUsd,
        evaluatorCalls: state.evaluatorCalls,
      },
    }, state.privateKeyPem);
    await appendLedgerFile(state.ledgerPath, state.ledger);
    const candidateDirectory = path.join(state.candidatesRoot, String(state.evaluatorCalls).padStart(3, "0"));
    await snapshotMutableSource(state.worktree, candidateDirectory, state.adapter);
    state.candidates.push({
      proposalId,
      artifactSha256,
      snapshot: candidateDirectory,
      development: evaluated.evaluation,
      developmentReceiptSha256: state.ledger.receipts.at(-1).receiptSha256,
    });
    return {
      receipt: state.ledger.receipts.at(-1),
      ...(state.assignment.arm === "state_adaptive"
        ? { adaptiveProjection: reduceEvidenceLedger(state.ledger) }
        : {}),
    };
  }
  throw new Error(`unknown tool ${name}`);
}

async function addWorktree(repo, destination, gitRef, runProcessFn = runProcess) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const result = await runProcessFn("git", ["worktree", "add", "--detach", destination, gitRef], {
    cwd: repo,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) throw new Error(`could not create campaign worktree: ${result.stderr || result.stdout}`);
}

async function removeWorktree(repo, destination, runProcessFn = runProcess) {
  const result = await runProcessFn("git", ["worktree", "remove", "--force", destination], {
    cwd: repo,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) await fs.rm(destination, { recursive: true, force: true });
}

async function hiddenAdjudication({
  state,
  dungenessRepo,
  adjudicationRoot,
}) {
  const rows = [];
  for (const [index, candidate] of state.candidates.entries()) {
    if (!candidate.development.valid) continue;
    const worktree = path.join(adjudicationRoot, `candidate-${String(index + 1).padStart(3, "0")}`);
    await addWorktree(dungenessRepo, worktree, state.checkpoint.gitRef, state.runProcessFn);
    try {
      await restoreMutableSnapshot(candidate.snapshot, worktree, state.adapter);
      const evaluated = await runEvaluator({
        worktree,
        adapter: state.adapter,
        checkpoint: state.checkpoint,
        panel: "hidden",
        runProcessFn: state.runProcessFn,
      });
      rows.push({
        proposalId: candidate.proposalId,
        artifactSha256: candidate.artifactSha256,
        score: evaluated.evaluation.score,
        qualification: evaluated.evaluation.qualification,
        valid: evaluated.evaluation.valid,
        stdoutSha256: sha256(evaluated.process.stdout),
        stderrSha256: sha256(evaluated.process.stderr),
      });
    } finally {
      await removeWorktree(dungenessRepo, worktree, state.runProcessFn);
    }
  }
  return rows;
}

export async function runDungenessCampaign({
  assignment,
  protocol,
  adapter,
  checkpoint,
  briefText,
  dungenessRepo,
  runRoot,
  completionFn = chatCompletion,
  runProcessFn = runProcess,
}) {
  const campaignRoot = path.join(runRoot, assignment.campaignId.replaceAll(":", "_"));
  const worktree = path.join(campaignRoot, "worktree");
  const signing = createEvidenceSigningKeyPair();
  const ledger = createEvidenceLedger({
    campaignId: assignment.campaignId,
    createdAt: new Date().toISOString(),
    direction: "-",
    baseCommitSha: checkpoint.gitRef,
    protocolSha256: protocol.protocolSha256,
    evaluatorSha256: protocol.dungeness.adapterSha256,
    panelSha256: checkpoint.developmentPanelSha256,
    signer: signing.signer,
  });
  await addWorktree(dungenessRepo, worktree, checkpoint.gitRef, runProcessFn);
  const state = {
    assignment,
    protocol,
    adapter,
    checkpoint,
    budget: protocol.budget,
    worktree,
    ledger,
    privateKeyPem: signing.privateKeyPem,
    ledgerPath: path.join(campaignRoot, "ledger.jsonl"),
    candidatesRoot: path.join(campaignRoot, "candidates"),
    candidates: [],
    procedures: new Map(),
    rootTokens: 0,
    costUsd: 0,
    evaluatorCalls: 0,
    provenanceViolations: [],
    finished: false,
    summary: "",
    runProcessFn,
  };
  await appendLedgerFile(state.ledgerPath, state.ledger);
  const messages = [{
    role: "system",
    content: campaignSystemPrompt({ briefText, assignment, budget: protocol.budget }),
  }];
  const fingerprints = new Set();
  const providers = new Set();
  try {
    if (adapter.setupCommand !== null) {
      const setup = await runProcessFn(adapter.setupCommand[0], adapter.setupCommand.slice(1), {
        cwd: worktree,
        timeoutMs: adapter.evaluator.timeoutMs,
        unsetEnv: ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "YUDDUY_GITHUB_TOKEN"],
      });
      if (setup.exitCode !== 0) throw new Error(`Dungeness setup failed: ${setup.stderr || setup.stdout}`);
    }
    for (let turn = 0; turn < protocol.budget.turns && !state.finished; turn += 1) {
      if (state.rootTokens >= protocol.budget.rootTokens || state.costUsd >= protocol.budget.costUsd) break;
      const completion = await completionFn({
        model: protocol.model.id || pinnedOpenRouterModel(),
        provider: {
          order: [protocol.model.provider],
          allow_fallbacks: false,
          require_parameters: true,
        },
        temperature: protocol.model.decoding.temperature,
        maxTokens: protocol.model.decoding.maxTokens,
        seed: assignment.seed + turn,
        tools: campaignTools(assignment.arm, assignment.procedureMode),
        toolChoice: "auto",
        messages,
      });
      state.rootTokens += completion.usage?.total_tokens ?? 0;
      state.costUsd += completion.usage?.cost ?? 0;
      if (completion.provider) providers.add(completion.provider);
      if (completion.systemFingerprint) fingerprints.add(completion.systemFingerprint);
      messages.push({
        role: "assistant",
        content: completion.content || null,
        ...(completion.toolCalls.length > 0 ? { tool_calls: completion.toolCalls } : {}),
      });
      if (completion.toolCalls.length === 0) {
        state.finished = true;
        state.summary = completion.content;
        break;
      }
      for (const toolCall of completion.toolCalls) {
        let output;
        try {
          output = await executeTool(toolCall.function.name, parseToolArguments(toolCall), state);
        } catch (error) {
          output = { error: error.message };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: clipToolOutput(output),
        });
      }
    }
    const hidden = await hiddenAdjudication({
      state,
      dungenessRepo,
      adjudicationRoot: path.join(campaignRoot, "adjudication"),
    });
    const validScores = hidden.filter((row) => row.valid && Number.isFinite(row.score)).map((row) => row.score);
    const bestValidScore = validScores.length > 0
      ? Math.min(checkpoint.baselineScore, ...validScores)
      : checkpoint.baselineScore;
    const result = {
      schema: "yukon-kg.dungeness-campaign.v1",
      protocolVersion: protocol.protocolVersion,
      protocolSha256: protocol.protocolSha256,
      campaignId: assignment.campaignId,
      pairId: assignment.pairId,
      checkpointId: assignment.checkpointId,
      arm: assignment.arm,
      procedureMode: assignment.procedureMode,
      seed: assignment.seed,
      baselineScore: checkpoint.baselineScore,
      bestValidScore,
      normalizedGain: normalizedGain(checkpoint.baselineScore, bestValidScore),
      invalidRate: state.candidates.length === 0
        ? 0
        : state.candidates.filter((candidate) => !candidate.development.valid).length / state.candidates.length,
      candidateCount: state.candidates.length,
      evaluatorCalls: state.evaluatorCalls,
      rootTokens: state.rootTokens,
      costUsd: state.costUsd,
      provenanceViolations: state.provenanceViolations,
      ledgerSha256: ledgerSha256(serializeEvidenceLedger(state.ledger)),
      providerRoutes: [...providers].sort(),
      systemFingerprints: [...fingerprints].sort(),
      finished: state.finished,
      summary: state.summary,
      hiddenAdjudication: hidden,
    };
    await fs.writeFile(path.join(campaignRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await removeWorktree(dungenessRepo, worktree, runProcessFn);
  }
}
