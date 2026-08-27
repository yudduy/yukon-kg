import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { canonicalStringify } from "../protocol.js";

export const EVIDENCE_LEDGER_SCHEMA = "yukon.evaluator-evidence-ledger";
export const EVIDENCE_LEDGER_SCHEMA_VERSION = 1 as const;

export type OptimizationDirection = "-" | "+";
export type EvidencePhase = "proposal" | "build" | "evaluation";
export type MatcherMembership = "matched" | "not_matched" | "unknown";
export type QualificationStatus = "passed" | "failed" | "not_run";
export type TrustedEvidenceState =
  | "proposal_only"
  | "built_not_evaluated"
  | "evaluated_invalid"
  | "evaluated_valid_nonimproving"
  | "evaluated_valid_improving"
  | "independently_reproduced";

export interface EvidenceLedgerSigner {
  algorithm: "ed25519";
  publicKeyPem: string;
  publicKeySha256: string;
}

export interface EvidenceLedgerHeader {
  schema: typeof EVIDENCE_LEDGER_SCHEMA;
  schemaVersion: typeof EVIDENCE_LEDGER_SCHEMA_VERSION;
  campaignId: string;
  createdAt: string;
  direction: OptimizationDirection;
  baseCommitSha: string;
  protocolSha256: string;
  evaluatorSha256: string;
  panelSha256s: string[];
  signer: EvidenceLedgerSigner;
  headerSha256: string;
}

export interface EvidenceMatcherReceipt {
  matcherId: string;
  matcherVersion: string;
  ideaId: string | null;
  membership: MatcherMembership;
}

export interface EvidenceCommandReceipt {
  argv: string[];
  exitCode: number | null;
  stdoutSha256: string;
  stderrSha256: string;
}

export interface EvidenceQualification {
  classicalOutput: QualificationStatus;
  ancillae: QualificationStatus;
  globalPhase: QualificationStatus;
  reverseExecution: QualificationStatus;
}

export interface EvidenceExecutor {
  executorId: string;
  independenceKey: string;
  authority: "pinned_evaluator";
}

export interface EvidenceBudget {
  rootTokens: number;
  descendantTokens: number;
  costUsd: number;
  evaluatorCalls: number;
}

export interface EvidenceReceiptInput {
  createdAt: string;
  phase: EvidencePhase;
  proposalId: string;
  matcher: EvidenceMatcherReceipt;
  baseCommitSha: string;
  artifactSha256: string | null;
  protocolSha256: string;
  evaluatorSha256: string;
  panelSha256: string;
  command: EvidenceCommandReceipt | null;
  qualification: EvidenceQualification | null;
  baselineScore: number | null;
  score: number | null;
  executor: EvidenceExecutor;
  budget: EvidenceBudget;
}

export interface SignedEvidenceReceipt extends EvidenceReceiptInput {
  sequence: number;
  parentReceiptSha256: string;
  receiptSha256: string;
  signature: {
    algorithm: "ed25519";
    publicKeySha256: string;
    value: string;
  };
}

export interface EvidenceLedger {
  header: EvidenceLedgerHeader;
  receipts: SignedEvidenceReceipt[];
}

export interface EvidenceProjectionRow {
  proposalId: string;
  ideaId: string | null;
  matcherId: string;
  matcherVersion: string;
  membership: MatcherMembership;
  state: TrustedEvidenceState;
  artifactSha256: string | null;
  baselineScore: number | null;
  bestScore: number | null;
  receiptSha256s: string[];
  independentReproductions: number;
}

export interface UntrustedEvidenceAnnotation {
  proposalId: string;
  createdAt: string;
  author: string;
  text: string;
  trust: "untrusted_model_annotation";
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const PROPOSAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function canonicalLedgerStringify(value: unknown): string {
  return canonicalStringify(value);
}

export function ledgerSha256(value: unknown): string {
  return createHash("sha256").update(
    typeof value === "string" ? value : canonicalLedgerStringify(value),
  ).digest("hex");
}

function requireNonempty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireSha256(value: string, name: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256`);
}

function requireCommit(value: string, name: string): void {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${name} must be a lowercase Git commit hash`);
}

function requireNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}

function unsignedHeader(header: EvidenceLedgerHeader): Omit<EvidenceLedgerHeader, "headerSha256"> {
  const { headerSha256: _headerSha256, ...unsigned } = header;
  return unsigned;
}

function unsignedReceipt(
  receipt: SignedEvidenceReceipt,
): Omit<SignedEvidenceReceipt, "receiptSha256" | "signature"> {
  const {
    receiptSha256: _receiptSha256,
    signature: _signature,
    ...unsigned
  } = receipt;
  return unsigned;
}

