#!/usr/bin/env python3
"""Independently validate the frozen v36 design and file boundary."""

from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path

import yaml


STUDY = "dungeness-representation-v36-terminal-milestone-restart"
SOURCE = "dungeness-representation-v34-pilot"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_cell(cell: dict[str, object]) -> dict[str, object]:
    value = dict(cell)
    for field in (
        "cell_id",
        "run_id",
        "run_spec",
        "administrative_replacement_for",
        "administrative_failure",
        "administrative_failure_reason",
    ):
        value.pop(field, None)
    return value


def normalized_spec(spec: dict[str, object]) -> dict[str, object]:
    value = dict(spec)
    value.pop("id", None)
    value.pop("run_id", None)
    labels = dict(value["labels"])
    labels.pop("study", None)
    value["labels"] = labels
    return value


def main() -> int:
    repo = Path(__file__).resolve().parents[5]
    eval_root = repo / "eval"
    freeze_path = Path(__file__).resolve().with_name("v36-freeze.json")
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    checks: dict[str, bool] = {}

    checks["freeze_identity"] = (
        freeze.get("schema_version") == 1
        and freeze.get("type")
        == "dungeness-representation-v36-terminal-milestone-freeze"
    )
    files = freeze.get("files", {})
    checks["freeze_files_match"] = isinstance(files, dict) and all(
        (repo / path).is_file() and sha256(repo / path) == expected
        for path, expected in files.items()
    )

    source_path = eval_root / "experiments/users/bx" / SOURCE / "experiment.yaml"
    restart_path = eval_root / "experiments/users/bx" / STUDY / "experiment.yaml"
    source = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    restart = yaml.safe_load(restart_path.read_text(encoding="utf-8"))
    checks["source_experiment_matches"] = (
        sha256(source_path) == freeze["source_experiment"]["sha256"]
        == "7a153aa222001cd099b16295fb70581c687f9a72a952d6878a9b7ba28764ad24"
    )
    checks["restart_experiment_matches"] = (
        sha256(restart_path) == freeze["restart_experiment"]["sha256"]
    )

    source_cells = source["design"]["randomization_manifest"]["cells"]
    source_by_id = {cell["cell_id"]: cell for cell in source_cells}
    restart_cells = restart["design"]["randomization_manifest"]["cells"]
    invalidated = [cell for cell in restart_cells if cell.get("administrative_failure") is True]
    replacements = [cell for cell in restart_cells if "administrative_replacement_for" in cell]
    targets = [cell["administrative_replacement_for"] for cell in replacements]
    checks["counts_match"] = (
        len(source_cells) == len(invalidated) == len(replacements) == 18
        and len(restart_cells) == 36
        and len(restart["relations"]["run_specs"]) == 18
        and restart["design"]["planned_chains"] == 18
        and restart["design"]["planned_runs"] == 54
        and restart["design"]["nominal_budget_usd"] == 162
    )
    checks["replacement_targets_unique"] = len(set(targets)) == 18
    checks["source_cell_membership"] = set(targets) == set(source_by_id)
    checks["all_source_cells_invalidated"] = {
        cell["cell_id"] for cell in invalidated
    } == set(source_by_id)
    checks["replacement_frozen_fields_match"] = all(
        normalized_cell(cell)
        == normalized_cell(source_by_id[cell["administrative_replacement_for"]])
        for cell in replacements
    )

    treatment_counts = Counter(cell["treatment"] for cell in replacements)
    by_block: dict[str, list[str]] = defaultdict(list)
    for cell in replacements:
        by_block[cell["block_id"]].append(cell["treatment"])
    checks["replacement_treatment_balance"] = treatment_counts == {
        "R0": 6,
        "R1": 6,
        "R2": 6,
    }
    checks["replacement_block_completeness"] = (
        len(by_block) == 6
        and all(sorted(values) == ["R0", "R1", "R2"] for values in by_block.values())
    )

    specs_root = eval_root / "run-specs/users/bx" / STUDY
    spec_paths = sorted(specs_root.glob("*.yaml"))
    spec_checks = []
    for replacement in replacements:
        cell_id = replacement["cell_id"]
        target = replacement["administrative_replacement_for"]
        new_path = specs_root / f"{cell_id}-r1.yaml"
        old_path = eval_root / "run-specs/users/bx" / SOURCE / f"{target}-r1.yaml"
        new_spec = yaml.safe_load(new_path.read_text(encoding="utf-8"))
        old_spec = yaml.safe_load(old_path.read_text(encoding="utf-8"))
        raw = new_path.read_text(encoding="utf-8")
        spec_checks.append(
            new_spec["id"] == f"{cell_id}-r1"
            and new_spec["run_id"] == f"{cell_id}-r1"
            and new_spec["labels"]["study"] == STUDY
            and normalized_spec(new_spec) == normalized_spec(old_spec)
            and all(token not in raw for token in ("treatment: R0", "treatment: R1", "treatment: R2"))
        )
    checks["replacement_specs_match_and_are_opaque"] = (
        len(spec_paths) == 18 and all(spec_checks)
    )

    restart_design = restart["design"]
    checks["ceilings_match"] = (
        Decimal(str(restart_design["model_spend_ceiling_usd"]))
        == Decimal("327.787305")
        and Decimal(str(freeze["ceilings_usd"]["study_ledger"])) == Decimal("500")
        and Decimal(freeze["prelaunch_ledger"]["projected_after_nominal_v36_usd"])
        <= Decimal("327.787305")
    )

    diagnostic_path = repo / (
        "eval/study-chains/users/bx/dungeness-representation-v35-admin-recovery/"
        "study-cd6f157239b0b65b3/diagnostic-terminal-milestones/diagnostic.json"
    )
    diagnostic = json.loads(diagnostic_path.read_text(encoding="utf-8"))
    recovered = [
        item
        for item in diagnostic["milestones"]
        if item["percent"] == 25
        and item["source"]["kind"] == "terminal-candidate"
        and item["clean_verification"]["score"] == 1543
    ]
    checks["real_terminal_diagnostic_reproduced"] = len(recovered) == 1
    smoke_scores = {
        "krv36-smoke-native-view": 1243629702,
        "krv36-smoke-toy-view": 8007,
        "krv36-smoke-vliw-view": 3360,
    }
    smoke_checks = []
    for run_id, expected_score in smoke_scores.items():
        record = json.loads(
            (eval_root / "runs/users/bx" / run_id / "record.json").read_text(
                encoding="utf-8"
            )
        )
        data = record["data"]
        smoke_checks.append(
            data["status"] == "completed"
            and data["verification"]["score"] == expected_score
            and data["metrics"]
            and (
                data.get("cost") is None
                or data.get("cost", {}).get("model_cost") is None
            )
            and data["evaluation"]["submissions_used"] == 0
            and data["research_view"]["mount"] == "/workspace/research-view"
        )
    checks["three_task_family_zero_model_smokes"] = all(smoke_checks)
    checks["no_v36_outputs_before_freeze"] = not (
        eval_root / "study-chains/users/bx" / STUDY
    ).exists()
    checks["confirmation_not_automatic"] = (
        "confirmation remains impossible" in (repo / "kg/studies/dungeness-representation-v1/preregistration-v36.md").read_text(encoding="utf-8")
    )
    checks["all_pass"] = all(checks.values())

    report = {
        "schema_version": 1,
        "type": "dungeness-representation-v36-freeze-validation",
        "validated_at": "2026-08-28T20:32:00Z",
        "freeze_path": freeze_path.relative_to(repo).as_posix(),
        "freeze_sha256": sha256(freeze_path),
        "checks": checks,
        "status": "PASS" if checks["all_pass"] else "FAIL",
    }
    output = Path(__file__).resolve().with_name("v36-freeze-validation.json")
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if checks["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
