# Pilot Execution Inputs

> Execution record. Preregistration version 22 is stopped and authorizes no further run.

## Paid gate prerequisites

The authenticated user-managed root `.env` was the sole credential source; no second key file was created, copied, or modified. Versions 14–22 and all excluded runs remain as documented apparatus or task-screening evidence. The final authorized paid unit, linked independent Kimi seed h2-v2 at run-spec SHA-256 `c65d1ed0ddd6459b4d465fd897f09202118d7a7021d3a8a9f242fb9db6730151`, completed with zero development evaluations. Trusted export `aa6f1e49…20e4` and evidence `7383cdb8…1c02` produced frozen decision `STUDY_STOP` (`f0cde535…803e0`) for `task_failure:no-evaluation`. No seed history, representation arm, replication, or confirmation run is authorized under version 22. AutoLab tasks: no declared license as of commit `7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5`; used for internal evaluation only, not redistributed. AutoLab-derived artifacts and results remain non-redistributable and non-publishable pending license clarification. Keep all AutoLab bytes outside `kg/`.

The completed final charged run-spec was a no-view seed producer, not an experiment arm:

```yaml
schema_version: 1
type: run-spec
namespace: <namespace>
id: krv1-seed-h2-v2
run_id: krv1-seed-h2-v2
task: task:external/autolab/z_order_range_scan
agent: agent:projects/dungeness/codex-kimi-openrouter
checkpoint: checkpoint:public/github/autolabhq/autolab/7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5
external_bundle:
  path: runs/.external-bundles/materialized/z_order_range_scan-internal-v1
  lock_sha256: d67eee63802a5cf9af6e1648e5f9714a13ea35e2e700460da99070e599710d0c
  mode: internal
agent_options:
  reasoning_effort: high
  reasoning_summary: none
budget:
  max_usd: 6
  max_model_tokens: 400000
  max_evaluations: 8
initialization:
  mode: checkpoint
labels:
  purpose: seed-history-producer
  budget_scope: knowledge-representation-autoresearch-v1
  producer_history: kimi-independent
  administrative_replacement_for: krv1-seed-h2
  preregistration_version: "22"
  renderer_version: yukon.research-view-renderer.v2
runtime:
  keep_render: true
  agent_timeout_sec: 3600
  continuation: {max_resumes: 0}
```

It must not contain a `research_view` field or relation. It is eligible only after at least four valid numeric evaluations, deterministic best-candidate selection, clean re-verification, byte-deterministic equal-evidence view compilation, and convergence `PASS`. Kimi evidence cannot replace a GPT-produced history.

Before `seed-history finalize`, preserve the trusted export bytes and create a separate clean-evidence file with this exact shape. Unknown keys are rejected:

```json
{
  "schema": "yukon.seed-convergence-evidence.v2",
  "experiment": "experiment:<namespace>/<id>",
  "producerRun": "run:<namespace>/<id>",
  "taskId": "task:<namespace>/<id>",
  "trustedExportSha256": "<64 lowercase hex>",
  "task": {
    "taskId": "task:<namespace>/<id>",
    "metricName": "<outer metric>",
    "direction": "minimize",
    "officialBaselineScore": 100,
    "startingCandidate": {"score": 110, "candidateContentSha256": "<hash>", "verifierSha256": "<hash>"},
    "reference": {"score": 80, "candidateContentSha256": null, "verifierSha256": "<same hash>"}
  },
  "runOutcome": {
    "status": "completed",
    "failureCategory": null,
    "failureCode": null,
    "administrativeRetryUsed": false,
    "eligibleReplacementAvailable": true
  },
  "cleanSelection": {
    "evaluationId": "0004",
    "candidateArtifactRef": "candidate-artifact:<namespace>/<content hash>",
    "candidateArtifactManifestSha256": "<hash>",
    "candidateContentSha256": "<same content hash>",
    "verifierSha256": "<same verifier hash>",
    "status": "ok",
    "score": 95,
    "scoreArtifactSha256": "<hash>"
  },
  "protocolViolations": []
}
```

Use `cleanSelection: null` when no clean candidate exists. A failed clean attempt retains all fields but sets `status: "failed"`; fields genuinely unavailable are `null`. Failure categories are `administrative_failure`, `task_failure`, or `apparatus_failure`, with the frozen codes in the preregistration. Bind `trustedExportSha256` to the exact input bytes, then run:

```bash
bun run representation:convergence -- \
  --export seed-trusted-events.json \
  --evidence seed-clean-evidence.json \
  > seed-convergence-decision.json
```

The v2 output has exact top-level keys `schema`, `experiment`, `taskId`, `producerRun`, `inputHashes`, `runOutcome`, `cleanSelection`, `metrics`, `thresholds`, `protocolViolations`, `execution`, `decision`, `reasons`, and `decisionSha256`. Its metrics separately record `officialBaselineScore`, `officialReferenceGap`, `startingCandidateScore`, `seedProgress`, `meaningfulGain`, and `remainingHeadroom`; do not reconstruct one from another. The final hash is SHA-256 of canonical JSON before `decisionSha256` is added. `decision` is exactly one of `PASS`, `ADMIN_RETRY`, `TASK_REPLACE`, `APPARATUS_STOP`, or `STUDY_STOP`; `execution` is always `{ "modelCalls": 0, "studyRunsStarted": 0 }`. Only `PASS` permits the next unviewed seed step. The command never starts replication or confirmation.

