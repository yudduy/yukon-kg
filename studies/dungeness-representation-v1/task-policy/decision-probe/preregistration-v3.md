# Dungeness Representation Decision Probe v3: Preregistration

## Reason for Versioning

Version 2 stopped at 116/192 responses after one Kimi call returned no text on its initial request and both frozen retries. It also produced two malformed JSON responses, one on the pointer control and one on a core arm. Because the paired matrix was incomplete, no v2 treatment contrast is interpreted.

Version 3 changes only response transport:

- keep reasoning effort `low`;
- retain reasoning text as a fallback instead of excluding it;
- remove OpenRouter JSON-object mode;
- retain the 2,048-token completion allowance;
- permit five administrative retries for a no-response provider failure.

The deterministic parser already extracts the final valid answer object from either normal content or reasoning. The visible prompt still demands the exact same two-key JSON object. Cases, atoms, indexes, models, oracles, scoring, gates, concurrency, randomization, and the `$12` cap are unchanged.

This repair follows the official [OpenRouter reasoning-token contract](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), which allows controlling effort and whether reasoning is excluded. Version 2 showed that excluding reasoning can leave a Kimi response with neither final content nor a parseable fallback.

## Calibration and Gates

Before the v3 freeze, run one separate-seed Kimi pointer-control calibration. It must produce a parseable, correct, exactly grounded answer in either `content` or `reasoning`. It is excluded from outcomes.

The calibration passed: final content was parseable, the action and evidence were exactly correct, and OpenRouter reported 402 reasoning tokens within a 446-token completion. Cost: `$0.0139872`. Artifact: `v3-calibration.json`, SHA-256 `2ef73e654043f15fb700d07821b039a8a0ec3860fd3db0e7490f8155a831dd2d`.

All scientific gates remain frozen as in v1/v2:

- positive-control accuracy at least 90% separately for both models;
- `R1−R0 ≥ 0.15` on frontier decisions and nonnegative in each model;
- `R2−R1 ≥ 0.15` on comparison decisions and nonnegative in each model;
- only a complete 24-case × 4-arm × 2-model matrix may be interpreted.

Successful but malformed or wrong responses remain real zeros. Provider failures before any text are retained and retried at most five times. If v3 cannot complete or fails sensitivity, stop the decision-probe line rather than iteratively tuning on arm outcomes.
