# Yukon-KG Handoff MVE

Requirements: Bun, Git, the Codex CLI authenticated on this machine, and access to `gpt-5.6-luna`.

```bash
bun run mve -- preflight
bun run mve -- run
bun run mve -- resume <run-id>
bun run mve -- report <run-id>
```

`preflight` checks the isolated Codex profile, model identity, blocked network, duplicate scoring, and a paper-derived Mouselab planning task. An exact dynamic program supplies the mathematically best inspection and the expected loss from every other choice. `run` performs four calibration blocks, freezes the number of matched confirmation blocks between 8 and 24, and then completes the confirmation. Long runs are idempotently resumable.

All generated prompts, events, sealed planning problems, scores, timing, and reports live under `.runs/mouselab-handoff/<run-id>/` and are ignored by Git.

Reports use four claim states:

- `SUPPORTED`: corrected statistical inference passes and the mean reduction in decision loss is at least one expected reward point.
- `NOT_SUPPORTED_AT_MDE`: the simultaneous upper bound is below one expected reward point.
- `INCONCLUSIVE_AT_CAP`: the frozen experiment cannot decide.
- `INVALID`: isolation, provenance, budget, or scorer integrity failed.

The ECDSA square experiment remains available as `bun run mve:ecdsa -- ...`; it is retained only for reproducing the older result. A live Yukon search is eligible only when the powered Mouselab comparison shows that the complete neutral handoff with an explicit budget reduces decision loss against the continuing session.
