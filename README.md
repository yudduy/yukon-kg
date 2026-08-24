# Yukon-KG Handoff MVE

Requirements: Bun, Rust/Cargo, Git, the Codex CLI authenticated on this machine, and access to `gpt-5.3-codex-spark`.

```bash
bun run mve -- preflight
bun run mve -- run
bun run mve -- resume <run-id>
bun run mve -- report <run-id>
```

`preflight` checks the isolated Codex profile, model identity, blocked network, pinned source, duplicate scorer, sealed positive control, and the complete difficulty landscape for the search task. `run` first performs one apparatus pilot. Only an informative pilot proceeds to three more calibration blocks, a frozen sample size, and matched confirmation. Long runs are idempotently resumable.

All generated prompts, events, source artifacts, diffs, scores, timing, and reports live under `.runs/h1-h2/<run-id>/` and are ignored by Git.

Reports use four claim states:

- `SUPPORTED`: corrected statistical and 0.5% practical-effect gates both pass.
- `NOT_SUPPORTED_AT_MDE`: the simultaneous upper bound is below 0.5%.
- `INCONCLUSIVE_AT_CAP`: the frozen experiment cannot decide.
- `INVALID`: isolation, provenance, budget, or scorer integrity failed.

The pilot also has a task check: `TASK_TOO_EASY` means every procedure found the known optimum, `TASK_TOO_HARD` means none achieved the preregistered 0.5% improvement, and `NO_CONDITION_SEPARATION` means the procedures tied. These outcomes require a new task and cannot be used as evidence for or against the handoff.

A live Yukon strategy court is eligible only when the powered comparison shows that the complete blinded handoff with an explicit budget outperforms the continuing incumbent session.
