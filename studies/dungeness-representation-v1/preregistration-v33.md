# Dungeness Representation Pilot v33 Preregistration

## Status

This document is frozen before any v33 model call. v32 is excluded in full
because its first paid ECDSA handoff exposed a metric-identity mismatch between
the historical plan and the live task. No v32 chain completed all three rounds;
none of its outcomes may inform representation, task, history, or exclusion
choices. Its $0.559763 model spend remains charged to the $500 study ceiling.

## Fixed scientific design

v33 retains the qualified six blocks, R0/R1/R2 renderers, three-round chain
protocol, model route, prompts, task budgets, and analysis rules from v32. It
changes only:

1. the ECDSA history contract from the descriptive label
   `qubit-Toffoli product` to the runtime verifier identity `ecdsafail_score`;
2. the experiment identity, randomization seed, and opaque run IDs; and
3. a mandatory model-free append-and-render gate for every initial view.

The 18 chains remain:

```text
3 tasks x 2 histories x 3 representations x GPT-5.6 Sol
```

Each chain retains aggregate caps of $9, 600,000 model tokens, 90 minutes, and
12 development evaluations across three fresh sessions. The v33 first-model
increment is capped at $162. Total study model spend remains capped at $500,
with $25.787305 committed before v33 treatment.

## Mandatory release gates

- create a new immutable ECDSA verification plan and history bank; never mutate
  the v28 plan, bank, exports, views, or candidate artifacts;
- require every clean `score.json` metric to equal the plan metric identity;
- reject export from any bank whose target metric disagrees with its retained
  clean score artifacts;
- compile both corrected ECDSA histories twice and prove byte determinism,
  source parity, cutoff sealing, exact atom parity, and context fit;
- append a task-matched trusted event to every one of the 18 initial views and
  successfully re-render it with the same arm, without publishing the probe;
- pass all Dungeness, gateway, and Yukon tests and fresh native/external Docker
  smokes;
- reproduce all six treatment permutations once, with no treatment or block
  labels in run IDs, prompts, task metadata, or paths;
- independently revalidate a fresh content-addressed freeze manifest;
- confirm the live model route and price bounds and zero active reservations.

Any failure stops v33 before treatment. A failure after model contact excludes
the entire affected version before unblinding and requires fresh identities.

## Known external-task risk

AutoLab tasks: no declared license as of commit
7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only,
not redistributed.
