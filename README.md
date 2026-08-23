# Yukon-KG Handoff MVE

Requirements: Bun, Rust/Cargo, Git, the Codex CLI authenticated on this machine, and access to `gpt-5.3-codex-spark`.

```bash
bun run mve -- preflight
bun run mve -- run
bun run mve -- resume <run-id>
bun run mve -- report <run-id>
```

`preflight` checks the clean Codex profile, live context budget, model and tool events, blocked agent network, pinned source commits, duplicate square scorer, and sealed positive control. It also records the host prompt/MCP configuration as a diagnostic; admission is based on the isolated worker invocation, which ignores user config and rules. `run` performs the four calibration blocks, freezes the powered sample size, and runs the matched confirmation. Long runs are idempotently resumable.

All generated prompts, events, source artifacts, diffs, scores, timing, and reports live under `.runs/h1-h2/<run-id>/` and are ignored by Git.

Reports use four claim states:

- `SUPPORTED`: corrected statistical and 0.5% practical-effect gates both pass.
- `NOT_SUPPORTED_AT_MDE`: the simultaneous upper bound is below 0.5%.
- `INCONCLUSIVE_AT_CAP`: the frozen experiment cannot decide.
- `INVALID`: isolation, provenance, budget, or scorer integrity failed.

The first calibration block is an apparatus pilot, not a causal result. A live Yukon strategy court is eligible only when the powered `D > A` product gate is `SUPPORTED`.