## 1. Task references JSON

Use schema `yukon.representation-task-references.v2`. It must name the same experiment as the blinded results and contain exactly the three active tasks. Each task has:

```json
{
  "schema": "yukon.representation-task-references.v2",
  "experiment": "experiment:<namespace>/<id>",
  "tasks": [{
    "taskId": "task:<namespace>/<id>",
    "metricName": "<outer metric>",
    "direction": "minimize",
    "officialBaselineScore": 100,
    "startingCandidate": {
      "score": 110,
      "candidateContentSha256": "<64 lowercase hex>",
      "verifierSha256": "<64 lowercase hex>"
    },
    "reference": {
      "score": 80,
      "candidateContentSha256": null,
      "verifierSha256": "<same verifier hash>"
    }
  }]
}
```

The reference must be strictly better than `officialBaselineScore` in the declared direction. Derive one meaningful gain only from that official gap. `startingCandidate.score` is the separate clean outer-verifier score at budget zero and is the sole origin for AUC progress and positive seed progress. Do not copy the example scores; populate them from frozen trusted artifacts. The accepted no-op starts are exactly 48,656 rotations for `adversarial_splay` and 9,220 cycles for `toy_isa_opt` in repeated full Harbor runs. Toy ISA's declared reference is 2,954 cycles; its separate upstream reward-saturation anchor of 1,545 must not be substituted for that reference.

## 2. Experiment YAML

The Dungeness `randomized-block` experiment must declare one shared budget scope, a $500 hard ceiling, the frozen per-round caps, one consumer model, and six blocks: three tasks × two independently produced seed histories. Before seed finalization, each block contains only its authored ID, qualified task/checkpoint, producer identity, and any linked administrative replacement. After all six seed records pass convergence and clean re-verification, Dungeness fills the candidate artifact, the R0/R1/R2 research-view references, and the source-history hash. Only then may it freeze the 18-cell assignment manifest.

Required topology:

```yaml
schema_version: 1
type: experiment
namespace: <namespace>
id: dungeness-representation-v1-pilot
relations:
  run_specs: []
design:
  kind: randomized-block
  budget_scope: knowledge-representation-autoresearch-v1
  model_spend_ceiling_usd: 500
  controls:
    budget:
      max_usd: 3
      max_model_tokens: 200000
      max_evaluations: 4
    runtime:
      env_file: .env
      keep_render: true
      agent_timeout_sec: 1800
      continuation: {max_resumes: 0}
  axes:
    agents: [agent:<first-consumer>]
  repetitions: 1
  randomization:
    algorithm: sha256-sort-v1
    seed: dungeness-representation-v1-pilot-2026-08-27
  blocks:
    - id: <task-and-history-id>
      task: task:<namespace>/<id>
      checkpoint: checkpoint:<namespace>/<id>
      producer_run: run:<namespace>/<no-view-seed-run>
      candidate_artifact: candidate-artifact:<namespace>/<content-hash> # filled by accepted seed
      source_history_sha256: <64 lowercase hex> # filled by accepted seed
      research_views: # filled by accepted seed
        R0: research-view:<namespace>/<tree-hash>
        R1: research-view:<namespace>/<tree-hash>
        R2: research-view:<namespace>/<tree-hash>
    # exactly six accepted task-history blocks before assignment freeze
```

`planned_chains`, `planned_runs`, `nominal_budget_usd`, the opaque randomization manifest, and run-spec relations are Dungeness outputs. Do not author or edit them after `experiment create`.

## 3. Blinded results JSON

Export Dungeness type `blinded-randomized-block-results`. It must contain exactly one row for every opaque assignment cell and no treatment, renderer, representation, or research-view key. Preserve its raw bytes: failure classifications bind this file's exact SHA-256.

## 4. Host assignment JSON

If every chain completes without a classified failure, pass the native `design.randomization_manifest` object as JSON. Otherwise use:

```json
{
  "schema": "yukon.representation-host-assignment.v1",
  "experiment": "experiment:<namespace>/<id>",
  "assignment": {},
  "failureClassifications": [
    {
      "cellId": "study-c<opaque id>",
      "category": "treatment_failure",
      "code": "<frozen allowed code>",
      "blindedResultsSha256": "<exact raw results hash>"
    }
  ]
}
```

Allowed treatment codes are `agent-crash`, `invalid-patch`, `treatment-timeout`, `no-evaluation`, and `verification-failure`. Allowed administrative codes are `provider-outage`, `lost-host`, and `verifier-service-failure`; each requires exactly one linked same-cap replacement.

## Analysis command

```bash
bun run representation:analyze -- analyze \
  --tasks pilot-task-references.json \
  --results pilot-blinded-results.json \
  --assignments pilot-host-assignment.json \
  --phase pilot \
  --bootstrap-draws 10000 \
  --apparatus-gates-passed true \
  --protocol-violations 0 \
  --seed dungeness-representation-v1-pilot-analysis
```

The command is read-only and model-free. A `GO_REPLICATION`-eligible result still requires a separate user decision; it starts no run.
It emits `yukon.representation-analysis.v2`; every outcome records both baseline concepts and the meaningful-gain scale used for its AUC.
