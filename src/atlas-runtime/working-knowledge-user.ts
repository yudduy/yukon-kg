import type { AtlasIdea, AtlasRelease } from "./types";
import type { WorkingKnowledgeBrief } from "./working-knowledge";

export const ECDSA_USER_PROTOCOL_VERSION = "yukon-kg.ecdsa-user-representation.v1";
export const ECDSA_USER_VIEW_SCHEMA = "yukon-kg.ecdsa-user-view";
export const ECDSA_USER_VIEW_SCHEMA_VERSION = 1 as const;
export const USER_REPRESENTATIONS = Object.freeze(["archive_promotions", "working_knowledge"] as const);

export type UserRepresentation = (typeof USER_REPRESENTATIONS)[number];

export interface UserDecisionItem {
  id: string;
  action: string;
  reason: string;
  sourceRefs: string[];
}

export interface UserDecision {
  primaryQuestion: string;
  doNow: UserDecisionItem[];
  avoid: UserDecisionItem[];
  knownLocalMoves: UserDecisionItem[];
}

export interface EcdsaUserView {
  schema: typeof ECDSA_USER_VIEW_SCHEMA;
  schemaVersion: typeof ECDSA_USER_VIEW_SCHEMA_VERSION;
  protocolVersion: typeof ECDSA_USER_PROTOCOL_VERSION;
  briefSha256: string;
  decision: UserDecision;
  brief: WorkingKnowledgeBrief;
}

export interface UserCaseGold {
  label: string;
  ideaId?: string | null;
  hazardId?: string;
  constraintId?: string;
  discriminatorId?: string;
  interpretation?: string;
}

export interface UserCase {
  id: string;
  question: string;
  gold: UserCaseGold;
}

export interface UserCaseResult {
  caseId: string;
  question: string;
  gold: UserCaseGold;
  answer: string;
  pass: boolean;
  rationale: string;
}

