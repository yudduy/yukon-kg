# Version 30 Preregistration: Canonical Controlled Histories

Version 30 repeats the complete version-29 controlled-history qualification
after a pre-treatment timestamp-contract failure. Version 29 independently
matched all 20 expected scores and reconstructed four starts, but Yukon rejected
all four exports because their event timestamps omitted canonical millisecond
precision. No representation view compiled and no treatment or model call ran.

The only scientific-input change is timestamp encoding. Every event and cutoff
must use `YYYY-MM-DDTHH:mm:ss.sssZ`; the Python plan validator must reject any
other form before verification. Candidate generators, parameter order, expected
scores, upstream bundles, four-event windows, starting bytes, renderer, context
limits, and acceptance rules remain unchanged. The generator apparatus version
increments so a version-29 plan cannot pass under version 30 accidentally.

Qualification must rerun all 20 candidates through the original pinned
verifiers, publish new content-addressed banks, materialize four starts under
`users/bx/v30`, and resolve them through Dungeness's production artifact loader.
Each trusted export must contain exactly four events and four recorded
interventions. Each window must compile twice with byte-identical results, equal
atom bytes across R0/R1/R2, no post-cutoff event, at most 32,000 total tokens,
and at most 4,000 index tokens.

Any candidate, score, artifact, timestamp, renderer, parity, or context failure
excludes the affected task and keeps paid treatment locked. Passing version 30
qualifies histories only; it does not estimate a representation effect.

Known risk: AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed

Version 30 authorizes zero model spend and zero treatment chains.
