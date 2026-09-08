# State: v36 pilot complete

## Current decision

- Pilot decision: `PILOT_INCONCLUSIVE`.
- Universal winner: none established.
- Statistically indistinguishable set at pilot resolution: R0, R1, R2.
- Operational default: R0 by simplicity, not demonstrated superiority.
- Conditional signal: structure helped only VLIW, with R1 and R2 winning different histories.
- Kimi replication: frozen gate failed; not run.
- Confirmation: not authorized and not run.

## Verified evidence

- 6 blocks, 18 active chains, 54 model sessions.
- R1−R0 AUC: 1.079, 95% interval [−0.001, 4.316], 1/6 wins.
- R2−R0 AUC: 1.858, 95% interval [−0.536, 5.612], 2/6 wins; final noninferiority failed.
- 43/43 valid numeric development evaluations.
- 89/90 valid outer milestones; one retained treatment failure.
- v36 completed-chain spend: `$37.412034`.
- Hard ledger: `$103.189752` committed under `$500`, including `$30` of stale fail-closed reservations.
- Result freeze: `research/EXPERIMENTS/v36-result-freeze.json`, SHA-256 `e9f4b0e7…73633`.

## Reserve gate

Toy ISA and VLIW each qualified one model-free reserve history. The natural ECDSA reserve required 46,825 R0 tokens against the 32,000 limit; a smaller synthetic candidate failed clean correctness. A partial extension would be unbalanced, so it stopped with zero model calls.

## Planned → observed → interpretation → decision → next test

- **Planned:** decide whether R1 or R2 merits replication over R0.
- **Observed:** neither reached four wins; R2 also failed final noninferiority.
- **Interpretation:** positive means are task-conditional and too sparse for a universal claim.
- **Decision:** complete the pilot report, retain R0 as default, and stop paid work.
- **Next test:** only a newly preregistered conditional-policy study on a larger license-clear task pool.

Known risk: AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed
