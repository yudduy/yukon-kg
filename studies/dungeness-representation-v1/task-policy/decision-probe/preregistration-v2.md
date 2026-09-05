# Dungeness Representation Decision Probe v2: Preregistration

## Reason for Versioning

Version 1 stopped after 133/192 responses because Kimi K3's positive-control accuracy became mathematically unable to reach the frozen 90% sensitivity gate. Five of 17 Kimi pointer-control calls used the entire 1,024-token completion allowance for exposed reasoning and returned no JSON. GPT-5.6 Sol was 20/20 on the same control. Under the v1 rule, no core v1 contrast is interpreted.

Version 2 changes only the generation apparatus needed to produce an observable answer:

- request OpenRouter reasoning effort `low`;
- exclude reasoning text from the response;
- allow at most 2,048 completion tokens;
- execute four preregistered calls concurrently to reduce provider latency.

The visible system message, task packets, case generator, oracle, R0/R1/R2 indexes, factor design, models, scoring, practical margins, and sensitivity threshold are unchanged. The same setting is applied to every arm and both models. OpenRouter's [reasoning-token interface](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) documents `effort` and `exclude` as request controls.

## Calibration Gate

Before freezing v2, one Kimi positive-control packet was run solely as apparatus calibration. It returned final `content`, zero reported reasoning tokens, valid exact JSON, the correct action, and exact oracle evidence. Cost: `$0.02675295`. Artifact: `v2-calibration.json`, SHA-256 `62209ffc5cbe05ba89f77e42d94f482d01af9cd6a317a410c1f1b2228a229b8d`.

This calibration packet uses a separate seed and is excluded from all v2 outcomes.

## Frozen Design and Outcomes

The complete design, outcomes, and gates remain those in `preregistration.md`:

- 24 cases crossing selection load, comparison opportunity, and comparison actionability;
- three equal-evidence core arms and one separate answer-locator sensitivity control;
- GPT-5.6 Sol and Kimi K3;
- exact action accuracy primary; exact event-grounded accuracy companion;
- paired `R1−R0` on frontier cases and `R2−R1` on comparison cases;
- at least 0.15 pooled selective improvement, nonnegative in both models;
- at least 90% positive-control accuracy separately in each model.

Version 2 has a `$12` direct-model cap with a conservative `$0.50` reservation per in-flight call. Provider errors before a successful response receive at most two retained retries. Successful but invalid or wrong output remains a real zero. If the sensitivity gate fails again, stop; do not repair and reuse v2 outcomes as evidence.

No v1 treatment result informed the v2 case generator, oracle, routing features, thresholds, or prompts. The only v1 information used is the predeclared sensitivity failure signature: reasoning consumed the response allowance before JSON.
