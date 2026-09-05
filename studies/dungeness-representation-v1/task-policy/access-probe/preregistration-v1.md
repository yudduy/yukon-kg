# Atlas Access Probe v1 Preregistration

## Question

When an autoresearch agent asks “has this exact idea already been tried?”, does a normalized joined attempt index improve grounded duplicate recovery relative to raw source records? Does adding an aggregate evidence brief help this exact-lookup task?

This is a mechanism pilot. It does not estimate full-chain research progress and cannot trigger confirmation or Dungeness chains automatically.

## Frozen inputs

- Freeze: [`v1-freeze.json`](v1-freeze.json)
- Freeze byte SHA-256: `ee4d10da2e8f0231d2c88b33698233362fedf3d0315d687c3e75e8e2e8d7b9d1`
- Atlas release: `b4bd9026018a9ab464fafd1ce4c2905c95af95462b29d55ede169c7cb953eac2`
- Atlas manifest: `db9c9c924543418ab47d871a666f0cdd17bcd4c116369bbcc411bacf97b50925`
- Reviewed fixture: `7bcdf80445293103645d94fb81b835ff3f6006614b911fdd231120aaba4c5e3d`
- Six positive cases: two low-overlap bundled, two ordinary bundled, and one low/one ordinary focused or representative case as recorded in the freeze.
- All six cases pass deterministic recovery in all three core corpora under the stricter preflight budget.

Two independent compilations of the freeze must be byte-identical. Any source change invalidates the freeze.

## Arms

- `raw`: source submissions, changes, details, witnesses, routes, ideas, and dossiers without joined attempt rows.
- `flat`: raw records plus one normalized attempt row for every idea-routed attempt.
- `flat_plus_brief`: flat plus a deterministic per-idea evidence aggregate.
- `pointer`: positive sensitivity control using the flat corpus plus one exact record locator. It intentionally changes information and is excluded from equal-information contrasts.

The three core arms declare byte-identical canonical source atoms. They use the same proposal, system prompt, function schema, answer schema, query cap, byte cap, generation settings, and model. Only the sealed corpus bytes differ.

## Execution

```text
6 cases × 2 models × 4 arms = 48 fresh OpenRouter sessions
```

- Models: `openai/gpt-5.6-sol` and `moonshotai/kimi-k3`.
- Order: deterministic SHA-256 randomization.
- Temperature: 0; reasoning effort: low; reasoning retained as a final-text fallback.
- Maximum: 12 Atlas calls, 24,576 returned evidence bytes, 16 model turns, 2,048 completion tokens per turn.
- Concurrency: 2.
- Administrative retries: 2 after the original attempt; every failed attempt and its cost remain recorded.
- Direct-model cap: `$20`; the study-wide `$500` ceiling remains binding.

## Outcomes and gates

Primary outcome: exact whole-answer success, requiring correct positive classification, decision, linked idea, exact acceptable submission/change/status/outcome, nonfabricated source references, and protocol compliance.

Mechanisms: query calls, returned bytes, provider cost, retrieved receipt evidence, and fabrication.

The pilot advances only if all are true:

1. pointer accuracy is at least 5/6 for each model;
2. at least two cases distinguish the core arms for each model;
3. flat beats raw on at least two cases and loses on none for each model;
4. no arm fabricates provenance.

If the pointer fails, classify the assay as insensitive. If the core arms are at a shared ceiling or floor, stop as uninformative. If flat fails its selective gate, retain raw for exact lookup. The brief is descriptive here: exact lookup cannot establish its aggregation mechanism.

## Failure policy

- Invalid JSON, bad tool use, exhaustion of the query budget, or failure to return evidence is a scientific failure.
- Provider outage or transport failure is administrative; retry the entire session and retain the attempt.
- Source parity, reachability, renderer, or scoring failure invalidates the apparatus before interpretation.
- No case, prompt, cap, or gate may be changed after a treatment response is observed and reused as evidence.

## Prior evidence boundary

Atlas v3 had raw at floor and flat/brief at 2/6 in a one-model pilot; it was discarded by its own informativeness gate. Atlas v4 has no model observations because 9/30 cases failed reachability before isolation or treatment. Neither is evidence for a winner.

The new model-free access audit is admissible only as a mechanism check: on its 21 all-arm-reachable cases, flat used fewer fixed oracle traversal calls than raw in 21/21 but more bytes in 20/21; brief tied flat. It justified this pilot without supplying agent labels.
