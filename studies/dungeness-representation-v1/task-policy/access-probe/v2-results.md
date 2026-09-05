# Atlas Access Probe v2: Final Results

## Decision

For **positive exact-duplicate lookup in a large research archive**, use normalized joined attempt rows rather than raw source records. Flat recovered 11/12 exact receipts; raw recovered 0/12. Flat-plus-brief also scored 11/12 but did not consistently beat flat, used slightly more retrieval, and cost more. The simplest supported core view is therefore `flat`.

This is a representation-specific mechanism result, not evidence that flat tables are best for full autoresearch or for negative “nothing exists” searches.

## Design

Six fresh reviewed positive cases crossed two consumer models and four views:

```text
6 cases × 2 models × (raw / flat / flat-plus-brief / pointer) = 48 sessions
```

The three core arms shared byte-identical canonical source atoms, proposal, tool API, budgets, model settings, and exact response contract. Only the corpus organization differed. The pointer arm added one exact locator and served only as a sensitivity control. Order was deterministic and randomized by hash.

## Results

| View | Exact receipts | Fabrications | Mean queries | Mean returned bytes | Admitted-session cost |
|---|---:|---:|---:|---:|---:|
| Raw records | **0/12** | 3 | 11.17 | 20,828 | $0.817137 |
| Flat joined attempts | **11/12** | 0 | 4.92 | 11,668 | $0.417455 |
| Flat plus brief | **11/12** | 0 | 5.08 | 12,431 | $0.529559 |
| Pointer control | **12/12** | 0 | 2.17 | 5,646 | $0.230131 |

Flat versus raw produced 11 wins, zero losses, and one shared failure across the 12 model×case pairs. The pooled exact McNemar value is `0.0009765625`; model-specific values are `0.03125` for Kimi (6/6 wins) and `0.0625` for GPT-5.6 Sol (5 wins, one tie). Because both models saw the same six cases, the pooled value is descriptive rather than a population-level independence claim. Every case favored flat for at least one model.

Flat reduced mean queries by 56%, returned bytes by 44%, and admitted-session cost by 49% relative to raw. The agent result reverses the model-free byte prediction: although one deterministic receipt path makes flat rows larger, real agents stopped much earlier because the join was already materialized.

Brief versus flat produced one GPT win, one Kimi loss, and ten ties (`p=1`). The brief sometimes changed search ranking enough to surface the correct neighbor, but sometimes displaced it. It is not a reliable exact-lookup improvement.

## Frozen gate verdict

The pointer, informativeness, and flat-mechanism gates passed. The all-arm zero-fabrication gate failed because Kimi fabricated unretrieved provenance in 3/6 **raw** sessions; no structured or pointer session fabricated. Therefore the frozen aggregate flag is `proceed=false`, and this probe cannot automatically trigger full chains or confirmation.

That safety veto does not turn raw into a winner. It records that the experimental system encountered unsafe behavior. Within this finite court, flat dominated raw on correctness, provenance safety, calls, bytes, and cost.

## Limits

- The six cases come from one ECDSA archive and were selected by treatment-blind strata and all-arm reachability, not random population sampling.
- Only known-positive duplicate recovery was tested. The available court had only one all-arm-reachable negative case, which is insufficient for a false-positive study.
- The unit task was retrieval and grounding, not a three-round code-research chain.
- V1 is excluded: its pointer control exposed an underspecified output contract, then a transport failure stopped the run. V2 used untouched cases and changed no treatment content.

V2 cost `$1.99428119` in admitted sessions plus `$0.10417475` in four preserved administrative attempts, or `$2.09845594` total. V1 and V2 together cost `$2.57477166`; known study-wide committed/model spend is now `$112.26915692`, below the `$500` ceiling.

## Audit trail

- V2 freeze SHA-256: `da3c7b26deafe922aa0e585fa829dbf10df17ecaec2170e64c864f03df4d6562`.
- V2 results SHA-256: `de29856082779275d9dec292c16f00f89ac5d141c1e3eae85c52b0a0b88460c3`.
- V2 deterministic analysis SHA-256: `804cd408c3b20eae80fb5546019a16cf7fe1e39a4c9180615eb9f9782df030a9`.
- Descriptive paired statistics SHA-256: `40ed2027e8fe5fa526142ca34d7272ef35205410bac6b06686d7f15d430ee543`.
- Additive study spend record SHA-256: `41548f7a4eba6a775c1d1202f90eb240301dc6467a0fbb6a217a605439845c04`.
- V1 excluded results SHA-256: `dbf5ff6eecd73303876f1c532cb0f939428b43843cd59798773604836ea7a0f9`.
- Post-run validation: 133 tests passed, two intentional skips, zero failures; public-data verification passed for both releases.

## Planned → observed → interpretation → decision → next test

- **Planned:** test whether materialized joins improve exact receipt recovery under a fixed query budget.
- **Observed:** flat beat raw 11–0 with one tie, halved access cost, and eliminated raw's observed fabrication; brief and flat tied overall.
- **Interpretation:** representation helps when it precomputes the exact operation consuming the agent's budget. Extra aggregate text is not reliably useful for a one-receipt query.
- **Decision:** route call-bound positive duplicate lookup to flat joined attempts; keep R0 for small readable histories; do not claim a universal representation.
- **Next test:** build separate known-answer courts for negative existence checks and aggregation. Any full-chain or confirmatory study requires a new freeze and authorization.