function validateInput(input: EvidenceReceiptInput, header: EvidenceLedgerHeader): void {
  requireNonempty(input.proposalId, "proposalId");
  if (!PROPOSAL_ID_PATTERN.test(input.proposalId)) {
    throw new Error("proposalId must use lowercase letters, numbers, and hyphens");
  }
  requireNonempty(input.createdAt, "createdAt");
  if (!["proposal", "build", "evaluation"].includes(input.phase)) {
    throw new Error(`unsupported evidence phase ${input.phase}`);
  }
  requireNonempty(input.matcher.matcherId, "matcher.matcherId");
  requireNonempty(input.matcher.matcherVersion, "matcher.matcherVersion");
  if (!["matched", "not_matched", "unknown"].includes(input.matcher.membership)) {
    throw new Error(`unsupported matcher membership ${input.matcher.membership}`);
  }
  requireNonempty(input.executor.executorId, "executor.executorId");
  requireNonempty(input.executor.independenceKey, "executor.independenceKey");
  requireCommit(input.baseCommitSha, "baseCommitSha");
  requireSha256(input.protocolSha256, "protocolSha256");
  requireSha256(input.evaluatorSha256, "evaluatorSha256");
  requireSha256(input.panelSha256, "panelSha256");
  if (input.artifactSha256 !== null) requireSha256(input.artifactSha256, "artifactSha256");
  if (
    input.baseCommitSha !== header.baseCommitSha
    || input.protocolSha256 !== header.protocolSha256
    || input.evaluatorSha256 !== header.evaluatorSha256
    || !header.panelSha256s.includes(input.panelSha256)
  ) {
    throw new Error("receipt pins differ from the ledger header");
  }
  if (input.baselineScore !== null && !Number.isFinite(input.baselineScore)) {
    throw new Error("baselineScore must be finite or null");
  }
  if (input.score !== null && !Number.isFinite(input.score)) {
    throw new Error("score must be finite or null");
  }
  requireNonnegative(input.budget.rootTokens, "budget.rootTokens");
  requireNonnegative(input.budget.descendantTokens, "budget.descendantTokens");
  requireNonnegative(input.budget.costUsd, "budget.costUsd");
  requireNonnegative(input.budget.evaluatorCalls, "budget.evaluatorCalls");
  if (input.command !== null) {
    if (!Array.isArray(input.command.argv) || input.command.argv.length === 0) {
      throw new Error("command.argv must be non-empty");
    }
    requireSha256(input.command.stdoutSha256, "command.stdoutSha256");
    requireSha256(input.command.stderrSha256, "command.stderrSha256");
  }
  if (input.phase === "proposal") {
    if (input.artifactSha256 !== null || input.command !== null || input.qualification !== null || input.score !== null) {
      throw new Error("proposal receipts cannot claim build or evaluation evidence");
    }
  }
  if (input.phase === "build") {
    if (input.command === null) throw new Error("build receipts require a command receipt");
    if (input.command.exitCode === 0 && input.artifactSha256 === null) {
      throw new Error("successful builds require an artifact hash");
    }
    if (input.qualification !== null || input.score !== null) {
      throw new Error("build receipts cannot claim evaluation evidence");
    }
  }
  if (input.phase === "evaluation") {
    if (input.command === null || input.artifactSha256 === null || input.qualification === null) {
      throw new Error("evaluation receipts require command, artifact, and qualification evidence");
    }
    if (input.baselineScore === null) throw new Error("evaluation receipts require a baseline score");
    const valid = Object.values(input.qualification).every((status) => status === "passed");
    if (Object.values(input.qualification).some((status) => !["passed", "failed", "not_run"].includes(status))) {
      throw new Error("evaluation qualification contains an unsupported status");
    }
    if (valid && input.score === null) throw new Error("valid evaluations require a score");
  }
}

export function createEvidenceSigningKeyPair(): {
  privateKeyPem: string;
  signer: EvidenceLedgerSigner;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    signer: {
      algorithm: "ed25519",
      publicKeyPem,
      publicKeySha256: ledgerSha256(publicKeyPem),
    },
  };
}

export function evidenceSignerFromPrivateKey(privateKeyPem: string): EvidenceLedgerSigner {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return {
    algorithm: "ed25519",
    publicKeyPem,
    publicKeySha256: ledgerSha256(publicKeyPem),
  };
}

