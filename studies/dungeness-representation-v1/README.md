# Dungeness Knowledge-Representation Study

## Outcome

The first-model pilot is complete. It did **not** establish a universal best representation. At pilot resolution, `R0`, `R1`, and `R2` are the statistically indistinguishable best set; `R0` is the operational default because it is the simplest member, not because it was shown to be superior.

The structured arms produced positive task-equal point estimates, but their 95% intervals included zero and their gains were concentrated in VLIW:

| Contrast | Progress-AUC estimate | 95% interval | Wins | Final noninferior? |
|---|---:|---:|---:|---:|
| R1 − R0 | 1.079 | [−0.001, 4.316] | 1/6 | Yes |
| R2 − R0 | 1.858 | [−0.536, 5.612] | 2/6 | No |

ECDSA tied across every arm. Toy ISA was neutral to slightly worse under structure. R1 improved one VLIW history and R2 improved the other. This supports investigating a task-conditioned representation policy, but not claiming that structured state is generally better.

The formal report is in [`results/pilot-summary.md`](results/pilot-summary.md). The immutable derived evidence is [`research/EXPERIMENTS/v36-result-freeze.json`](research/EXPERIMENTS/v36-result-freeze.json).

## What was tested

The causal question was whether deterministic organization of equal verified evidence changes outer-verified progress per fixed budget:

```text
same verified history
→ R0 / R1 / R2
→ same agent, task, candidate, tools, prompt, and total budget
→ three fresh research sessions with two verified handoffs
→ sealed five-point progress curve
```

- `R0`: chronological canonical ledger.
- `R1`: frontier plus condition-indexed map.
- `R2`: R1 plus mechanically identified unresolved comparisons.

Yukon compiled byte-identical canonical `ResearchEvent` atoms into all three views; only `index.md` changed. Dungeness executed six paired task × history blocks—two each for ECDSA, Toy ISA, and VLIW—using 18 GPT-5.6 Sol chains through OpenRouter. The primary outcome was task-normalized trapezoidal progress-AUC at 0%, 25%, 50%, 75%, and 100% of budget.

## Evidence quality

- 18/18 active chains and 54/54 fresh model sessions completed.
- All failures were classified before treatment labels were joined.
- 18 prior apparatus-invalid cells remain retained as administrative failures with explicit replacements.
- Apparatus gates passed with zero protocol violations.
- 43/43 development evaluations were valid numeric results.
- 89/90 outer milestones clean-verified; the one failure remained a treatment outcome.
- The first-model chains cost `$37.412034`.
- The hard `$500` ledger conservatively reports `$103.189752` committed, including `$30` of stale fail-closed reservations.
- Final validation passed 184 Dungeness, 77 gateway, and 119 Yukon tests with two intentional skips, plus public-data verification.

The preregistered Kimi gate required at least four wins in six blocks plus final noninferiority. R1 won one block; R2 won two and failed final noninferiority. Kimi replication and confirmation were therefore not run.

## Reserve qualification

The protocol allowed one balanced extra history per task if the six-block result was inconclusive. Toy ISA and VLIW reserve histories passed deterministic model-free qualification. A natural ECDSA reserve history clean-verified but required 46,825 tokens in R0 against the frozen 32,000-token limit. A smaller synthetic ECDSA probe failed correctness. Launching only the two successful task families would have been a post-hoc unbalanced extension, so no reserve model call was made.

## Decision and next study

- **Decision:** `PILOT_INCONCLUSIVE`; no universal winner.
- **Supported set:** R0, R1, and R2 at this pilot's resolution.
- **Default:** R0 by simplicity.
- **Do not infer:** equivalence, proof that R0 is best, or proof that structure is useless.
- **Next test:** a new preregistered, separately authorized study of a conditional policy on a larger license-clear task pool with treatment-blind informativeness gates.

The post-pilot conditional-policy investigation is complete. Its sensitivity-valid decision probe found R0 48/48, R1 48/48, and R2 47/48 while structured views consumed more tokens. Both preregistered mechanism gates failed, so the conditional router was rejected and R0 remains the only supported operational arm. See [`task-policy/decision-probe/results-v3.md`](task-policy/decision-probe/results-v3.md). This follow-up does not alter the frozen pilot outcomes; it narrows their interpretation.

A later access-axis probe found a narrow, replicated exception outside that small in-context regime. On positive exact-duplicate lookup over the 949-submission Atlas archive, flat joined attempt rows recovered 11/12 exact receipts across GPT-5.6 Sol and Kimi K3 versus raw records at 0/12; flat-plus-brief also scored 11/12, and the pointer control scored 12/12. Use R0 for small readable histories and flat joins for large exact multi-record lookups. See [`task-policy/access-probe/v2-results.md`](task-policy/access-probe/v2-results.md). V1+v2 added `$2.57477166`; known study-wide committed/model spend is `$112.26915692` under the `$500` ceiling.

## Audit boundary and known risk

The frozen operative preregistration is [`preregistration-v36.md`](preregistration-v36.md); it remains unchanged after treatment. `protocol.yaml` records the result state and input hashes. Dungeness run records and content-addressed artifacts are authoritative; this directory links and summarizes rather than duplicating execution logs.

AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed

## Planned → observed → interpretation → decision → next test

- **Planned:** isolate deterministic organization while holding evidence and resources fixed.
- **Observed:** positive structured-arm means came from different VLIW histories; ECDSA tied and Toy ISA did not improve.
- **Interpretation:** any benefit is conditional on task or history, not universal in this sample.
- **Decision:** retain the simplest arm until a conditional policy is tested.
- **Next test:** freeze a broader informative task pool and power it for the same 0.25 meaningful-gain target before spending.
