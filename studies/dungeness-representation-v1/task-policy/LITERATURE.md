# Related Evidence

## Primary Sources

| Work | Relevant result | Transfer to Dungeness | Boundary |
|---|---|---|---|
| [FluxMem / Choosing How to Remember](https://arxiv.org/abs/2602.14038) | Linear memory favors temporal queries, graphs relational/multi-hop queries, and hierarchies coarse-to-fine topics; a learned selector uses interaction features and downstream reward. | Supports choosing structure from the expected query and observed state. | Dialogue/QA memory, not autonomous code research or equal-evidence indexes. |
| [Memory as a Controlled Process](https://arxiv.org/abs/2607.13591) | Treats retrieval, plan injection, re-retrieval, consolidation, and no-op as contextual actions using phase, stuckness, memory size, and plan state. | Supports a state-conditioned policy and an explicit no-op/simple-view option. | Changes memory operations, not just deterministic organization. |
| [Remember When It Matters](https://arxiv.org/abs/2607.08716) | Selective intervention is more balanced than always-on memory; useful state differs between debugging and policy/procedure benchmarks. | Supports measuring whether memory should intervene at a handoff. | Rich memory content and different agent environments. |
| [Continual Harness](https://arxiv.org/abs/2605.09998) | Refines an agent harness from observed failure signatures such as loops, stalls, and tool failures. | Failure state can be a routing feature in later treatments. | The harness and information change, so it is outside `R0`–`R2`. |
| [Measuring Autonomous AI Research](https://www.primeintellect.ai/blog/measuring-autonomous-research) | Productive research agents retest borderline results, revisit negatives after recipe changes, and manage variance across seeds. | Replication need, noise, and recipe changes should determine whether comparison indexes are actionable. | Observational evidence from a broader research system. |
| [Auto-nanoGPT](https://www.primeintellect.ai/auto-nanogpt) | A shared scratchpad aids recovery but may reinforce local-search lock-in and weak interaction reasoning. | Richer memory is not automatically better; branch and interaction structure must change decisions. | Narrative, agent-written memory changes the information itself. |

## Synthesis

The literature converges on one point: memory organization is useful when it matches the operation the agent must perform. It does not supply a ready-made classifier for Dungeness. Our equal-atom design is stricter: it isolates access paths while the cited systems often change memory content, retrieval, or the agent harness.

The transferable variables are therefore structural rather than semantic labels: temporal demand, branch count, relation/comparison density, actionability, noise, research phase, and remaining budget. These are candidate covariates to preregister—not evidence that the proposed router already works.

