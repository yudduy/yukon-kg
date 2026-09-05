# Representation Decision Probe v3: Final Results

## Decision

`R0` strictly dominates `R1` and `R2` for the tested one-turn decision states. The positive-control gate passed, but both preregistered selective-mechanism gates failed. Do **not** build or fund a Dungeness router that selects R1 for frontier states or R2 for comparison states from this evidence.

This overturns the earlier working classification for the current implementations. It does not establish that R0 is universally best or that richer memory systems cannot help.

## Design

The complete v3 matrix crossed three hidden binary factors—selection load, comparison opportunity, and comparison actionability—using three deterministic variants. Twenty-four cases were evaluated under R0, R1, R2, and a separate answer-locator sensitivity control with GPT-5.6 Sol and Kimi K3:

```text
24 cases × 4 arms × 2 models = 192 responses
```

Core arms received byte-identical task rules, compact event atoms, action options, model settings, and prompts. Only the hidden index differed. Cases contained 10 or 32 events and remained within the original 32k deterministic view allowance. The oracle followed a frozen priority: actionable matched comparison, otherwise best branch frontier, otherwise most recent valid candidate.

## Primary Results

| Arm | GPT correct / 24 | Kimi correct / 24 | Combined | Mean prompt tokens | Direct cost |
|---|---:|---:|---:|---:|---:|
| R0 | 24 | 24 | **48/48** | 4,435 | $0.530699 |
| R1 | 24 | 24 | **48/48** | 5,292 | $0.583216 |
| R2 | 24 | 23 | **47/48** | 5,980 | $0.689136 |
| Pointer control | 24 | 24 | **48/48** | 4,471 | $0.470020 |

Grounded accuracy equalled action accuracy in every arm. All 192 responses were syntactically valid. There were zero administrative retries.

| Preregistered contrast | Pairs | Accuracy difference | Wins / losses / ties | Gate |
|---|---:|---:|---:|---|
| R1 − R0 on frontier decisions | 18 | 0.000 | 0 / 0 / 18 | **Fail** |
| R2 − R1 on comparison decisions | 12 | −0.083 | 0 / 1 / 11 | **Fail** |
| R2 − R0 on comparison decisions | 12 | −0.083 | 0 / 1 / 11 | Descriptive harm |
| R1 − R0 on chronology decisions | 18 | 0.000 | 0 / 0 / 18 | Specificity tie |
| R2 − R0 on chronology decisions | 18 | 0.000 | 0 / 0 / 18 | Specificity tie |

The practical gate required a target improvement of at least 0.15 and a nonnegative effect in both models. R1 improved neither model. R2 was neutral for GPT and −0.167 on Kimi's comparison cases. Its sole error selected the wrong pair in exactly the state R2 was designed to help.

## Reading Cost

Compared with R0, R1 added approximately 857 prompt tokens per response and R2 added 1,544. R1 increased combined direct cost by 9.9%; R2 increased it by 29.9%. Because R0 was already perfect, the structured views had no accuracy headroom and were strictly worse after reading cost.

The full v3 run used 968,575 prompt tokens, 67,106 completion tokens, and `$2.27307199`. Including the authoritative Dungeness committed ledger, the earlier bounded review, both failed probe versions, and calibrations, known study-wide committed/model spend is `$109.69438526`, below the `$500` ceiling.

## Apparatus History

- v1 stopped at 133/192 because Kimi could no longer pass the 90% answer-pointer sensitivity gate; exposed reasoning consumed the response allowance. Core v1 contrasts are excluded.
- v2 stopped at 116/192 when a Kimi call returned no text on all frozen retries. Its incomplete contrasts are excluded.
- v3 retained low-effort reasoning as a parseable fallback and removed provider JSON mode. Its calibration passed, all 192 calls completed, controls were 48/48, and there were no retries.

The versioning decisions were triggered only by preregistered apparatus signatures, not by core-arm outcomes.

## Interpretation

For explicit next-action decisions over readable 10–32-event histories, chronology already exposes enough evidence for both models to compute the answer. Additional frontier and comparison indexes add tokens but not useful information. Therefore the current operational policy is:

```text
use R0 for every presently tested Dungeness R0/R1/R2 condition
```

The original full-chain pilot's isolated VLIW R1/R2 wins now lack a replicated decision mechanism. They remain valid outcomes but should not motivate a conditional router.

Boundary: this was a synthetic, one-turn, explicit-policy mechanism test. It does not test histories beyond the context limit, absent evidence, learned retrieval, narrative memory, graph traversal, executable schemas, or multi-round full-agent efficacy. Any richer representation is a new treatment and must first beat R0 on a preregistered sensitivity-valid mechanism screen.

## Audit Trail

- Freeze: `v3-freeze.json`, SHA-256 `e1abcefa8262c896d85bcf18383b824a167829797676e1bc850b59aa4fcfda7f`.
- Calibration: `v3-calibration.json`, SHA-256 `2ef73e654043f15fb700d07821b039a8a0ec3860fd3db0e7490f8155a831dd2d`.
- Complete results: `v3-results.json`, SHA-256 `6bb2d04717cd0c2cdd3e048fe407d370646fb1499efd543f4e2567a95a6f038d`.
- Deterministic analysis: `v3-analysis.json`, SHA-256 `7bfe9c82fd91de9a564cd16249eaf3e1240c784bdefe3a4ecc64fd8ad9e328e4`.
- Validation: 125 Yukon tests passed, two intentional skips, zero failures; two independent analyzer writes were byte-identical and matched the embedded analysis.

## Planned → Observed → Interpretation → Decision → Next Test

- **Planned:** require R1 and R2 to improve their targeted decisions by at least 0.15 after a per-model 90% sensitivity gate.
- **Observed:** controls were perfect; R1 tied R0; R2 made the only core error; structured views cost more tokens.
- **Interpretation:** the current indexes do not alter useful decision behavior at this history scale.
- **Decision:** reject the conditional R0/R1/R2 router; retain R0 universally within the tested domain.
- **Next test:** do not escalate these arms to routed full chains. A future study must introduce a materially different representation or a genuinely harder evidence-access regime under a new preregistration.

