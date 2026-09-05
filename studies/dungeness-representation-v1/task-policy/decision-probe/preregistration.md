# Dungeness Representation Decision Probe: Preregistration

## Status and Claim Boundary

This protocol is frozen before any decision-probe model response. It tests whether `R0`, `R1`, and `R2` selectively change a model's immediate evidence-grounded research decision. It is a mechanism and construct-validity pilot, not evidence that a representation improves full autonomous-research chains.

No result from the completed six-block Dungeness pilot is used as a training label. The synthetic case generator and oracle use only rules frozen below.

## Design

Cross three binary, treatment-blind state factors:

1. **Selection load:** linear history versus 32 candidates branching from one parent.
2. **Comparison opportunity:** absent versus exactly one same-idea, same-site pair that differs in one recorded condition and has mixed positive/nonpositive gains.
3. **Comparison actionability:** one versus two evaluations remaining; a comparison costs two.

Use three deterministic variants of the full `2 × 2 × 2` design, producing 24 cases. Each case has a mechanically known decision under this fixed priority:

1. Choose a controlled comparison only when the qualifying pair exists and fits the budget.
2. Otherwise, if candidates branch, continue the unique eligible best-score frontier candidate.
3. Otherwise continue the most recent eligible candidate.

Actions, event IDs, cases, packet IDs, and execution order are opaque SHA-256-derived identifiers. Options are deterministically shuffled. The model sees neither factor names nor treatment labels.

## Treatments and Parity

- `R0`: chronology index.
- `R1`: R0 plus frontier, lineage, and condition/intervention indexes.
- `R2`: R1 plus mechanical unresolved-comparison indexes.
- `P`: separate sensitivity control containing the sealed answer locator. `P` intentionally changes information and is never part of an equal-evidence contrast.

For `R0`–`R2`, task card, compact decision atoms, action options, system message, generation settings, and model are byte-identical within case. Only the hidden index bytes differ. Every packet must remain below the original 32,000-token deterministic allowance. Treatment names must not occur in packets or prompts.

## Execution

- Models: `openai/gpt-5.6-sol` and `moonshotai/kimi-k3` through OpenRouter.
- Maximum calls: 144 core plus 48 sensitivity-control calls.
- Generation: temperature 0, maximum 1,024 output tokens, JSON-object response format.
- Direct-model spend cap: `$12`; this remains inside the study-wide `$500` ceiling.
- Administrative provider errors receive at most two retries and are retained. Invalid JSON or a wrong/no answer after a successful provider response is a real zero.
- Resume by the unique model × case × arm key. Never overwrite a completed response.

## Outcomes

Primary outcome: exact next-action accuracy.

Mechanism companion: grounded accuracy, requiring the correct action plus exactly the oracle event IDs. Also report response validity, prompt/completion tokens, latency if available, and cost.

Paired target contrasts:

- `R1 − R0` on cases whose oracle decision is frontier selection.
- `R2 − R1` and `R2 − R0` on cases whose oracle decision is a controlled comparison.
- Structured-arm differences on chronology cases as a specificity check.

Report paired mean differences, wins/losses/ties, and exact two-sided sign probabilities. These are pilot descriptors, not confirmatory p-values.

## Frozen Gates

The assay is sensitive only if `P` accuracy is at least 90% separately for each model.

An index-specific mechanism passes only if its pooled paired accuracy benefit is at least 0.15 and its target contrast is nonnegative in both model families:

- R1 gate: `R1 − R0 ≥ 0.15` on frontier cases.
- R2 gate: `R2 − R1 ≥ 0.15` on comparison cases.

Proceed to a routed full-chain study only if the sensitivity gate and both selective mechanism gates pass. If `P` fails, repair and version the assay without interpreting core outcomes. If R1 or R2 fails, do not claim that index is useful and do not fund a router using that failed rule. Any later scale escalation or prompt change is a new version and cannot reuse these outcomes as confirmatory evidence.

## Audit Artifacts

`v1-freeze.json` records exact source hashes, case factors and oracles, packet hashes, token diagnostics, execution settings, gates, and call counts. `v1-results.json` will retain opaque response IDs, routed models, prompt/packet hashes, raw response text, usage, cost, and deterministic scores. Dungeness's existing study ledger remains authoritative for Dungeness runs; direct probe spend is recorded separately and added to study-wide totals.
