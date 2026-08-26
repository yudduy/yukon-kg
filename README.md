# Yukon KG

Standalone experiments for deciding how agents should retrieve and use research history. This repository does not depend on the Yukon application checkout.

## Current question

Given the same ECDSA.fail evidence, task, model, and retrieval budget, which input helps an agent identify prior work most reliably?

1. `raw`: immutable submission history.
2. `flat`: a searchable list of recorded attempts.
3. `flat_plus_brief`: the same search results plus an Idea evidence brief after the agent selects an Idea.

The earlier six-case pilot was not decisive: flat search and the brief each passed 2/6 cases. Its result is preserved in [`evidence/atlas-retrieval-v3/pilot.json`](evidence/atlas-retrieval-v3/pilot.json). The current v4 protocol first proves that every reviewed answer is reachable through the same search interface. Its latest preflight stopped before model calls because 9/30 frozen cases were not reachable. The parity, reachability, and decision reports are preserved under [`evidence/atlas-retrieval-v4-preflight/`](evidence/atlas-retrieval-v4-preflight/). No retrieval representation has earned promotion yet.

As of August 2026, the public literature that actually moved verified search is **an executable candidate plus a hard evaluator**, with a compact de-narrativized decision packet as the agent-facing view. Undifferentiated graphs, winner-only memory, and high-volume archive injection are not the recipe. This repository therefore compiles a disposable ECDSA working-knowledge brief from the current Atlas snapshot without editing sealed releases:

```text
immutable Atlas records
→ contract, bounds, frontier, admitted one-change mechanisms
→ negative knowledge with reopen conditions
→ evaluator hazards (nonce grinding, bundled diffs)
→ next discriminators
→ literature overlay labeled source_reported, not Atlas-verified
```

Compile it with:

```bash
bun run knowledge:ecdsa
```

The working retrieval default remains the smallest useful workflow until a later equal-budget court says otherwise:

```text
search the flat attempt list
→ open an Idea brief only when needed
→ inspect the original evidence
```

The per-Idea brief becomes the universal default only if it beats flat search under equal budgets. The compiled working-knowledge brief is a presentation-plane cache, not a claim that Atlas accelerates discovery.

## Run the retrieval experiment

Requirements: Bun and an authenticated Codex CLI with access to `gpt-5.6-luna` and `gpt-5.6-sol`.

```bash
bun test
bun run data:verify
bun run knowledge:ecdsa
bun run atlas:duplicate -- preflight
bun run atlas:duplicate -- pilot <run-id>
bun run atlas:duplicate -- run <run-id>
bun run atlas:duplicate -- report <run-id>
```

`preflight` verifies release hashes, evidence parity, search reachability, byte stability, and model isolation before any billed model session. Generated corpora, transcripts, and reports stay under `.runs/atlas-duplicate/` and are ignored by Git.

## Public ECDSA.fail data

The repository carries two immutable Atlas releases under `docs/ecdsa/releases/`:

- The release pinned by the retrieval experiment.
- The current snapshot containing the historical e928 four-version comparison.

Verify every manifest, file size, and SHA-256 hash with:

```bash
bun run data:verify
```

Public index after GitHub Pages deployment:

```text
https://yudduy.github.io/yukon-kg/ecdsa/index.json
```

Each release remains content-addressed. New evidence creates a new release directory and index entry; existing releases are never edited.

## Earlier handoff experiment

The exact-oracle Mouselab handoff experiment remains available:

```bash
bun run mve -- preflight
bun run mve -- run
bun run mve -- resume <run-id>
bun run mve -- report <run-id>
```

Its generated evidence stays under `.runs/mouselab-handoff/` and is also ignored by Git.
