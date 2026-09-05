# Task-to-Representation Taxonomy

## The picture to carry

A representation is an index for a future operation. The useful classification is therefore not “cryptography task” versus “compiler task,” but:

```text
observable research state
→ next decision or query
→ bottleneck
→ cheapest representation that removes that bottleneck
```

The representation is worthwhile only when its saved search, reasoning, and repeated work exceed its construction, reading, omission, and distortion costs.

## Current classification

| Observable task state | Required operation | Candidate representation | Current evidence |
|---|---|---|---|
| Complete, readable history; sequence or recency matters | Reconstruct what happened and continue | Chronological canonical ledger (`R0`) | **Dungeness-supported.** R0 was perfect and cheapest in the 10–32-event decision probe. |
| Thousands of records; the answer requires joining attempt, outcome, and provenance | Exact filter, duplicate lookup, or receipt recovery | Flat normalized attempt table | **Agent-supported for positive lookup.** Flat recovered 11/12 exact receipts across two models versus raw 0/12, with 56% fewer queries, 44% fewer returned bytes, and no fabrication. |
| Many attempts must be counted, compared, or summarized by idea/condition | Aggregate over a known group | Deterministic evidence brief or materialized aggregate | **Still untested for aggregation.** On exact lookup, brief and flat both scored 11/12; the brief produced one win and one loss and cost more. Derived vocabulary can change retrieval ranking, but not reliably. |
| The answer depends on paths among entities, components, parents, or prerequisites | Multi-hop relational traversal | Typed graph with source-grounded edges | **External evidence only.** Engrama beat full context only on cross-space reasoning, while losing globally; this is evidence for specialization, not universal graph superiority. |
| Many topics drift over time and the agent must first choose a region, then details | Coarse-to-fine retrieval | Hierarchical topic/idea tree | **External evidence only.** FluxMem assigns hierarchies to topic-diverse interactions and graphs to relational ones, but its benchmarks are conversational rather than autoresearch. |
| The same goal shape recurs and prior successful steps transfer | Reuse a procedure | Versioned playbook, skill, or executable recipe | **External evidence only.** Procedural-memory studies report transfer, but also task- and role-specific overfitting. |
| Decisions are governed by exact eligibility, dependency, or budget rules | Validate and compute an admissible action | Executable schema, state machine, or query program | **Untested in Dungeness.** This changes the agent's tool/computation surface and must be a separate treatment. |
| The history exceeds context or relevant evidence is sparse | Find a small evidence subset | Retrieval layer over canonical atoms | **Required future regime.** R0/R1/R2 never tested beyond-context access; long-context retrieval remains difficult even with fewer documents. |
| Memory is sparse, the task is early, or no historical distinction can change an action | Orient or act without retrieval | No-op or R0 | **Supported default.** Added structure cannot create headroom and consumed extra tokens in the decision probe. |
| There are many matched, actionable comparisons hidden in a large history | Select a discriminating experiment | Comparison table or factorial matrix | **Rejected at small scale.** R2 added cost and lost one case at 10–32 events. The Atlas result shows the missing trigger: demonstrated access/join burden, not merely the presence of comparisons. |

The current empirically supported router is therefore only two branches:

```text
small, fully readable history and next-action reasoning → R0 chronology
large archive plus exact multi-record receipt lookup → flat joined attempts
anything else → unproven; test the operation before adding structure
```

## The classification features

Record these before assigning a representation:

1. **Scale:** atoms, tokens, and fraction relevant to the next decision.
2. **Query shape:** temporal, exact lookup, aggregate, multi-hop, coarse-to-fine, constraint, or procedure reuse.
3. **Join burden:** how many records and identifiers must be combined for one grounded answer.
4. **Recurrence:** likelihood that the same query or goal shape returns.
5. **Actionability:** whether finding the distinction can change the next feasible experiment.
6. **Uncertainty:** verifier noise, conflicting outcomes, and missing controls.
7. **Fidelity tolerance:** whether lossy abstraction is safe or exact provenance must remain visible.
8. **Binding budget:** tool calls, returned bytes, prompt tokens, wall time, or model cost.

These features define a contextual policy. A subject label does not.

## What not to conflate

Five independent design axes often get called “the representation”:

- topology: sequence, table, tree, or graph;
- abstraction: raw atoms versus compressed summaries;
- access: full exposure versus retrieval;
- executability: prose versus machine-checkable state;
- intervention: always present versus selectively injected.

Changing several at once can improve a system, but it cannot identify which mechanism helped. Dungeness should test one axis at a time and escalate to full research chains only after a sensitivity-valid mechanism probe succeeds.

## Sources and transfer boundary

- [FluxMem](https://arxiv.org/abs/2602.14038) supports context-dependent selection among linear, graph, and hierarchical memories.
- [EngramaBench](https://arxiv.org/abs/2604.21229) finds full context best overall but graph memory best on its cross-space subset.
- [Memory as a Controlled Process](https://arxiv.org/abs/2607.13591) supports making retrieval, plan reuse, consolidation, and no-op contextual actions.
- [Remember When It Matters](https://arxiv.org/abs/2607.08716) reports that selective intervention beats always-on exposure on long-horizon action benchmarks.
- [BRIGHT](https://arxiv.org/abs/2407.12883) shows that reasoning-intensive retrieval can remain hard even after the document pool is reduced.

These papers motivate mechanisms and features. None establishes the best knowledge representation for autonomous code research; that is the claim this study must test.