export function createEvidenceLedger(input: {
  campaignId: string;
  createdAt: string;
  direction: OptimizationDirection;
  baseCommitSha: string;
  protocolSha256: string;
  evaluatorSha256: string;
  panelSha256s: string[];
  signer: EvidenceLedgerSigner;
}): EvidenceLedger {
  requireNonempty(input.campaignId, "campaignId");
  requireNonempty(input.createdAt, "createdAt");
  requireCommit(input.baseCommitSha, "baseCommitSha");
  requireSha256(input.protocolSha256, "protocolSha256");
  requireSha256(input.evaluatorSha256, "evaluatorSha256");
  if (!Array.isArray(input.panelSha256s) || input.panelSha256s.length === 0) {
    throw new Error("panelSha256s must be non-empty");
  }
  for (const [index, panelSha256] of input.panelSha256s.entries()) {
    requireSha256(panelSha256, `panelSha256s[${index}]`);
  }
  if (new Set(input.panelSha256s).size !== input.panelSha256s.length) {
    throw new Error("panelSha256s must be unique");
  }
  requireSha256(input.signer.publicKeySha256, "signer.publicKeySha256");
  if (ledgerSha256(input.signer.publicKeyPem) !== input.signer.publicKeySha256) {
    throw new Error("signer public key fingerprint mismatch");
  }
  const unsigned = {
    schema: EVIDENCE_LEDGER_SCHEMA,
    schemaVersion: EVIDENCE_LEDGER_SCHEMA_VERSION,
    campaignId: input.campaignId,
    createdAt: input.createdAt,
    direction: input.direction,
    baseCommitSha: input.baseCommitSha,
    protocolSha256: input.protocolSha256,
    evaluatorSha256: input.evaluatorSha256,
    panelSha256s: [...input.panelSha256s].sort(),
    signer: input.signer,
  } as const;
  return {
    header: { ...unsigned, headerSha256: ledgerSha256(unsigned) },
    receipts: [],
  };
}

export function appendSignedEvidenceReceipt(
  ledger: EvidenceLedger,
  input: EvidenceReceiptInput,
  privateKeyPem: string,
): EvidenceLedger {
  verifyEvidenceLedger(ledger);
  validateInput(input, ledger.header);
  const related = ledger.receipts.filter((receipt) => receipt.proposalId === input.proposalId);
  const artifactHashes = new Set(
    related.flatMap((receipt) => receipt.artifactSha256 === null ? [] : [receipt.artifactSha256]),
  );
  if (input.artifactSha256 !== null && artifactHashes.size > 0 && !artifactHashes.has(input.artifactSha256)) {
    throw new Error(`proposalId ${input.proposalId} is already bound to another artifact`);
  }
  if (related.some((receipt) => (
    receipt.matcher.matcherId !== input.matcher.matcherId
    || receipt.matcher.matcherVersion !== input.matcher.matcherVersion
    || receipt.matcher.ideaId !== input.matcher.ideaId
  ))) {
    throw new Error(`proposalId ${input.proposalId} is already bound to another matcher`);
  }
  const previous = ledger.receipts.at(-1);
  const unsigned = {
    ...input,
    sequence: ledger.receipts.length,
    parentReceiptSha256: previous?.receiptSha256 ?? ledger.header.headerSha256,
  };
  const receiptSha256 = ledgerSha256(unsigned);
  const signatureValue = signBytes(
    null,
    Buffer.from(receiptSha256, "hex"),
    privateKeyPem,
  ).toString("base64");
  const receipt: SignedEvidenceReceipt = {
    ...unsigned,
    receiptSha256,
    signature: {
      algorithm: "ed25519",
      publicKeySha256: ledger.header.signer.publicKeySha256,
      value: signatureValue,
    },
  };
  if (!verifySignedEvidenceReceipt(receipt, ledger.header)) {
    throw new Error("private key does not match the ledger signer");
  }
  return { header: ledger.header, receipts: [...ledger.receipts, receipt] };
}

