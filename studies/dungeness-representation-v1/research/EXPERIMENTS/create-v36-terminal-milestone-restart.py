#!/usr/bin/env python3
"""Materialize the frozen v36 restart after terminal-milestone repair.

All v34 and v35 cells remain apparatus-only. Each of the 18 frozen v34 cells is
retained as invalidated and paired with a fresh opaque cell that preserves all
scientific fields.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import sys

import yaml


SOURCE_EXPERIMENT_SHA256 = (
    "7a153aa222001cd099b16295fb70581c687f9a72a952d6878a9b7ba28764ad24"
)
SOURCE_STUDY = "dungeness-representation-v34-pilot"
RESTART_STUDY = "dungeness-representation-v36-terminal-milestone-restart"
RESTART_SEED = "v36-terminal-milestone-restart-2026-08-28-frozen"


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def replacement_id(source_cell_id: str) -> str:
    payload = json.dumps(
        [RESTART_SEED, "apparatus-replacement", source_cell_id],
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return "study-c" + sha256_bytes(payload)[:16]


def write_yaml(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[5]
    eval_root = repo_root / "eval"
    source_path = (
        eval_root / "experiments/users/bx" / SOURCE_STUDY / "experiment.yaml"
    )
    source_bytes = source_path.read_bytes()
    observed_sha = sha256_bytes(source_bytes)
    if observed_sha != SOURCE_EXPERIMENT_SHA256:
        raise SystemExit(
            "v34 experiment changed after freeze: "
            f"expected {SOURCE_EXPERIMENT_SHA256}, observed {observed_sha}"
        )
    source = yaml.safe_load(source_bytes)
    cells = source["design"]["randomization_manifest"]["cells"]
    if len(cells) != 18:
        raise SystemExit("v34 no longer has the frozen 18-cell design")

    restart_path = (
        eval_root / "experiments/users/bx" / RESTART_STUDY / "experiment.yaml"
    )
    restart_specs = eval_root / "run-specs/users/bx" / RESTART_STUDY
    regenerate = sys.argv[1:] == ["--regenerate-before-freeze"]
    if (restart_path.exists() or restart_specs.exists()) and not regenerate:
        raise SystemExit(
            "v36 outputs already exist; pass --regenerate-before-freeze only "
            "before any v36 run"
        )

    invalidated: list[dict[str, object]] = []
    replacements: list[dict[str, object]] = []
    new_spec_refs: list[str] = []
    replacement_map: dict[str, str] = {}

    for source_cell in cells:
        original = copy.deepcopy(source_cell)
        original["administrative_failure"] = True
        original["administrative_failure_reason"] = (
            "apparatus-invalid-terminal-candidate-milestone-omission"
        )
        invalidated.append(original)

        old_id = str(source_cell["cell_id"])
        new_id = replacement_id(old_id)
        replacement_map[old_id] = new_id
        replacement = copy.deepcopy(source_cell)
        replacement["cell_id"] = new_id
        replacement["run_id"] = f"{new_id}-r1"
        replacement["run_spec"] = f"run-spec:users/bx/{new_id}-r1"
        replacement["administrative_replacement_for"] = old_id
        replacements.append(replacement)
        new_spec_refs.append(str(replacement["run_spec"]))

        old_spec_path = (
            eval_root
            / "run-specs/users/bx"
            / SOURCE_STUDY
            / f"{old_id}-r1.yaml"
        )
        new_spec = yaml.safe_load(old_spec_path.read_text(encoding="utf-8"))
        new_spec["id"] = f"{new_id}-r1"
        new_spec["run_id"] = f"{new_id}-r1"
        new_spec["labels"]["study"] = RESTART_STUDY
        write_yaml(restart_specs / f"{new_id}-r1.yaml", new_spec)

    restart = copy.deepcopy(source)
    restart["id"] = RESTART_STUDY
    restart["relations"]["run_specs"] = new_spec_refs
    restart["created_at"] = "2026-08-28T20:15:00Z"
    restart["published_at"] = None
    restart["run_refs"] = []
    restart["artifact_refs"] = []
    design = restart["design"]
    design["model_spend_ceiling_usd"] = 327.787305
    design["apparatus_restart"] = {
        "source_experiment": f"experiment:users/bx/{SOURCE_STUDY}",
        "source_experiment_sha256": SOURCE_EXPERIMENT_SHA256,
        "excluded_experiments": [
            "experiment:users/bx/dungeness-representation-v34-pilot",
            "experiment:users/bx/dungeness-representation-v35-admin-recovery",
        ],
        "cause": "terminal-candidate-milestone-omission",
        "policy": "exclude-affected-versions-and-restart-all-six-blocks",
        "invalidated_cells": len(invalidated),
        "replacement_cells": len(replacements),
        "replacement_map_sha256": sha256_bytes(
            json.dumps(
                replacement_map,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ),
    }
    manifest = design["randomization_manifest"]
    manifest["algorithm"] = "sha256-sort-v1-with-apparatus-replacements"
    manifest["cells"] = invalidated + replacements
    executable_ids = [str(cell["cell_id"]) for cell in replacements]
    manifest["execution_order_sha256"] = sha256_bytes(
        json.dumps(executable_ids, separators=(",", ":")).encode("utf-8")
    )
    design["planned_chains"] = len(executable_ids)
    design["planned_runs"] = len(executable_ids) * 3
    design["nominal_budget_usd"] = len(executable_ids) * 9.0
    write_yaml(restart_path, restart)

    output = {
        "source_experiment_sha256": observed_sha,
        "restart_experiment": restart_path.relative_to(repo_root).as_posix(),
        "restart_experiment_sha256": sha256_bytes(restart_path.read_bytes()),
        "invalidated_cells": len(invalidated),
        "replacement_cells": len(replacements),
        "executable_cells": len(executable_ids),
        "replacement_map": replacement_map,
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
