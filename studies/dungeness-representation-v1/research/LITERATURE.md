# Literature and Existing Apparatus

## Relevant implementations

- Dungeness already provides trusted evaluation capture, clean re-verification, shared ledgers, isolated research views, randomized blocks, and blinded exports.
- Yukon renderer v2 produces deterministic equal-atom R0/R1/R2 views under the frozen context limits.
- AutoLab supplies CPU Harbor task bundles used internally at pinned commit `7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5`; no license is declared, so bytes and derived results are not redistributed.
- Prior surveyed systems—Arbor, Prime trace manifests, Schema Harness, ACE, and continual-agent memories—motivate later treatments but are excluded from R0/R1/R2 because they change information or tools.

## Open question

Existing apparatus does not answer how to generate unbiased, dense seed histories when a producer session can terminate without evaluating. The v23 precursor tests session orchestration rather than adding semantic knowledge.
