# Conjectures and Kill Criteria

## C1: State Routing Beats Task-Name Routing

**Status: not supported for the current R0/R1/R2 policy.** The v3 sensitivity control passed, but neither structured-arm target contrast reached the 0.15 margin. No router should be trained.

**Claim.** Treatment-blind research-state features predict the useful representation better than a task label.

**Prediction.** On held-out task families, a frozen router improves task-equal progress-AUC over always-`R0` by at least 0.25 meaningful-gain units, remains final-score noninferior within 0.25, and is not worse than the best fixed arm.

**Kill criteria.** Kill the claim if held-out improvement is below 0.25, task-name-only routing performs equally well, or feature collisions persist after actionability and noise features are added.

## C2: An Index Helps Only When It Matches the Next Decision

**Status: killed within the tested 10–32-event domain.** R1 tied R0 on all 18 frontier pairs. R2 lost one of 12 comparison pairs and won none. The target indexes increased prompt tokens without improving grounded decisions.

**Claim.** `R1` helps frontier selection under high selection load; `R2` helps experimental discrimination under high causal ambiguity and sufficient actionability.

**Prediction.** In blinded decision probes, `R1` lowers selection regret only in high-branch cells, while `R2` lowers comparison regret only in high-comparison, high-actionability cells. Gains must be accompanied by event-ID grounding.

**Kill criteria.** Kill the mechanism if decisions and grounding do not differ by arm, if benefits occur equally in low-demand cells, or if full-chain outcomes differ without a corresponding decision effect.

## C3: Routing Should Be Dynamic

**Status: not run.** Dynamic routing requires at least two useful fixed-arm mechanisms. Because both prerequisites failed, a switching study is not justified.

**Claim.** A research chain can move from `R0` to `R1` to `R2` as evidence accumulates; one task-level choice is unnecessarily rigid.

**Prediction.** A per-handoff router beats a frozen-at-start router on histories whose preregistered state category changes, without increasing total context or model budget.

**Kill criteria.** Kill dynamic routing if categories are unstable under deterministic replay, switching adds no held-out progress, or gains disappear after accounting for view-reading cost.

## Measurement Boundary

The original six full-chain blocks remain exploratory. The v3 decision probe is a complete sensitivity-valid mechanism result, but its synthetic, one-turn 10–32-event scope cannot establish full-agent efficacy or universal R0 superiority. It is sufficient to reject the present router because that router's own prerequisite mechanisms failed.

## C4: Joined Access Helps Exact Duplicate Detection Only When Calls Bind

**Status: agent mechanism supported; automatic escalation vetoed.** In v2, flat beat raw on 11/12 model×case pairs and never lost; one pair was a shared miss. Flat used 56% fewer queries, returned 44% fewer bytes, and fabricated nothing. Raw scored 0/12 and Kimi fabricated provenance in 3/6 raw sessions. Because the frozen zero-fabrication gate was global across all arms, the aggregate `proceed` flag is false and no larger study starts automatically.

**Claim.** A normalized attempt row improves grounded duplicate recovery when joining source records consumes the query-call budget; it need not help when returned bytes or prompt tokens bind.

**Prediction.** In a frozen two-model positive-duplicate probe, flat improves exact receipt recovery over raw in call-constrained cells, with zero fabrication, and the gain is mediated by fewer tool operations rather than extra semantic facts.

**Kill criteria.** Kill the agent-effect claim if a direct-pointer control fails, flat does not improve exact grounded success, gains appear only with more returned bytes, or either model fabricates provenance.

## C5: Aggregate Briefs Help Synthesis, Not Exact Lookup

**Status: no exact-lookup advantage; synthesis untested.** Brief and flat both scored 11/12 in v2. Brief won one GPT pair, lost one Kimi pair, tied ten, and used slightly more calls, bytes, and cost. Its derived text can change search ranking, but not reliably enough to justify it for one-receipt lookup.

**Claim.** A deterministic evidence brief pays for itself only when the next query requires an aggregate such as counts, outcome mixtures, coverage gaps, or condition effects.

**Prediction.** On known-answer aggregate queries, brief beats flat on accuracy per returned byte while exact citations still resolve to canonical records.

**Kill criteria.** Kill the brief if it does not improve aggregate answers, causes unsupported causal language, or its read/construction cost consumes the saved retrieval budget.