export const ECDSA_USER_CASES: readonly UserCase[] = Object.freeze([
  {
    id: "seed-grinding-mechanism",
    question: "Is nonce or seed grinding a supported circuit mechanism?",
    gold: { label: "no", hazardId: "hazard:seed-grinding", ideaId: null },
  },
  {
    id: "largest-isolated-effect",
    question: "Which isolated one-change intervention improved the official score the most?",
    gold: { label: "Adaptive phase correction", ideaId: "candidate:adaptive-phase-correction:a391ebef3b" },
  },
  {
    id: "karatsuba-isolated",
    question: "Has Karatsuba squaring been isolated with a jointly qualified one-change ablation?",
    gold: { label: "no" },
  },
  {
    id: "fermat-retry",
    question: "Should Fermat inversion be retried on the current representation?",
    gold: { label: "no", ideaId: "candidate:fermat-inversion:b1eff02f73" },
  },
  {
    id: "toffoli-can-rise",
    question: "Can a change increase Toffoli count and still improve the official score?",
    gold: { label: "yes", ideaId: "candidate:solinas-reduction:5a45b2514d" },
  },
  {
    id: "qubit-floor",
    question: "What is the pinned qubit floor for this interface?",
    gold: { label: "512", constraintId: "constraint:ecdsa:qubit-count" },
  },
  {
    id: "frontier-mixed",
    question: "Is the current champion score a pure mechanism effect?",
    gold: { label: "no", interpretation: "mixed" },
  },
  {
    id: "next-untried",
    question: "Name one untried representation-class discriminator.",
    gold: { label: "Barrett reciprocal reduction", discriminatorId: "disc:barrett-vs-solinas" },
  },
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compileUserDecision(brief: WorkingKnowledgeBrief): UserDecision {
  const knownLocalMoves = brief.supportedMechanisms.map((mechanism) => {
    const toffoliRise = mechanism.toffoliDelta !== null && mechanism.toffoliDelta > 0 && mechanism.officialDelta < 0;
    return {
      id: `move:${mechanism.ideaId}`,
      action: `Reuse ${mechanism.title} on a new parent; do not rediscover it.`,
      reason: toffoliRise
        ? `Admitted one-change official delta ${mechanism.officialDelta}; Toffoli rose by ${mechanism.toffoliDelta} while the qubit–Toffoli product still improved.`
        : `Admitted one-change official delta ${mechanism.officialDelta} under ${mechanism.scope}.`,
      sourceRefs: [...mechanism.sourceRefs],
    };
  });
  const untried = brief.nextDiscriminators
    .filter((item) => item.status === "untried_in_atlas")
    .sort((left, right) => compareText(left.discriminatorId, right.discriminatorId))
    .map((item) => ({
      id: item.discriminatorId,
      action: item.question,
      reason: item.predictedDistinction,
      sourceRefs: [...item.sourceRefs],
    }));
  const isolate = brief.nextDiscriminators
    .filter((item) => item.status === "historical_only" || item.status === "qualification_failed")
    .sort((left, right) => compareText(left.discriminatorId, right.discriminatorId))
    .slice(0, 3)
    .map((item) => ({
      id: item.discriminatorId,
      action: item.question,
      reason: item.predictedDistinction,
      sourceRefs: [...item.sourceRefs],
    }));
  const karatsuba = brief.unverifiedObservations.find((item) => item.ideaId.toLowerCase().includes("karatsuba"))
    ?? brief.nextDiscriminators.find((item) => item.relatedIdeaIds.some((ideaId) => ideaId.toLowerCase().includes("karatsuba")));
  const avoidKaratsuba = karatsuba === undefined ? [] : [{
    id: "avoid:karatsuba-ping-pong",
    action: "Do not treat Karatsuba or ping-pong inversion as an isolated mechanism.",
    reason: "whyUnverified" in karatsuba ? karatsuba.whyUnverified : karatsuba.predictedDistinction,
    sourceRefs: [...karatsuba.sourceRefs],
  }];
  return {
    primaryQuestion: "What isolated move is worth trying next on the pinned ECDSA.fail scorer?",
    doNow: [...untried, ...isolate],
    avoid: brief.evaluatorHazards.map((hazard) => ({
      id: hazard.hazardId,
      action: `Do not treat ${hazard.title.toLowerCase()} as a circuit mechanism.`,
      reason: hazard.recommendedAction,
      sourceRefs: [...hazard.sourceRefs],
    })).concat(
      brief.negativeKnowledge
        .filter((item) => item.ideaId.includes("fermat-inversion") || item.family === "measurement")
        .slice(0, 3)
        .map((item) => ({
          id: `avoid:${item.ideaId}`,
          action: `Do not retry ${item.title} without a representation or scorer change.`,
          reason: item.reopenCondition,
          sourceRefs: [...item.sourceRefs],
        })),
      avoidKaratsuba,
    ),
    knownLocalMoves,
  };
}

function topPromotedIdeas(ideas: readonly AtlasIdea[], limit = 8): AtlasIdea[] {
  return [...ideas]
    .sort((left, right) => right.aggregate.promoted - left.aggregate.promoted || compareText(left.id, right.id))
    .slice(0, limit);
}

function answerArchivePromotions(ideas: readonly AtlasIdea[], userCase: UserCase): UserCaseResult {
  const ranked = topPromotedIdeas(ideas);
  const champion = ranked[0];
  const karatsuba = ideas.find((idea) => idea.id.includes("karatsuba-multiplication"));
  const fermat = ideas.find((idea) => idea.id.includes("fermat-inversion"));
  let answer = "unknown";
  let pass = false;
  let rationale = "The archive view ranks ideas by promotion count.";
  if (userCase.id === "seed-grinding-mechanism") {
    const treatsAsMechanism = champion?.id.includes("seed-grinding") === true && (champion.aggregate.promoted ?? 0) > 0;
    answer = treatsAsMechanism ? "yes" : "no";
    pass = answer === userCase.gold.label;
    rationale = `${champion?.name ?? "unknown"} has ${champion?.aggregate.promoted ?? 0} promotions, so the archive invites treating it as what worked.`;
  } else if (userCase.id === "largest-isolated-effect") {
    answer = champion?.name ?? "unknown";
    pass = champion?.id === userCase.gold.ideaId;
    rationale = `The most promoted idea is ${champion?.name ?? "unknown"}.`;
  } else if (userCase.id === "karatsuba-isolated") {
    const promoted = karatsuba?.aggregate.promoted ?? 0;
    answer = promoted > 0 ? "yes" : "no";
    pass = answer === userCase.gold.label;
    rationale = `Karatsuba has ${promoted} promoted submissions in the idea catalog.`;
  } else if (userCase.id === "fermat-retry") {
    const promoted = fermat?.aggregate.promoted ?? 0;
    answer = promoted > 0 ? "yes" : "no";
    pass = answer === userCase.gold.label;
    rationale = `Fermat inversion has ${promoted} promotions.`;
  } else if (userCase.id === "toffoli-can-rise") {
    answer = "unknown";
    pass = false;
    rationale = "Promotion counts do not separate Toffoli change from the official product score.";
  } else if (userCase.id === "qubit-floor") {
    answer = "unknown";
    pass = false;
    rationale = "The idea catalog does not carry the pinned interface floor.";
  } else if (userCase.id === "frontier-mixed") {
    answer = "unknown";
    pass = false;
    rationale = "Best-score rows are visible in submissions, but mixed-idea routing is not the default user view.";
  } else if (userCase.id === "next-untried") {
    answer = ranked.map((idea) => idea.name).join(", ");
    pass = false;
    rationale = "Promotion rank cannot name an untried representation such as Barrett reduction.";
  }
  return { caseId: userCase.id, question: userCase.question, gold: userCase.gold, answer, pass, rationale };
}

function answerWorkingKnowledge(brief: WorkingKnowledgeBrief, userCase: UserCase): UserCaseResult {
  const decision = compileUserDecision(brief);
  let answer = "unknown";
  let pass = false;
  let rationale = "";
  if (userCase.id === "seed-grinding-mechanism") {
    const hazard = brief.evaluatorHazards.some((item) => item.hazardId === "hazard:seed-grinding");
    const asMechanism = brief.supportedMechanisms.some((item) => item.ideaId.includes("seed-grinding"));
    answer = hazard && !asMechanism ? "no" : "yes";
    pass = answer === userCase.gold.label;
    rationale = "Seed grinding is listed as an evaluator hazard and is absent from admitted mechanisms.";
  } else if (userCase.id === "largest-isolated-effect") {
    const best = brief.supportedMechanisms[0];
    answer = best?.title ?? "unknown";
    pass = best?.ideaId === userCase.gold.ideaId;
    rationale = `${best?.title ?? "none"} has the most negative admitted official delta.`;
  } else if (userCase.id === "karatsuba-isolated") {
    const isolated = brief.supportedMechanisms.some((item) => item.ideaId.toLowerCase().includes("karatsuba"));
    answer = isolated ? "yes" : "no";
    pass = answer === userCase.gold.label;
    rationale = isolated
      ? "Karatsuba appears among admitted one-change mechanisms."
      : "Karatsuba remains historical observation only.";
  } else if (userCase.id === "fermat-retry") {
    const fermat = brief.negativeKnowledge.find((item) => item.ideaId.includes("fermat-inversion"));
    answer = fermat === undefined ? "unknown" : "no";
    pass = answer === userCase.gold.label;
    rationale = fermat?.reopenCondition ?? "Fermat inversion is not in negative knowledge.";
  } else if (userCase.id === "toffoli-can-rise") {
    const example = brief.supportedMechanisms.find((item) => item.toffoliDelta !== null && item.toffoliDelta > 0 && item.officialDelta < 0);
    answer = example === undefined ? "no" : "yes";
    pass = answer === userCase.gold.label;
    rationale = example === undefined
      ? "No admitted mechanism raises Toffoli while lowering the official score."
      : `${example.title} raises Toffoli by ${example.toffoliDelta} while improving the product score.`;
  } else if (userCase.id === "qubit-floor") {
    const bound = brief.boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:qubit-count");
    answer = bound?.limitValue === null || bound?.limitValue === undefined ? "unknown" : String(bound.limitValue);
    pass = answer === userCase.gold.label;
    rationale = bound?.limitStatement ?? "Qubit bound is missing.";
  } else if (userCase.id === "frontier-mixed") {
    const interpretation = brief.currentFrontier[0]?.interpretation;
    answer = interpretation === "mixed" ? "no" : "yes";
    pass = answer === userCase.gold.label;
    rationale = `Champion interpretation is ${interpretation ?? "missing"}.`;
  } else if (userCase.id === "next-untried") {
    const untried = brief.nextDiscriminators.find((item) => item.discriminatorId === userCase.gold.discriminatorId)
      ?? decision.doNow.find((item) => item.id.startsWith("disc:barrett"));
    answer = untried === undefined ? "unknown" : (userCase.gold.label);
    pass = untried !== undefined;
    rationale = untried === undefined ? "Barrett discriminator is missing." : untried.action ?? untried.question;
  }
  return { caseId: userCase.id, question: userCase.question, gold: userCase.gold, answer, pass, rationale };
}

export function scoreUserRepresentation(
  representation: UserRepresentation,
  brief: WorkingKnowledgeBrief,
  ideas: readonly AtlasIdea[],
  userCase: UserCase,
): UserCaseResult {
  return representation === "working_knowledge"
    ? answerWorkingKnowledge(brief, userCase)
    : answerArchivePromotions(ideas, userCase);
}

export function analyzeUserRepresentationExperiment(
  brief: WorkingKnowledgeBrief,
  ideas: readonly AtlasIdea[],
): {
  protocolVersion: typeof ECDSA_USER_PROTOCOL_VERSION;
  releaseId: string;
  totals: Record<UserRepresentation, { cases: number; passed: number }>;
  adoptedRepresentation: "working_knowledge" | null;
  reason: string;
  results: Record<UserRepresentation, UserCaseResult[]>;
} {
  const results = Object.fromEntries(USER_REPRESENTATIONS.map((representation) => [
    representation,
    ECDSA_USER_CASES.map((userCase) => scoreUserRepresentation(representation, brief, ideas, userCase)),
  ])) as Record<UserRepresentation, UserCaseResult[]>;
  const totals = Object.fromEntries(USER_REPRESENTATIONS.map((representation) => [
    representation,
    {
      cases: results[representation].length,
      passed: results[representation].filter((item) => item.pass).length,
    },
  ])) as Record<UserRepresentation, { cases: number; passed: number }>;
  const working = totals.working_knowledge;
  const archive = totals.archive_promotions;
  const workingClears = working.passed === working.cases;
  const archiveMissesDecision = results.archive_promotions.some((item) => (
    (item.caseId === "seed-grinding-mechanism" || item.caseId === "largest-isolated-effect") && !item.pass
  ));
  const adoptedRepresentation = workingClears && archiveMissesDecision ? "working_knowledge" : null;
  return {
    protocolVersion: ECDSA_USER_PROTOCOL_VERSION,
    releaseId: brief.compiledFrom.releaseId,
    totals,
    adoptedRepresentation,
    reason: adoptedRepresentation === "working_knowledge"
      ? "The working-knowledge brief answered every user decision question; ranking ideas by promotions misled on mechanism identity."
      : "The working-knowledge brief did not earn adoption under the preregistered user-decision gate.",
    results,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not recorded";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function signed(value: number): string {
  const formatted = formatNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

export function renderWorkingKnowledgePage(view: EcdsaUserView): string {
  const { brief, decision } = view;
  const frontier = brief.currentFrontier[0];
  const spacetime = brief.boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:spacetime-product");
  const qubits = brief.boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:qubit-count");
  const toffoli = brief.boundAndGap.find((item) => item.constraintId === "constraint:ecdsa:toffoli-count");
  const measuredBounds = brief.boundAndGap.filter((item) => item.baseline !== null || item.frontier !== null);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ECDSA.fail working knowledge</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; color: #17211b; background: #f6f8f5; font: 16px/1.55 system-ui, sans-serif; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
    h1, h2, h3 { line-height: 1.2; }
    h1 { font-size: 1.85rem; margin: 0 0 8px; }
    h2 { font-size: 1.2rem; margin: 36px 0 12px; }
    p, li { overflow-wrap: anywhere; }
    a { color: #17603a; }
    .lede { color: #3c4a43; margin: 0 0 24px; }
    .hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0 28px; }
    .stat, .card { background: #fff; border: 1px solid #d7e0d8; border-radius: 12px; padding: 14px 16px; }
    .stat .label, .eyebrow { font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; color: #5b6b62; }
    .stat .value { font-size: 1.25rem; font-weight: 650; margin-top: 4px; }
    .do { border-left: 4px solid #17603a; }
    .dont { border-left: 4px solid #8a2f1d; }
    .card + .card { margin-top: 10px; }
    .muted { color: #5b6b62; font-size: 0.92rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #d7e0d8; vertical-align: top; }
    th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: #5b6b62; }
    .table-wrap { overflow-x: auto; border: 1px solid #d7e0d8; border-radius: 12px; }
    nav a { margin-right: 14px; }
    details { background: #fff; border: 1px solid #d7e0d8; border-radius: 12px; padding: 10px 14px; margin: 8px 0; }
    code { font-size: 0.9em; }
  </style>
</head>
<body>
<main>
  <p class="eyebrow">Yukon KG · ECDSA.fail</p>
  <h1>Working knowledge</h1>
  <p class="lede">The user-facing packet for the pinned scorer. Isolated one-change effects only. Promotion counts, nonce grinding, and published Pareto points are not treated as mechanisms.</p>
  <nav>
    <a href="#decision">Decision</a>
    <a href="#mechanisms">Mechanisms</a>
    <a href="#hazards">Hazards</a>
    <a href="#next">Next</a>
    <a href="./working-knowledge.json">JSON packet</a>
    <a href="./index.json">Sealed archive</a>
  </nav>
  <section class="hero" data-section="hero">
    <div class="stat" data-testid="frontier-score" data-frontier-score="${escapeHtml(String(frontier?.score ?? ""))}">
      <div class="label">Current score</div>
      <div class="value">${escapeHtml(formatNumber(frontier?.score))}</div>
      <div class="muted">${escapeHtml(frontier?.interpretation ?? "unrouted")} champion · lower is better</div>
    </div>
    <div class="stat" data-testid="qubits" data-qubits="${escapeHtml(String(qubits?.frontier ?? ""))}">
      <div class="label">Qubits</div>
      <div class="value">${escapeHtml(formatNumber(qubits?.frontier))}</div>
      <div class="muted">Pinned floor ${escapeHtml(formatNumber(qubits?.limitValue))}</div>
    </div>
    <div class="stat" data-testid="toffoli" data-toffoli="${escapeHtml(String(toffoli?.frontier ?? ""))}">
      <div class="label">Toffoli / shot</div>
      <div class="value">${escapeHtml(formatNumber(toffoli?.frontier))}</div>
      <div class="muted">Baseline ${escapeHtml(formatNumber(toffoli?.baseline))}</div>
    </div>
    <div class="stat">
      <div class="label">Admitted isolations</div>
      <div class="value">${escapeHtml(String(brief.supportedMechanisms.length))}</div>
      <div class="muted">${escapeHtml(String(brief.corpusAccounting.seedGrindingSubmissions))} nonce-tagged submissions held out</div>
    </div>
  </section>

  <h2 id="decision">Decision</h2>
  <p data-testid="decision" data-section="decision"><strong>${escapeHtml(decision.primaryQuestion)}</strong></p>
  ${decision.doNow.slice(0, 6).map((item) => `
  <article class="card do" data-decision="do" data-item-id="${escapeHtml(item.id)}">
    <div class="eyebrow">Do</div>
    <h3>${escapeHtml(item.action)}</h3>
    <p class="muted">${escapeHtml(item.reason)}</p>
  </article>`).join("")}
  ${decision.avoid.map((item) => `
  <article class="card dont" data-decision="avoid" data-item-id="${escapeHtml(item.id)}">
    <div class="eyebrow">Don't</div>
    <h3>${escapeHtml(item.action)}</h3>
    <p class="muted">${escapeHtml(item.reason)}</p>
  </article>`).join("")}
  <h3>Already known local moves</h3>
  <p class="muted">Reuse these; they are already jointly qualified. They are not the next experiment.</p>
  ${decision.knownLocalMoves.slice(0, 4).map((item) => `
  <article class="card" data-decision="known" data-item-id="${escapeHtml(item.id)}">
    <div class="eyebrow">Reuse</div>
    <h3>${escapeHtml(item.action)}</h3>
    <p class="muted">${escapeHtml(item.reason)}</p>
  </article>`).join("")}

  <h2 id="mechanisms">Supported mechanisms</h2>
  <p class="muted">Jointly qualified one-change ablations. Deltas are scoped to their parent artifacts and are not additive with the frontier score ${escapeHtml(formatNumber(spacetime?.frontier))}.</p>
  <div class="table-wrap">
    <table data-section="mechanisms">
      <thead><tr><th>Move</th><th>Family</th><th>Official Δ</th><th>Toffoli Δ</th><th>Qubit Δ</th></tr></thead>
      <tbody>
        ${brief.supportedMechanisms.map((item) => `
        <tr data-mechanism-id="${escapeHtml(item.ideaId)}">
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.family)}</td>
          <td>${escapeHtml(signed(item.officialDelta))}</td>
          <td>${escapeHtml(item.toffoliDelta === null ? "—" : signed(item.toffoliDelta))}</td>
          <td>${escapeHtml(item.qubitDelta === null ? "—" : signed(item.qubitDelta))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <p class="muted">Reuse these on a new parent. Solinas can raise Toffoli and still win the qubit–Toffoli product.</p>

  <h2 id="hazards">Evaluator hazards</h2>
  ${brief.evaluatorHazards.map((item) => `
  <article class="card dont" data-hazard-id="${escapeHtml(item.hazardId)}">
    <h3>${escapeHtml(item.title)} · ${escapeHtml(formatNumber(item.count))}</h3>
    <p>${escapeHtml(item.why)}</p>
    <p class="muted">${escapeHtml(item.recommendedAction)}</p>
  </article>`).join("")}

  <h2 id="next">Next discriminators</h2>
  ${brief.nextDiscriminators.filter((item) => item.status === "untried_in_atlas").map((item) => `
  <article class="card do" data-discriminator-id="${escapeHtml(item.discriminatorId)}" data-status="${escapeHtml(item.status)}">
    <div class="eyebrow">${escapeHtml(item.status.replaceAll("_", " "))}</div>
    <h3>${escapeHtml(item.question)}</h3>
    <p class="muted">${escapeHtml(item.predictedDistinction)}</p>
  </article>`).join("")}
  <details>
    <summary>Historical and qualification-failed isolations</summary>
    ${brief.nextDiscriminators.filter((item) => item.status !== "untried_in_atlas").map((item) => `
    <article class="card" data-discriminator-id="${escapeHtml(item.discriminatorId)}" data-status="${escapeHtml(item.status)}">
      <div class="eyebrow">${escapeHtml(item.status.replaceAll("_", " "))}</div>
      <h3>${escapeHtml(item.question)}</h3>
      <p class="muted">${escapeHtml(item.predictedDistinction)}</p>
    </article>`).join("")}
  </details>

  <h2>Contract and bounds</h2>
  <p>${escapeHtml(brief.contract.objective)} Editable surface: ${escapeHtml(brief.contract.mutableSurface)} ${escapeHtml(String(brief.contract.shots))} shots. Degenerate optimum: ${escapeHtml(brief.contract.degenerateOptimum)}</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Bound</th><th>Baseline</th><th>Frontier</th><th>Limit</th></tr></thead>
      <tbody>
        ${measuredBounds.map((item) => `
        <tr data-constraint-id="${escapeHtml(item.constraintId)}">
          <td>${escapeHtml(item.label)}</td>
          <td>${escapeHtml(formatNumber(item.baseline))}</td>
          <td>${escapeHtml(formatNumber(item.frontier))}</td>
          <td>${escapeHtml(item.limitValue === null ? item.limitKind : `${item.limitKind}: ${formatNumber(item.limitValue)}`)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <h2>Negative knowledge</h2>
  ${brief.negativeKnowledge.slice(0, 8).map((item) => `
  <details data-negative-id="${escapeHtml(item.ideaId)}">
    <summary>${escapeHtml(item.title)} · ${escapeHtml(String(item.submissions))} attempts, 0 promoted</summary>
    <p>${escapeHtml(item.why)}</p>
    <p class="muted">Reopen: ${escapeHtml(item.reopenCondition)}</p>
  </details>`).join("")}

  <h2>Literature overlay</h2>
  <p class="muted">These claims are source-reported. They are not Atlas-verified measurements.</p>
  ${brief.literatureOverlay.map((item) => `
  <details>
    <summary>${escapeHtml(item.claimId)} · ${escapeHtml(item.status)} · ${escapeHtml(item.predicate)}</summary>
    <p>${escapeHtml(item.claim)}</p>
    <p class="muted">${escapeHtml(item.implication)} Boundary: ${escapeHtml(item.boundary)}</p>
  </details>`).join("")}

  <h2>Caveats</h2>
  <ul>${brief.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <p class="muted">Compiled from release <code>${escapeHtml(brief.compiledFrom.releaseId)}</code>. Presentation-plane cache; the archive is sealed and is not the user default.</p>
</main>
</body>
</html>
`;
}

export function buildEcdsaUserView(brief: WorkingKnowledgeBrief, briefSha256: string): EcdsaUserView {
  return {
    schema: ECDSA_USER_VIEW_SCHEMA,
    schemaVersion: ECDSA_USER_VIEW_SCHEMA_VERSION,
    protocolVersion: ECDSA_USER_PROTOCOL_VERSION,
    briefSha256,
    decision: compileUserDecision(brief),
    brief,
  };
}

export function ideasFromRelease(release: AtlasRelease): readonly AtlasIdea[] {
  return release.ideas.ideas;
}
