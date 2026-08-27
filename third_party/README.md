# third_party

Vendored experimental setups. Checkouts are gitignored; only the pin file is committed.

## Dungeness

- Remote: `https://github.com/Layr-Labs/dungeness.git`
- Checkout: `third_party/dungeness/`
- Pin: `third_party/dungeness.pin.json`

Clone as **yudduy** (not the cloud `cursor` GitHub user):

```bash
export GITHUB_TOKEN=...   # yudduy PAT that can read Layr-Labs/dungeness
bun run src/dungeness-clone.js
```

The clone is a runtime substrate. Yukon-kg does not mutate a Dungeness frozen harness.
