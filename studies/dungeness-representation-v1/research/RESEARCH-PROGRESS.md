# Research: Which deterministic knowledge representation best supports autoresearch?

> Status: PILOT COMPLETE — NO UNIVERSAL WINNER  
> Iteration: 30/50 | Last updated: 2026-08-28

## Current understanding

The controlled v36 pilot successfully isolated deterministic organization of equal verified evidence. Eighteen GPT-5.6 Sol chains completed across six paired blocks. The result is not “structured views win.” R1 and R2 had positive task-equal point estimates, but their intervals crossed zero and they won only 1/6 and 2/6 blocks. ECDSA tied entirely, Toy ISA was neutral-to-negative, and the two positive signals appeared on different VLIW histories.

The best supported set is therefore R0/R1/R2 at pilot resolution. R0 is the default by simplicity. The experiment does not establish statistical equivalence, R0 superiority, or the absence of conditional benefit.

## Key numbers

| Contrast | AUC estimate | 95% interval | Wins | Final noninferior |
|---|---:|---:|---:|---:|
| R1−R0 | 1.079 | [−0.001, 4.316] | 1/6 | yes |
| R2−R0 | 1.858 | [−0.536, 5.612] | 2/6 | no |

- Development evaluations: 43/43 valid numeric.
- Outer milestones: 89/90 valid; one treatment failure retained.
- v36 chain spend: `$37.412034`.
- Ledger commitment: `$103.189752` under `$500`.
- Analysis: `results/v36-pilot-analysis.json`, SHA-256 `364df0c9…5f182`.
- Result freeze: `research/EXPERIMENTS/v36-result-freeze.json`, SHA-256 `e9f4b0e7…73633`.

## Final iterations

| Iter | Decision | Evidence | Consequence |
|---:|---|---|---|
| 29 | REPORT | v36 completes 18/18 chains; all primary intervals cross zero | No universal winner |
| 30 | STOP | R1 wins 1/6; R2 wins 2/6 and fails final noninferiority; balanced reserve cannot qualify ECDSA | No Kimi, reserve, or confirmation calls |

## Planned → observed → interpretation → decision → next test

- **Planned:** run the unbiased first-model pilot and apply its frozen replication gate.
- **Observed:** structured-arm improvements were sparse and task-specific.
- **Interpretation:** deterministic organization may interact with task/history, but there is no general effect supported here.
- **Decision:** `PILOT_INCONCLUSIVE`; choose R0 by simplicity and stop.
- **Next test:** a separately authorized conditional-policy study with more informative, license-clear blocks.

Known risk: AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed
