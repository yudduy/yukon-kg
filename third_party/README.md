# third_party

Vendored experimental setups. Checkouts are gitignored; only the pin file is committed.

## Dungeness

- Remote: `https://github.com/Layr-Labs/dungeness.git`
- Checkout: `third_party/dungeness/`
- Pin: `third_party/dungeness.pin.json`
- External adapter: `third_party/dungeness.adapter.json`
- Adapter template: `third_party/dungeness.adapter.example.json`

Clone as **yudduy** (not the cloud `cursor` GitHub user):

```bash
export GITHUB_TOKEN=...   # yudduy PAT that can read Layr-Labs/dungeness
bun run src/dungeness-clone.js
```

The clone is a runtime substrate. Yukon-kg does not mutate a Dungeness frozen harness.

The adaptive experiment accepts an adapter only when it pins:

- Eight distinct checkpoint commits and their baseline scores.
- Separate development and hidden panel hashes.
- A single hash-pinned evaluator wrapper.
- A networkless external microVM that does not mount the host workspace.
- Strict JSON qualification for classical output, ancillae, global phase, and reverse execution.

The wrapper's `--attest` command must reproduce those pins before protocol freeze. Model-generated code runs only inside that wrapper; the host ledger signing key remains outside the checkout.
