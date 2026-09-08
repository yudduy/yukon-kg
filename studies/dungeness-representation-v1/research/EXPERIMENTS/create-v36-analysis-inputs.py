#!/usr/bin/env python3
"""Materialize frozen v36 analysis inputs after failure-classification freeze."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml


KG_ROOT = Path(__file__).resolve().parents[4]
WAYPOINT_ROOT = KG_ROOT.parent
EVAL_ROOT = WAYPOINT_ROOT / "eval"
STUDY_ROOT = KG_ROOT / "studies" / "dungeness-representation-v1"
EXPERIMENT_ID = "dungeness-representation-v36-terminal-milestone-restart"
EXPERIMENT_REF = f"experiment:users/bx/{EXPERIMENT_ID}"
BLINDED_PATH = (
    EVAL_ROOT / "experiment-results" / "users" / "bx" / EXPERIMENT_ID / "blinded-results.json"
)
EXPERIMENT_PATH = EVAL_ROOT / "experiments" / "users" / "bx" / EXPERIMENT_ID / "experiment.yaml"
CLASSIFICATIONS_PATH = STUDY_ROOT / "results" / "v36-failure-classifications.json"
HOST_OUTPUT = STUDY_ROOT / "results" / "v36-host-assignment.json"
TASKS_OUTPUT = STUDY_ROOT / "results" / "v36-task-references.json"
EXPECTED_BLINDED_SHA256 = "69a08cd78555d4ef6f66ff6d83d100eb4ff71b3f68e37aeb98678bb2f346437a"
EXPECTED_CLASSIFICATIONS_SHA256 = "ebb82c9cc20ecc80cb22bc959eb3c96c2d088e86108bb9b02047a0d6b593038d"

TASK_ANCHORS = {
    "task:users/bx/ecdsa-fail-v2": {
        "metricName": "ecdsafail_score",
        "direction": "minimize",
        "officialBaselineScore": 1_481_490_198,
        "referenceScore": 1_182_644_586,
    },
    "task:external/autolab/toy_isa_opt": {
        "metricName": "cycles",
        "direction": "minimize",
        "officialBaselineScore": 9_220,
        "referenceScore": 2_954,
    },
    "task:external/autolab/vliw_scheduler": {
        "metricName": "cycles",
        "direction": "minimize",
        "officialBaselineScore": 4_080,
        "referenceScore": 1_300,
    },
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> tuple[dict, str]:
    data = path.read_bytes()
    return json.loads(data), sha256_bytes(data)


def write_immutable(path: Path, value: dict) -> str:
    data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    digest = sha256_bytes(data)
    if path.exists():
        if path.read_bytes() != data:
            raise RuntimeError(f"refusing to overwrite nonidentical frozen file: {path}")
        return digest
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return digest


def milestone_zero(row: dict) -> dict:
    matches = [item for item in row.get("milestones", []) if item.get("percent") == 0]
    if len(matches) != 1:
        raise RuntimeError(f"{row['cell_id']} does not have exactly one 0% milestone")
    milestone = matches[0]
    verification = milestone.get("verification", {})
    if verification.get("status") != "ok" or not isinstance(verification.get("score"), (int, float)):
        raise RuntimeError(f"{row['cell_id']} does not have a valid 0% verification")
    return milestone


def main() -> None:
    blinded, blinded_sha = load_json(BLINDED_PATH)
    classifications, classifications_sha = load_json(CLASSIFICATIONS_PATH)
    if blinded_sha != EXPECTED_BLINDED_SHA256:
        raise RuntimeError(f"unexpected blinded-results SHA-256: {blinded_sha}")
    if classifications_sha != EXPECTED_CLASSIFICATIONS_SHA256:
        raise RuntimeError(f"unexpected classification SHA-256: {classifications_sha}")
    if classifications.get("classificationStatus") != "frozen-before-treatment-unblinding":
        raise RuntimeError("failure classifications were not frozen before unblinding")
    if classifications.get("blindedResultsSha256") != blinded_sha:
        raise RuntimeError("failure classifications name another blinded export")
    if blinded.get("experiment") != EXPERIMENT_REF or classifications.get("experiment") != EXPERIMENT_REF:
        raise RuntimeError("analysis inputs name another experiment")

    experiment = yaml.safe_load(EXPERIMENT_PATH.read_text())
    assignment = experiment["design"]["randomization_manifest"]
    if assignment.get("execution_order_sha256") != blinded.get("assignment_sha256"):
        raise RuntimeError("experiment assignment hash differs from blinded export")
    rows = {row["cell_id"]: row for row in blinded["rows"]}
    cells = {cell["cell_id"]: cell for cell in assignment["cells"]}
    if set(rows) != set(cells):
        raise RuntimeError("assignment and blinded export contain different cells")

    host = {
        "schema": "yukon.representation-host-assignment.v1",
        "experiment": EXPERIMENT_REF,
        "assignment": assignment,
        "failureClassifications": classifications["classifications"],
    }

    active_cells = [cell for cell in assignment["cells"] if cell.get("administrative_replacement_for")]
    if len(active_cells) != 18:
        raise RuntimeError(f"expected 18 active replacement cells, found {len(active_cells)}")
    blocks = {block["id"]: block for block in experiment["design"]["blocks"]}
    task_records = []
    for task_id, anchors in sorted(TASK_ANCHORS.items()):
        task_blocks = sorted(block_id for block_id, block in blocks.items() if block["task"] == task_id)
        if len(task_blocks) != 2:
            raise RuntimeError(f"{task_id} does not have exactly two frozen histories")
        starts = []
        verifier_hashes = set()
        for block_id in task_blocks:
            block_cells = [cell for cell in active_cells if cell["block_id"] == block_id]
            if len(block_cells) != 3:
                raise RuntimeError(f"{block_id} does not have exactly three active cells")
            zeroes = [milestone_zero(rows[cell["cell_id"]]) for cell in block_cells]
            identities = {
                (
                    zero["candidate_content_sha256"],
                    zero["verification"]["score"],
                    zero["verifier_sha256"],
                )
                for zero in zeroes
            }
            if len(identities) != 1:
                raise RuntimeError(f"{block_id} arms do not share an identical sealed 0% milestone")
            candidate_hash, score, verifier_hash = identities.pop()
            assigned_hashes = {cell["candidate_artifact"].rsplit("/", 1)[-1] for cell in block_cells}
            if assigned_hashes != {candidate_hash}:
                raise RuntimeError(f"{block_id} assigned candidate differs from its 0% artifact")
            declared = blocks[block_id]["analysis_reference"]
            if declared["starting_score"] != score:
                raise RuntimeError(f"{block_id} sealed starting score differs from the frozen declaration")
            for field, expected in (
                ("metric_name", anchors["metricName"]),
                ("direction", anchors["direction"]),
                ("official_baseline_score", anchors["officialBaselineScore"]),
                ("reference_score", anchors["referenceScore"]),
            ):
                if declared[field] != expected:
                    raise RuntimeError(f"{block_id} changes frozen analysis anchor {field}")
            starts.append({
                "historyId": block_id,
                "candidateContentSha256": candidate_hash,
                "score": score,
                "verifierSha256": verifier_hash,
            })
            verifier_hashes.add(verifier_hash)
        if len(verifier_hashes) != 1:
            raise RuntimeError(f"{task_id} histories use different verifiers")
        verifier_hash = verifier_hashes.pop()
        task_records.append({
            "taskId": task_id,
            "metricName": anchors["metricName"],
            "direction": anchors["direction"],
            "officialBaselineScore": anchors["officialBaselineScore"],
            "startingCandidates": starts,
            "reference": {
                "score": anchors["referenceScore"],
                "candidateContentSha256": None,
                "verifierSha256": verifier_hash,
            },
        })
    tasks = {
        "schema": "yukon.representation-task-references.v3",
        "experiment": EXPERIMENT_REF,
        "tasks": task_records,
    }
    host_sha = write_immutable(HOST_OUTPUT, host)
    tasks_sha = write_immutable(TASKS_OUTPUT, tasks)
    print(json.dumps({
        "blindedResultsSha256": blinded_sha,
        "failureClassificationsSha256": classifications_sha,
        "hostAssignment": str(HOST_OUTPUT),
        "hostAssignmentSha256": host_sha,
        "taskReferences": str(TASKS_OUTPUT),
        "taskReferencesSha256": tasks_sha,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
