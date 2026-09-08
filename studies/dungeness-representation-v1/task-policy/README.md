# Conditional Representation Policy

## Result

The proposed conditional R0/R1/R2 policy failed its preregistered mechanism test. For the tested 10–32-event, one-turn research decisions, use `R0` regardless of whether the state contains branches or an actionable matched comparison. A separate access-axis probe now establishes one narrow exception: use a normalized joined-attempt view for exact positive duplicate lookup in a large archive.

The complete sensitivity-valid probe produced:

| Arm | Exact and grounded accuracy | Mean prompt tokens | Decision |
|---|---:|---:|---|
| R0 | **48/48** | 4,435 | Retain |
| R1 | **48/48** | 5,292 | Reject: no benefit, higher cost |
| R2 | **47/48** | 5,980 | Reject: one target-condition error, higher cost |

The answer-pointer control was 48/48, so the null is not explained by an insensitive assay. See the [final v3 report](decision-probe/results-v3.md).

First principles still say the defensible classification unit is the agent's next decision, not a task name. The experiment shows that the current indexes did not help even when their hypothesized decision bottlenecks were deliberately present.

All three arms contain the same facts. They differ only in which facts are cheap to find:

- `R0` is a chronological index: “What happened?”
- `R1` adds frontier, lineage, and condition indexes: “Which branch should I continue?”
- `R2` adds unresolved-comparison sets: “Which controlled comparison should I run?”

This is analogous to choosing a database index. The best index depends on the next query, not the database's subject. A representation should be selected only when its saved reasoning cost exceeds its reading/context cost.

```text
best view(state) = argmax expected verified progress
                   minus representation reading cost
```

## Current Operational Classification

| Observable research state | Choice | Evidence |
|---|---|---|
| Linear readable history | `R0` | All core arms were perfect; R0 was cheapest. |
| 32 candidates branching from one parent | `R0` | R1−R0 was 0 across 18 paired frontier decisions; R1 added ~857 prompt tokens. |
| Exactly one actionable mixed-outcome matched comparison | `R0` | R0/R1 were 12/12; R2 was 11/12 and added ~1,544 prompt tokens. |
| No feasible discriminating follow-up or noisy evidence | `R0` | Structure cannot create headroom or repair evidence. |
| Large archive; exact answer joins attempt, outcome, and provenance | Flat joined attempt rows | Two-model Atlas v2: 11/12 exact versus raw 0/12; 56% fewer queries and zero structured-arm fabrication. |
| Beyond-context history or missing decisive facts | Unknown | None of R0–R2 changes evidence or provides retrieval/compression. |

Do not route to R1 or R2 from the present evidence. Any future exception must be established by a new, sensitivity-valid preregistered study.

## What the Existing Pilot Actually Shows

The deterministic [feature audit](EXPERIMENTS/v1-feature-audit.json) found that Toy dual, Toy mac, VLIW chain, and VLIW slot share the exact same current routing signature: four valid events, two configuration dimensions, one site, one idea, one mixed-outcome group, and six one-condition-different pairs. Nevertheless, their exact AUC winners were `R0`, `R0`, `R2`, and `R1`.

| History | Exact winner | Practical best set within 0.25 | What can be concluded |
|---|---|---|---|
| Toy dual | R0 | R0, R1 | R2 was materially worse in this block. |
| Toy mac | R0 tie-break | R0, R1, R2 | No useful separation. |
| VLIW chain | R2 | R2 | Large block-level R2 outcome, mechanism unresolved. |
| VLIW slot | R1 | R1 | Large block-level R1 outcome, mechanism unresolved. |
| ECDSA A/B | Tie | R0, R1, R2 | The task supplied no treatment information. |

This collision proves that current history-only features cannot route these blocks. It does **not** prove that routing is impossible. A useful router also needs treatment-blind task/actionability features: feasible experiment count, remaining headroom, source-derived solution strength, evaluation noise, remaining budget, and whether the indexed distinction can change the next action.

The VLIW trace audit weakens a causal story. All 18 sessions read the view, but no arm cited a concrete prior score. Most sessions independently derived the same 1,200-cycle target from the checker. Every VLIW round ended failed with zero recorded development evaluations, so the sealed terminal artifact—not a verified iterative handoff—produced the observed score variation. The outcomes remain real pilot outcomes, but they do not identify representation-specific reasoning.

## Next Research Boundary

That blinded decision probe is complete. Its controls passed and its mechanism gates failed, so the frozen rule says not to fund a routed R0/R1/R2 full-chain study.

The next legitimate treatment must change something material: scalable retrieval, compression, narrative state, graph traversal, executable schema, or a harder evidence-access regime. It must be tested as a new claim rather than relabelling the failed R1/R2 router.

The current claim is: **R0 is supported for small fully readable histories; flat joined rows are supported for call-bound positive exact-receipt lookup. No universal representation is supported.**

The access-axis study is documented in the [task-to-representation taxonomy](representation-taxonomy.md) and [Atlas access probe](access-probe/v2-results.md). It changes the policy outside the R0/R1/R2 in-context domain: flat joins beat raw 11–0 with one tie, while flat-plus-brief and flat tied overall. It does not rehabilitate R1 or R2.
