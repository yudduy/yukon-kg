# Dungeness Knowledge-Representation Pilot: Final Results

> Final pilot decision: **no universal winner was established**. At this pilot's resolution, `R0`, `R1`, and `R2` form the statistically indistinguishable best set. Use `R0` as the operational default because it is the simplest member of that set—not because it was proved superior.

## Question and design

The experiment asked whether deterministic organization of the same verified research evidence improves autonomous research progress. It compared:

- `R0`: chronological canonical ledger;
- `R1`: frontier plus condition-indexed map;
- `R2`: R1 plus mechanically identified unresolved comparisons.

Each arm received byte-identical `ResearchEvent` atoms; only `index.md` differed. The first-model pilot paired all three arms within six task × history blocks: two ECDSA histories, two Toy ISA histories, and two VLIW histories. Each of the 18 chains used GPT-5.6 Sol through OpenRouter for three fresh sessions under the same task, candidate, tools, prompt, and total budget. A sealed evaluator scored artifacts at 0%, 25%, 50%, 75%, and 100% of budget. The primary outcome was task-normalized outer-verified progress-AUC.

All failures were classified while treatment labels remained hidden. The final analysis retained 18 earlier administrative failures with explicit replacement links and contained 18 complete active cells. One active VLIW milestone failed clean verification and was treated as a real treatment failure. Apparatus gates passed, protocol violations were zero, and the analyzer used 100,000 task-then-history hierarchical bootstrap draws.

## Primary results

Units are meaningful gains, where one gain equals 10% of that task's official baseline-to-reference gap.

| Contrast | Task-equal AUC difference | 95% interval | Arm wins | Final-score difference | Final noninferior? |
|---|---:|---:|---:|---:|---:|
| R1 − R0 | 1.079 | [−0.001, 4.316] | 1/6 | 1.726 | Yes |
| R2 − R0 | 1.858 | [−0.536, 5.612] | 2/6 | 2.062 | No |
| R2 − R1 | 0.779 | [−1.247, 4.721] | — | 0.336 | No |

Both structured arms had positive point estimates, but every AUC interval included zero. The means were driven by a small number of VLIW outcomes rather than broad wins.

| Task / history | R0 AUC / final | R1 AUC / final | R2 AUC / final |
|---|---:|---:|---:|
| ECDSA archive A | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| ECDSA archive B | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| Toy ISA mac | 8.088 / 9.244 | 8.088 / 9.244 | 8.083 / 9.237 |
| Toy ISA dual | 9.021 / 10.310 | 9.018 / 10.306 | 7.954 / 9.090 |
| VLIW slot | −2.023 / −3.237 | 4.451 / 7.122 | 1.781 / 0.000 |
| VLIW chain | −1.619 / −2.590 | −1.619 / −2.590 | 6.799 / 7.770 |

The pattern is task-conditional: ECDSA was completely uninformative, Toy ISA was neutral to slightly worse under structure, R1 won one VLIW history, and R2 won the other. This rejects a universal-winner interpretation.

## Secondary outcomes and cost

| Arm | Task-equal AUC | Final gain | Model spend | Model tokens | Valid dev evals | View-token proxy | Chains reaching one gain |
|---|---:|---:|---:|---:|---:|---:|---:|
| R0 | 2.244 | 2.288 | $12.536 | 773,310 | 14/14 | 193,368 | 2/6 |
| R1 | 3.323 | 4.014 | $12.066 | 719,864 | 15/15 | 181,841 | 3/6 |
| R2 | 4.103 | 4.350 | $12.810 | 769,140 | 14/14 | 206,245 | 4/6 |

The view-token figures are the frozen conservative `ceil(UTF-8 bytes / 2)` proxy summed over all 18 sessions per arm; divergent post-fork histories explain why R1 was not always larger than R0. Across all arms, 43/43 recorded development evaluations were valid numeric results. Outer verification was valid for 89/90 milestones. The arms produced similar outer candidate diversity: four chains per arm changed the starting artifact, with 5, 4, and 5 distinct changed hashes for R0, R1, and R2 respectively.

The 18 completed v36 chains cost **$37.412034**. The hard study ledger records **$73.189752** settled actual spend plus **$30** in ten fail-closed stale reservations, or **$103.189752 committed**, under the $500 ceiling. The stale reservations are conservatively retained rather than silently released.

## Frozen decision rules

The Kimi replication gate required a structured arm to improve paired mean AUC by at least 0.25, win at least four of six blocks, and preserve final-score noninferiority. R1 won 1/6 blocks. R2 won 2/6 and failed final noninferiority. Therefore Kimi replication was not run. Confirmation was never automatic and was not started.

Because the pilot was inconclusive, the frozen protocol permitted investigation of one additional history per task. Toy ISA and VLIW reserve histories passed all model-free gates and compiled deterministically. The natural ECDSA reserve history clean-verified but its smallest R0 view required 46,825 tokens against the 32,000-token limit. A smaller synthetic ECDSA probe failed correctness with five classical mismatches and four phase-garbage batches. A partial two-task extension would break the balanced frozen design, so the extension stopped before any paid model call.

## Interpretation

The evidence does not show that deterministic structure is generally better than a chronological ledger. It also does not show that structure is useless: the two large positive signals occurred on different VLIW histories, suggesting that representation may interact with task structure or research history. The publishable pilot conclusion is therefore narrower:

1. `R0`, `R1`, and `R2` are statistically indistinguishable at this sample size.
2. No universal deterministic representation should be claimed.
3. `R0` is the justified default by simplicity.
4. Any next study should test a preregistered conditional policy on more informative task families, not rerun this sample until significance appears.

This is a pilot decision, not a confirmatory equivalence result. Only six blocks and one consumer model were observed; ECDSA supplied no arm variation; the wide intervals include meaningful benefit and harm. AutoLab-derived evidence also has a publication constraint:

> AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed

## Audit trail

- Primary analysis: `v36-pilot-analysis.json`, SHA-256 `364df0c9…5f182`.
- Blinded export: SHA-256 `69a08cd7…3437a`.
- Pre-unblinding failure classifications: SHA-256 `ebb82c9c…038d`.
- Host assignment: SHA-256 `3387add7…bc8c1`.
- Task references: SHA-256 `e9587ac2…138b`.
- Derived result freeze: `v36-result-freeze.json`, SHA-256 `e9f4b0e7…73633`.
- Deterministic freeze generator: `finalize-v36-results.py`, SHA-256 `5f16e344…86d7d`.

Dungeness run records, candidate hashes, verifier artifacts, and content-addressed views remain the audit authority. The report summarizes them without replacing them.

Post-result validation passed 184 Dungeness core tests, 77 gateway tests, and 119 Yukon tests with two intentional historical skips and zero failures. Public-data hash verification passed for both indexed ECDSA releases. A fresh derivation reproduced the result-freeze bytes and SHA-256 exactly.

## Planned → observed → interpretation → decision → next test

- **Planned:** compare R0/R1/R2 under identical evidence and budget, then replicate only if a structured arm passed all frozen gates.
- **Observed:** all 18 chains completed; structured-arm gains were concentrated in VLIW, intervals crossed zero, win counts were 1/6 and 2/6, and R2 failed final noninferiority.
- **Interpretation:** the pilot supports task-conditioned heterogeneity, not a universal representation advantage.
- **Decision:** report `PILOT_INCONCLUSIVE`; retain all three arms as the indistinguishable set; default to R0; do not run Kimi or confirmation.
- **Next test:** only after a new preregistration and authorization, evaluate a conditional representation policy on a larger, license-clear, treatment-blind task pool with enough informative blocks for the 0.25-unit target.
