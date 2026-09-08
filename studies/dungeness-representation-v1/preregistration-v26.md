# Version 26 Preregistration: Executable History Bank

## Purpose

Version 26 tests whether a sealed Yukon trajectory can be converted into two
clean-verified, treatment-capable Dungeness histories. It makes no paid model
call and does not authorize R0, R1, or R2 treatment.

The authored selection is
`v26-ecdsa-history-selection.json` (SHA-256
`3958f0800e9f6900424c40daf2feb07581cd171292240066c0c3dc7c09ec3492`).
Yukon binds it to the sealed release as verification plan
`c0547d90897b514f34b425e97871cc1122a6037b2e3e948392babd95ace147ad`.

## Frozen windows

- `ecdsa-archive-a`: events 12–16 of the direct promoted lineage, five events,
  starting score `1,248,309,480`, sealed headroom 2.20 meaningful gains.
- `ecdsa-archive-b`: events 17–23, seven non-overlapping subsequent events,
  starting score `1,237,028,156`, sealed headroom 1.82 meaningful gains.

Event 11 is A's verified base; event 16 is B's verified base. Event 54 is a
verification-only reference and must not enter either agent-visible view. The
windows were selected from public pre-treatment metadata for direct lineage,
context fit, and headroom. The only prior clean probe was event 54, used solely
to establish source compatibility.

## Qualification procedure

1. Require the exact official Git origin and all 14 commit objects.
2. Require trusted verifier tree `c058ae1c…09a6` from run
   `krv25-smoke-ecdsa-colima`.
3. Extract `src/point_add` by commit, reject links and unsafe paths, and record
   the deterministic candidate tree manifest.
4. Run every candidate offline in the same verifier image. Require
   `score.json`, Harbor-compatible reward, and the sealed Yukon score to agree
   exactly.
5. Retain each clean score artifact, reward artifact, exact logical-parent Git
   diff, image ID, verifier hash, commit, and a local verified Git bundle.
6. Materialize only the two starting candidates. Compile each complete window
   through renderer v3 and require equal atoms, deterministic bytes, no
   post-cutoff event, and 32k/4k token limits.

## Failure and decision rules

Any unavailable commit, source-origin change, score mismatch, invalid selected
candidate, broken lineage, source-bundle failure, context overflow, or parity
failure stops this qualification. No event or window may be replaced after
observing its clean result. Apparatus bugs require a new version and a complete
restart.

Passing this stage admits two ECDSA histories only. Toy ISA and VLIW history
generation, the full multi-task gate, randomization, and all paid treatment
remain locked until separately frozen.