export function verifySignedEvidenceReceipt(
  receipt: SignedEvidenceReceipt,
  header: EvidenceLedgerHeader,
): boolean {
  const digest = ledgerSha256(unsignedReceipt(receipt));
  if (digest !== receipt.receiptSha256) return false;
  if (
    receipt.signature.algorithm !== "ed25519"
    || receipt.signature.publicKeySha256 !== header.signer.publicKeySha256
  ) return false;
  try {
    return verifyBytes(
      null,
      Buffer.from(receipt.receiptSha256, "hex"),
      header.signer.publicKeyPem,
      Buffer.from(receipt.signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

export function verifyEvidenceLedger(
  ledger: EvidenceLedger,
  { expectedSignerSha256 = null }: { expectedSignerSha256?: string | null } = {},
): void {
  if (
    ledger.header.schema !== EVIDENCE_LEDGER_SCHEMA
    || ledger.header.schemaVersion !== EVIDENCE_LEDGER_SCHEMA_VERSION
  ) throw new Error("unsupported evidence ledger schema");
  if (ledgerSha256(unsignedHeader(ledger.header)) !== ledger.header.headerSha256) {
    throw new Error("evidence ledger header hash mismatch");
  }
  if (ledgerSha256(ledger.header.signer.publicKeyPem) !== ledger.header.signer.publicKeySha256) {
    throw new Error("evidence ledger signer fingerprint mismatch");
  }
  if (expectedSignerSha256 !== null && ledger.header.signer.publicKeySha256 !== expectedSignerSha256) {
    throw new Error("evidence ledger signer is not anchored to the frozen protocol");
  }
  if (!Array.isArray(ledger.header.panelSha256s) || ledger.header.panelSha256s.length === 0) {
    throw new Error("evidence ledger has no pinned panels");
  }
  for (const panelSha256 of ledger.header.panelSha256s) requireSha256(panelSha256, "header.panelSha256s");
  let parent = ledger.header.headerSha256;
  for (const [index, receipt] of ledger.receipts.entries()) {
    if (receipt.sequence !== index) throw new Error(`receipt ${index} sequence mismatch`);
    if (receipt.parentReceiptSha256 !== parent) throw new Error(`receipt ${index} chain mismatch`);
    validateInput(receipt, ledger.header);
    if (!verifySignedEvidenceReceipt(receipt, ledger.header)) {
      throw new Error(`receipt ${index} signature or digest mismatch`);
    }
    parent = receipt.receiptSha256;
  }
}

function evaluationIsValid(receipt: SignedEvidenceReceipt): boolean {
  return receipt.phase === "evaluation"
    && receipt.qualification !== null
    && Object.values(receipt.qualification).every((status) => status === "passed")
    && receipt.score !== null;
}

function improves(
  direction: OptimizationDirection,
  score: number,
  baselineScore: number,
): boolean {
  return direction === "-" ? score < baselineScore : score > baselineScore;
}

export function reduceEvidenceLedger(
  ledger: EvidenceLedger,
  _annotations: readonly UntrustedEvidenceAnnotation[] = [],
): EvidenceProjectionRow[] {
  verifyEvidenceLedger(ledger);
  const grouped = new Map<string, SignedEvidenceReceipt[]>();
  for (const receipt of ledger.receipts) {
    const rows = grouped.get(receipt.proposalId) ?? [];
    rows.push(receipt);
    grouped.set(receipt.proposalId, rows);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([proposalId, receipts]) => {
      const latest = receipts.at(-1) as SignedEvidenceReceipt;
      const evaluations = receipts.filter((receipt) => receipt.phase === "evaluation");
      const valid = evaluations.filter(evaluationIsValid);
      const improving = valid.filter((receipt) => improves(
        ledger.header.direction,
        receipt.score as number,
        receipt.baselineScore as number,
      ));
      const independentKeys = new Set(improving.map((receipt) => receipt.executor.independenceKey));
      let state: TrustedEvidenceState = "proposal_only";
      if (independentKeys.size >= 2) state = "independently_reproduced";
      else if (improving.length > 0) state = "evaluated_valid_improving";
      else if (valid.length > 0) state = "evaluated_valid_nonimproving";
      else if (evaluations.length > 0) state = "evaluated_invalid";
      else if (receipts.some((receipt) => (
        receipt.phase === "build"
        && receipt.command?.exitCode === 0
        && receipt.artifactSha256 !== null
      ))) state = "built_not_evaluated";
      const bestReceipt = valid.length === 0
        ? null
        : [...valid].sort((left, right) => (
          ledger.header.direction === "-"
            ? (left.score as number) - (right.score as number)
            : (right.score as number) - (left.score as number)
        ))[0];
      return {
        proposalId,
        ideaId: latest.matcher.ideaId,
        matcherId: latest.matcher.matcherId,
        matcherVersion: latest.matcher.matcherVersion,
        membership: latest.matcher.membership,
        state,
        artifactSha256: bestReceipt?.artifactSha256 ?? latest.artifactSha256,
        baselineScore: bestReceipt?.baselineScore ?? latest.baselineScore,
        bestScore: bestReceipt?.score ?? null,
        receiptSha256s: receipts.map((receipt) => receipt.receiptSha256),
        independentReproductions: independentKeys.size,
      };
    });
}

export function serializeEvidenceLedger(ledger: EvidenceLedger): string {
  verifyEvidenceLedger(ledger);
  return `${[
    { kind: "header", value: ledger.header },
    ...ledger.receipts.map((receipt) => ({ kind: "receipt", value: receipt })),
  ].map((entry) => canonicalLedgerStringify(entry)).join("\n")}\n`;
}

export function parseEvidenceLedger(
  text: string,
  options: { expectedSignerSha256?: string | null } = {},
): EvidenceLedger {
  const rows = text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  if (rows.length === 0 || rows[0]?.kind !== "header") throw new Error("ledger is missing its header");
  const ledger = {
    header: rows[0].value,
    receipts: rows.slice(1).map((row, index) => {
      if (row?.kind !== "receipt") throw new Error(`ledger row ${index + 1} is not a receipt`);
      return row.value;
    }),
  } as EvidenceLedger;
  verifyEvidenceLedger(ledger, options);
  return ledger;
}
