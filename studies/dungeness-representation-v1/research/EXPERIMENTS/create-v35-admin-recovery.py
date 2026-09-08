#!/usr/bin/env python3
"""Materialize the frozen v35 administrative recovery from the v34 pilot.

The first completed block remains solely in v34 and is joined only during
blinded analysis. Every later v34 cell is retained as administratively
invalidated and paired with a new opaque cell that preserves its block,
treatment, agent, repetition, slot, candidate, view, task, checkpoint, and run
controls.
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
RECOVERY_STUDY = "dungeness-representation-v35-admin-recovery"
RECOVERY_SEED = "v35-admin-recovery-host-network-outage-2026-08-28"
SOURCE_COMPLETED_CELLS = 3


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def replacement_id(source_cell_id: str) -> str:
    payload = json.dumps(
        [RECOVERY_SEED, "administrative-replacement", source_cell_id],
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
        eval_root
        / "experiments/users/bx"
        / SOURCE_STUDY
        / "experiment.yaml"
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

    recovery_path = (
        eval_root
        / "experiments/users/bx"
        / RECOVERY_STUDY
        / "experiment.yaml"
    )
    recovery_specs = (
        eval_root / "run-specs/users/bx" / RECOVERY_STUDY
    )
    regenerate = sys.argv[1:] == ["--regenerate-before-freeze"]
    if (recovery_path.exists() or recovery_specs.exists()) and not regenerate:
        raise SystemExit(
            "v35 recovery outputs already exist; pass --regenerate-before-freeze "
            "only before any v35 run"
        )

    invalidated: list[dict[str, object]] = []
    replacements: list[dict[str, object]] = []
    new_spec_refs: list[str] = []
    replacement_map: dict[str, str] = {}

    for source_cell in cells[SOURCE_COMPLETED_CELLS:]:
        original = copy.deepcopy(source_cell)
        original["administrative_failure"] = True
        original["administrative_failure_reason"] = (
            "host-network-outage-or-block-invalidated-after-outage"
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
        new_spec["labels"]["study"] = RECOVERY_STUDY
        write_yaml(recovery_specs / f"{new_id}-r1.yaml", new_spec)

    recovery = copy.deepcopy(source)
    recovery["id"] = RECOVERY_STUDY
    recovery["relations"]["run_specs"] = new_spec_refs
    recovery["created_at"] = "2026-08-28T19:12:00Z"
    recovery["published_at"] = None
    recovery["run_refs"] = []
    recovery["artifact_refs"] = []
    design = recovery["design"]
    design["model_spend_ceiling_usd"] = 327.787305
    design["administrative_recovery"] = {
        "source_experiment": f"experiment:users/bx/{SOURCE_STUDY}",
        "source_experiment_sha256": SOURCE_EXPERIMENT_SHA256,
        "cause": "host-network-outage",
        "observed_at": "2026-08-28T18:59:27Z",
        "policy": "repeat-whole-touched-block-and-invalidate-later-scheduled-cells",
        "source_completed_cells": SOURCE_COMPLETED_CELLS,
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
    manifest["algorithm"] = "sha256-sort-v1-with-admin-replacements"
    manifest["cells"] = invalidated + replacements
    executable_ids = [str(cell["cell_id"]) for cell in replacements]
    manifest["execution_order_sha256"] = sha256_bytes(
        json.dumps(executable_ids, separators=(",", ":")).encode("utf-8")
    )
    design["planned_chains"] = len(executable_ids)
    design["planned_runs"] = len(executable_ids) * 3
    design["nominal_budget_usd"] = len(executable_ids) * 9.0
    write_yaml(recovery_path, recovery)

    output = {
        "source_experiment_sha256": observed_sha,
        "recovery_experiment": recovery_path.relative_to(repo_root).as_posix(),
        "recovery_experiment_sha256": sha256_bytes(recovery_path.read_bytes()),
        "source_completed_cells": SOURCE_COMPLETED_CELLS,
        "invalidated_cells": len(invalidated),
        "replacement_cells": len(replacements),
        "executable_cells": len(executable_ids),
        "replacement_map": replacement_map,
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
