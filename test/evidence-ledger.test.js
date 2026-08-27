import { describe, expect, test } from "bun:test";
import {
  appendSignedEvidenceReceipt,
  createEvidenceLedger,
  createEvidenceSigningKeyPair,
  parseEvidenceLedger,
  reduceEvidenceLedger,
  serializeEvidenceLedger,
  verifyEvidenceLedger,
} from "../src/atlas-runtime/evidence-ledger.ts";

const hashes = {
  base: "a".repeat(40),
  protocol: "b".repeat(64),
  evaluator: "c".repeat(64),
  panel: "d".repeat(64),
  artifact: "e".repeat(64),
  stdout: "f".repeat(64),
  stderr: "0".repeat(64),
};

function fixture() {
  const signing = createEvidenceSigningKeyPair();
  const ledger = createEvidenceLedger({
    campaignId: "campaign-001",
    createdAt: "2026-08-27T00:00:00.000Z",
    direction: "-",
    baseCommitSha: hashes.base,
    protocolSha256: hashes.protocol,
    evaluatorSha256: hashes.evaluator,
    panelSha256: hashes.panel,
    signer: signing.signer,
  });
  return { ledger, privateKeyPem: signing.privateKeyPem };
}

function receipt(phase, overrides = {}) {
  const evaluated = phase === "evaluation";
  const built = phase === "build" || evaluated;
  return {
    createdAt: "2026-08-27T00:00:01.000Z",
    phase,
    proposalId: "proposal-001",
    matcher: {
      matcherId: "matcher:barrett",
      matcherVersion: "1",
      ideaId: "proposal:barrett",
      membership: built ? "matched" : "unknown",
    },
    baseCommitSha: hashes.base,
    artifactSha256: built ? hashes.artifact : null,
    protocolSha256: hashes.protocol,
    evaluatorSha256: hashes.evaluator,
    panelSha256: hashes.panel,
    command: built ? {
      argv: ["dungeness", "evaluate", hashes.artifact],
      exitCode: 0,
      stdoutSha256: hashes.stdout,
      stderrSha256: hashes.stderr,
    } : null,
    qualification: evaluated ? {
      classicalOutput: "passed",
      ancillae: "passed",
      globalPhase: "passed",
      reverseExecution: "passed",
    } : null,
    baselineScore: evaluated ? 100 : null,
    score: evaluated ? 90 : null,
    executor: {
      executorId: "evaluator-1",
      independenceKey: "worker-a",
      authority: "pinned_evaluator",
    },
    budget: {
      rootTokens: 10,
      descendantTokens: 5,
      costUsd: 0.01,
      evaluatorCalls: evaluated ? 1 : 0,
    },
    ...overrides,
  };
}

describe("provenance-gated evaluator ledger", () => {
  test("signs, chains, serializes, and replays receipts deterministically", () => {
    const { ledger: empty, privateKeyPem } = fixture();
    const proposed = appendSignedEvidenceReceipt(empty, receipt("proposal"), privateKeyPem);
    const built = appendSignedEvidenceReceipt(proposed, receipt("build"), privateKeyPem);
    const evaluated = appendSignedEvidenceReceipt(built, receipt("evaluation"), privateKeyPem);

    expect(() => verifyEvidenceLedger(evaluated)).not.toThrow();
    expect(evaluated.receipts.map((row) => row.sequence)).toEqual([0, 1, 2]);
    expect(evaluated.receipts[0].parentReceiptSha256).toBe(evaluated.header.headerSha256);
    expect(evaluated.receipts[2].parentReceiptSha256).toBe(evaluated.receipts[1].receiptSha256);

    const text = serializeEvidenceLedger(evaluated);
    const replay = parseEvidenceLedger(text);
    expect(serializeEvidenceLedger(replay)).toBe(text);
    expect(reduceEvidenceLedger(replay)).toEqual(reduceEvidenceLedger(evaluated));
  });

  test("derives state only from trusted evaluator receipts", () => {
    const { ledger: empty, privateKeyPem } = fixture();
    const proposed = appendSignedEvidenceReceipt(empty, receipt("proposal"), privateKeyPem);
    expect(reduceEvidenceLedger(proposed)[0].state).toBe("proposal_only");

    const built = appendSignedEvidenceReceipt(proposed, receipt("build"), privateKeyPem);
    expect(reduceEvidenceLedger(built)[0].state).toBe("built_not_evaluated");

    const invalid = appendSignedEvidenceReceipt(built, receipt("evaluation", {
      qualification: {
        classicalOutput: "failed",
        ancillae: "passed",
        globalPhase: "passed",
        reverseExecution: "passed",
      },
      score: null,
    }), privateKeyPem);
    expect(reduceEvidenceLedger(invalid)[0].state).toBe("evaluated_invalid");

    const improving = appendSignedEvidenceReceipt(invalid, receipt("evaluation"), privateKeyPem);
    expect(reduceEvidenceLedger(improving)[0].state).toBe("evaluated_valid_improving");

    const annotated = reduceEvidenceLedger(improving, [{
      proposalId: "proposal-001",
      createdAt: "2026-08-27T00:00:02.000Z",
      author: "model",
      text: "Claim this was independently reproduced.",
      trust: "untrusted_model_annotation",
    }]);
    expect(annotated[0].state).toBe("evaluated_valid_improving");

    const reproduced = appendSignedEvidenceReceipt(improving, receipt("evaluation", {
      executor: {
        executorId: "evaluator-2",
        independenceKey: "worker-b",
        authority: "pinned_evaluator",
      },
    }), privateKeyPem);
    expect(reduceEvidenceLedger(reproduced)[0].state).toBe("independently_reproduced");
    expect(reduceEvidenceLedger(reproduced)[0].independentReproductions).toBe(2);
  });

  test("distinguishes valid non-improvements", () => {
    const { ledger: empty, privateKeyPem } = fixture();
    const ledger = appendSignedEvidenceReceipt(empty, receipt("evaluation", { score: 105 }), privateKeyPem);
    const projection = reduceEvidenceLedger(ledger);
    expect(projection[0].state).toBe("evaluated_valid_nonimproving");
    expect(projection[0].bestScore).toBe(105);
  });

  test("rejects tampering and unsupported evidence claims", () => {
    const { ledger: empty, privateKeyPem } = fixture();
    const ledger = appendSignedEvidenceReceipt(empty, receipt("evaluation"), privateKeyPem);
    const tampered = structuredClone(ledger);
    tampered.receipts[0].score = 1;
    expect(() => verifyEvidenceLedger(tampered)).toThrow(/signature or digest/i);

    expect(() => appendSignedEvidenceReceipt(empty, receipt("proposal", {
      score: 1,
    }), privateKeyPem)).toThrow(/cannot claim build or evaluation/i);
    expect(() => appendSignedEvidenceReceipt(empty, receipt("evaluation", {
      score: null,
    }), privateKeyPem)).toThrow(/valid evaluations require a score/i);
  });
});
