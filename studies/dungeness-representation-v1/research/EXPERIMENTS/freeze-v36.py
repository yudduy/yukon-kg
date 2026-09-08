#!/usr/bin/env python3
"""Create the content-addressed v36 prelaunch boundary."""

from __future__ import annotations

from decimal import Decimal
import hashlib
import json
from pathlib import Path


STUDY = "dungeness-representation-v36-terminal-milestone-restart"
SCOPE = "knowledge-representation-autoresearch-v1"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    repo = Path(__file__).resolve().parents[5]
    eval_root = repo / "eval"
    kg_rel = "kg/studies/dungeness-representation-v1"
    experiment_rel = f"eval/experiments/users/bx/{STUDY}/experiment.yaml"
    specs_root = eval_root / "run-specs/users/bx" / STUDY
    specs = sorted(specs_root.glob("*.yaml"))
    if len(specs) != 18:
        raise SystemExit(f"expected 18 v36 run specs, found {len(specs)}")
    chain_root = eval_root / "study-chains/users/bx" / STUDY
    if chain_root.exists():
        raise SystemExit("v36 outputs already exist; refusing to create prelaunch freeze")

    paths = [
        "eval/dungeness",
        "eval/representation_study.py",
        "eval/tests/test_representation_study.py",
        "eval/tests/test_representation_study_cli.py",
        experiment_rel,
        f"{kg_rel}/preregistration-v36.md",
        f"{kg_rel}/research/EXPERIMENTS/create-v36-terminal-milestone-restart.py",
        f"{kg_rel}/research/EXPERIMENTS/freeze-v36.py",
        f"{kg_rel}/research/EXPERIMENTS/validate-v36-freeze.py",
        "eval/experiments/users/bx/dungeness-representation-v34-pilot/experiment.yaml",
        "eval/experiments/users/bx/dungeness-representation-v35-admin-recovery/experiment.yaml",
        f"{kg_rel}/research/EXPERIMENTS/v34-freeze.json",
        f"{kg_rel}/research/EXPERIMENTS/v35-freeze.json",
        f"{kg_rel}/research/EXPERIMENTS/v35-freeze-validation.json",
        "eval/study-chains/users/bx/dungeness-representation-v35-admin-recovery/"
        "study-cd6f157239b0b65b3/diagnostic-terminal-milestones/diagnostic.json",
        "eval/runs/users/bx/krv36-smoke-native-view/record.json",
        "eval/runs/users/bx/krv36-smoke-toy-view/record.json",
        "eval/runs/users/bx/krv36-smoke-vliw-view/record.json",
    ]
    paths.extend(path.relative_to(repo).as_posix() for path in specs)
    files = {relative: sha256(repo / relative) for relative in sorted(paths)}

    ledger_path = (
        eval_root / "runs/.study-spend-ledgers" / SCOPE / "ledger.json"
    )
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    reservations = ledger["reservations"]
    active_ids = sorted(
        key for key, value in reservations.items() if value["status"] == "active"
    )
    active = sum(
        Decimal(str(value["reserved_usd"]))
        for value in reservations.values()
        if value["status"] == "active"
    )
    settled = sum(
        Decimal(str(value["actual_usd"]))
        for value in reservations.values()
        if value["status"] == "settled"
    )
    committed = active + settled

    freeze = {
        "schema_version": 1,
        "type": "dungeness-representation-v36-terminal-milestone-freeze",
        "created_at": "2026-08-28T20:30:00Z",
        "source_experiment": {
            "path": "eval/experiments/users/bx/dungeness-representation-v34-pilot/experiment.yaml",
            "sha256": files[
                "eval/experiments/users/bx/dungeness-representation-v34-pilot/experiment.yaml"
            ],
        },
        "restart_experiment": {
            "path": experiment_rel,
            "sha256": files[experiment_rel],
        },
        "excluded_experiments": [
            "dungeness-representation-v34-pilot",
            "dungeness-representation-v35-admin-recovery",
        ],
        "counts": {
            "administratively_invalidated_cells": 18,
            "administrative_replacement_cells": 18,
            "executable_cells": 18,
            "replacement_run_specs": 18,
            "blocks": 6,
            "cells_per_treatment": 6,
        },
        "ceilings_usd": {
            "restart_experiment": 327.787305,
            "study_ledger": 500,
            "nominal_v36": 162,
        },
        "prelaunch_ledger": {
            "ledger_sha256": sha256(ledger_path),
            "active_reservation_ids": active_ids,
            "active_usd": str(active),
            "settled_usd": str(settled),
            "committed_usd": str(committed),
            "projected_after_nominal_v36_usd": str(committed + Decimal("162")),
        },
        "diagnostic": {
            "source_chain": "study-cd6f157239b0b65b3",
            "recovered_terminal_score": 1543,
            "baseline_score": 7337,
        },
        "smokes": {
            "native": {"run_id": "krv36-smoke-native-view", "score": 1243629702},
            "toy_isa": {"run_id": "krv36-smoke-toy-view", "score": 8007},
            "vliw": {"run_id": "krv36-smoke-vliw-view", "score": 3360},
            "model_spend_usd": 0,
        },
        "files": files,
    }
    output = Path(__file__).resolve().with_name("v36-freeze.json")
    output.write_text(
        json.dumps(freeze, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps({"path": output.relative_to(repo).as_posix(), "sha256": sha256(output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
