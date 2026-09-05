#!/usr/bin/env python3
"""Freeze the v36 outcome and derive auditable secondary statistics.

The primary contrasts are copied from Yukon's preregistered analyzer. This
script independently joins the still-blinded executor export to the frozen host
assignment, checks the spend ledger, and derives descriptive usage, reading,
evaluation, milestone, and diversity statistics. It performs no model calls.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path


EXPECTED = {
    "kg/studies/dungeness-representation-v1/results/v36-pilot-analysis.json":
        "364df0c9cf815b0a12fc47713d982e8367dbf7c4350358539e79c5348495f182",
    "kg/studies/dungeness-representation-v1/results/v36-failure-classifications.json":
        "ebb82c9cc20ecc80cb22bc959eb3c96c2d088e86108bb9b02047a0d6b593038d",
    "kg/studies/dungeness-representation-v1/results/v36-host-assignment.json":
        "3387add7d2e85601856093d6247b506b8906a9f91896368be8ebf651ac2bc8c1",
    "kg/studies/dungeness-representation-v1/results/v36-task-references.json":
        "e9587ac2841fd7cbecc279f4d2b5fb5496f0937ebe6edded1053ea7113ee138b",
    "eval/experiment-results/users/bx/dungeness-representation-v36-terminal-milestone-restart/blinded-results.json":
        "69a08cd78555d4ef6f66ff6d83d100eb4ff71b3f68e37aeb98678bb2f346437a",
    "eval/runs/.study-spend-ledgers/knowledge-representation-autoresearch-v1/ledger.json":
        "18b4a6e385079c6d6d8a830d5cbacb1e9dc5079eeb84c21f784eee17d04604fd",
    "kg/studies/dungeness-representation-v1/research/EXPERIMENTS/v37-toy-reserve-calibration.json":
        "cc8a7ed340abc31209a0d5799da46f873ec7a1ad3220a478b519b2c6d5af162a",
    "kg/studies/dungeness-representation-v1/research/EXPERIMENTS/v37-vliw-reserve-calibration.json":
        "7a1676cbc878d8062c64529dee1b7993cf035c8e6d20d87ebc56857a01e4b221",
    "kg/studies/dungeness-representation-v1/v37-ecdsa-reserve-selection.json":
        "f25e5e150d94aab7f48998071f3f14cc03a556d3b6791a8a28f7de831cba3a2c",
    "eval/controlled-history-plans/v37-toy-reserve.json":
        "8baa7f340c40c8f4e2b1fa7875252f9666af88ac8ccc42d73eba79ee44aec4ff",
    "eval/controlled-history-plans/v37-vliw-reserve.json":
        "548790e348233352a4652878e280927360241def400c8e1bd12a8c85ea494155",
    "eval/history-bank-plans/v37-ecdsa-reserve-v2.json":
        "b97acac88ccd34897624525457c1a2b2ccb4d6ca2b4078245fc04c4698bc655e",
    "eval/research-event-exports/v37-ecdsa-archive-c.json":
        "c6f4fb3590ddb4ef1f822604f27fe8eaa3ee0fcab2051c8d455a28dbdc332f95",
}

STUDY = "dungeness-representation-v36-terminal-milestone-restart"
ARMS = ("R0", "R1", "R2")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def decimal_sum(values) -> Decimal:
    return sum((Decimal(str(value)) for value in values), Decimal("0"))


def mean(values):
    values = list(values)
    return sum(values) / len(values)


def task_equal_mean(rows, field):
    by_task = defaultdict(list)
    for row in rows:
        by_task[row["taskId"]].append(row[field])
    return mean(mean(values) for values in by_task.values())


def compact_contrast(contrast):
    return {
        "progress_auc": {
            "estimate": contrast["auc"]["estimate"],
            "interval_95": [contrast["auc"]["lowerBound"], contrast["auc"]["upperBound"]],
            "probability_of_improvement": contrast["auc"]["probabilityOfImprovement"],
        },
        "final_score": {
            "estimate": contrast["final"]["estimate"],
            "interval_95": [contrast["final"]["lowerBound"], contrast["final"]["upperBound"]],
            "noninferior_within_0_25": contrast["final"]["noninferiority"]["supported"],
        },
    }


def build_freeze(root: Path):
    for relative, expected in EXPECTED.items():
        actual = sha256(root / relative)
        if actual != expected:
            raise SystemExit(f"hash mismatch for {relative}: expected {expected}, got {actual}")

    analysis = load_json(root / "kg/studies/dungeness-representation-v1/results/v36-pilot-analysis.json")
    blinded = load_json(root / "eval/experiment-results/users/bx" / STUDY / "blinded-results.json")
    assignment = load_json(root / "kg/studies/dungeness-representation-v1/results/v36-host-assignment.json")
    failures = load_json(root / "kg/studies/dungeness-representation-v1/results/v36-failure-classifications.json")
    ledger = load_json(root / "eval/runs/.study-spend-ledgers/knowledge-representation-autoresearch-v1/ledger.json")

    if analysis["schema"] != "yukon.representation-analysis.v3":
        raise SystemExit("unexpected analysis schema")
    if analysis["pilot"]["decision"] != "PILOT_INCONCLUSIVE":
        raise SystemExit("unexpected pilot decision")
    validation = analysis["validation"]
    if validation != {
        "activeBlocks": 6,
        "activeCells": 18,
        "administrativeFailures": 18,
        "apparatusGatesPassed": True,
        "blindedLeakageCheck": "passed-before-assignment-join",
        "completeActiveBlocks": True,
        "failureClassificationsFrozenToBlindedResults": True,
        "protocolViolations": 0,
        "treatmentFailures": 1,
    }:
        raise SystemExit(f"unexpected validation summary: {validation}")
    if len(blinded["rows"]) != 36:
        raise SystemExit("expected 36 retained blinded rows")

    cells = assignment["assignment"]["cells"]
    active_cells = {row["cell_id"]: row for row in cells if not row.get("administrative_failure", False)}
    if len(active_cells) != 18:
        raise SystemExit("expected 18 active assignment cells")
    completed = [row for row in blinded["rows"] if row["status"] == "completed"]
    if len(completed) != 18 or {row["cell_id"] for row in completed} != set(active_cells):
        raise SystemExit("completed blinded rows do not exactly match active assignment cells")

    outcomes = analysis["outcomes"]
    outcome_by_cell = {row["cellId"]: row for row in outcomes}
    if set(outcome_by_cell) != set(active_cells):
        raise SystemExit("analysis outcomes do not exactly match active assignment cells")

    by_arm = {arm: [] for arm in ARMS}
    for row in completed:
        by_arm[active_cells[row["cell_id"]]["treatment"]].append(row)
    if any(len(rows) != 6 for rows in by_arm.values()):
        raise SystemExit("active cells are not balanced 6/6/6")

    arm_stats = {}
    total_development_events = 0
    total_valid_development_events = 0
    for arm in ARMS:
        rows = by_arm[arm]
        arm_outcomes = [outcome_by_cell[row["cell_id"]] for row in rows]
        view_tokens = []
        view_index_tokens = []
        development_hashes = set()
        development_events = 0
        valid_development_events = 0
        repeated_within_chain = 0
        changed_outer_hashes = set()
        chains_with_outer_change = 0
        first_gain_milestones = []

        for row in rows:
            chain_root = root / "eval/study-chains/users/bx" / STUDY / row["cell_id"]
            chain = load_json(chain_root / "record.json")
            if chain["data"]["status"] != "completed" or len(chain["data"]["rounds"]) != 3:
                raise SystemExit(f"incomplete chain record for {row['cell_id']}")
            chain_event_hashes = []
            for round_record in chain["data"]["rounds"]:
                view_ref = round_record["parent_research_view"]
                prefix = "research-view:users/bx/"
                if not view_ref.startswith(prefix):
                    raise SystemExit(f"unexpected research view ref: {view_ref}")
                view = load_json(root / "eval/research-views/users/bx" / f"{view_ref[len(prefix):]}.yaml")
                if view["data"]["renderer"]["variant"] != arm:
                    raise SystemExit(f"view treatment mismatch for {row['cell_id']}")
                view_tokens.append(view["data"]["tokens"]["total"])
                view_index_tokens.append(view["data"]["tokens"]["index"])

                evaluations_root = root / "eval/runs/users/bx" / round_record["run_id"] / "usage/evaluations"
                round_events = [
                    load_json(event_path)
                    for event_path in sorted(evaluations_root.glob("*/event.json"))
                ] if evaluations_root.exists() else []
                if len(round_events) != len(round_record["development_evaluation_ids"]):
                    raise SystemExit(f"evaluation count mismatch for {round_record['run_id']}")
                for event in round_events:
                    development_events += 1
                    total_development_events += 1
                    if event["status"] == "ok" and event["valid"] is True and event["metric"].get("value") is not None:
                        valid_development_events += 1
                        total_valid_development_events += 1
                    content_hash = event["content_sha256"]
                    development_hashes.add(content_hash)
                    chain_event_hashes.append(content_hash)
            repeated_within_chain += len(chain_event_hashes) - len(set(chain_event_hashes))

            starting_hash = next(item["candidate_content_sha256"] for item in row["milestones"] if item["percent"] == 0)
            changed = {
                item["candidate_content_sha256"]
                for item in row["milestones"]
                if item["percent"] > 0 and item["candidate_content_sha256"] != starting_hash
            }
            changed_outer_hashes.update(changed)
            chains_with_outer_change += bool(changed)

            outcome = outcome_by_cell[row["cell_id"]]
            first = next((point["fraction"] for point in outcome["curve"] if point["gain"] >= 1), None)
            if first is not None:
                first_gain_milestones.append(round(100 * first))

        usage = {
            "usd": float(decimal_sum(row["usage"]["usd"] for row in rows)),
            "model_tokens": sum(row["usage"]["model_tokens"] for row in rows),
            "agent_seconds": sum(row["usage"]["agent_seconds"] for row in rows),
        }
        arm_stats[arm] = {
            "chains": 6,
            "task_equal_progress_auc": task_equal_mean(arm_outcomes, "progressAuc"),
            "task_equal_final_gain": task_equal_mean(arm_outcomes, "finalGain"),
            "usage": usage,
            "research_view_token_proxy": {
                "sessions": len(view_tokens),
                "total": sum(view_tokens),
                "mean_per_session": mean(view_tokens),
                "index_total": sum(view_index_tokens),
                "policy": "utf8-bytes-ceil-div2.v1",
            },
            "development_evaluations": {
                "total": development_events,
                "valid_numeric": valid_development_events,
                "valid_rate": valid_development_events / development_events if development_events else None,
                "distinct_candidate_hashes": len(development_hashes),
                "repeat_evaluations_within_chain": repeated_within_chain,
            },
            "outer_candidate_diversity": {
                "distinct_changed_candidate_hashes": len(changed_outer_hashes),
                "chains_with_candidate_change": chains_with_outer_change,
            },
            "first_meaningful_gain": {
                "chains_reaching_one_gain": len(first_gain_milestones),
                "first_observed_milestone_percent": sorted(first_gain_milestones),
            },
        }

    if total_development_events != 43 or total_valid_development_events != 43:
        raise SystemExit(
            f"expected 43/43 valid development events, got {total_valid_development_events}/{total_development_events}"
        )

    milestone_statuses = defaultdict(int)
    for row in completed:
        for milestone in row["milestones"]:
            milestone_statuses[milestone["verification"]["status"]] += 1
    if dict(milestone_statuses) != {"ok": 89, "invalid": 1}:
        raise SystemExit(f"unexpected milestone validity: {dict(milestone_statuses)}")

    reservations = list(ledger["reservations"].values())
    settled = [item for item in reservations if item["status"] == "settled"]
    active = [item for item in reservations if item["status"] == "active"]
    settled_usd = decimal_sum(item["actual_usd"] for item in settled)
    active_usd = decimal_sum(item["reserved_usd"] for item in active)
    v36_usd = decimal_sum(row["usage"]["usd"] for row in completed)
    if v36_usd.quantize(Decimal("0.000001")) != Decimal("37.412034"):
        raise SystemExit(f"unexpected v36 spend: {v36_usd}")

    failure_rows = failures.get("classifications", failures.get("rows", []))
    if not failure_rows:
        raise SystemExit("frozen failure classifications are empty")

    contrasts = {key: compact_contrast(analysis["contrasts"][key]) for key in ("R1-R0", "R2-R0", "R2-R1")}
    pilot_gates = analysis["pilot"]["gates"]

    return {
        "schema": "dungeness.representation-v36-result-freeze.v1",
        "frozen_at": "2026-08-28",
        "claim_scope": "deterministic organization of byte-identical verified ResearchEvent atoms",
        "decision": {
            "pilot": "PILOT_INCONCLUSIVE",
            "universal_winner_established": False,
            "statistically_indistinguishable_best_set_at_pilot_resolution": ["R0", "R1", "R2"],
            "operational_default": "R0",
            "default_basis": "simplest member of the indistinguishable set; not evidence that R0 is superior",
            "conditional_signal": "R1/R2 gains were confined to different VLIW histories and did not generalize to Toy ISA or ECDSA",
            "kimi_replication_started": False,
            "kimi_replication_gate": {
                "R1-R0": pilot_gates["R1-R0"],
                "R2-R0": pilot_gates["R2-R0"],
            },
            "confirmation_started": False,
        },
        "validation": validation,
        "contrasts": contrasts,
        "block_outcomes": [
            {
                "task": row["taskId"],
                "history": row["historyId"],
                "representation": row["representation"],
                "progress_auc": row["progressAuc"],
                "final_gain": row["finalGain"],
            }
            for row in sorted(outcomes, key=lambda value: (value["taskId"], value["historyId"], value["representation"]))
        ],
        "secondary": {
            "by_arm": arm_stats,
            "development_evaluations": {"valid_numeric": 43, "total": 43, "valid_rate": 1},
            "outer_milestones": {"valid": 89, "invalid_treatment_failure": 1, "total": 90, "valid_rate": 89 / 90},
        },
        "spend": {
            "ceiling_usd": 500,
            "v36_completed_chains_actual_usd": float(v36_usd),
            "ledger_settled_actual_usd": float(settled_usd),
            "ledger_active_fail_closed_reservations_usd": float(active_usd),
            "ledger_committed_usd": float(settled_usd + active_usd),
            "settled_reservations": len(settled),
            "active_reservations": len(active),
        },
        "reserve_extension": {
            "decision": "STOP_BEFORE_MODEL_CALLS",
            "paid_model_calls": 0,
            "reason": "the frozen one-history-per-task extension could not qualify a balanced ECDSA reserve history",
            "toy_isa": {
                "status": "qualified-model-free",
                "history_bank": "history-bank:users/bx/cee69a15c62e538a503a53419a933784a4893c11b5298f65148d39aaf6808012",
                "view_tokens": {"R0": 5396, "R1": 5890, "R2": 6237},
            },
            "vliw": {
                "status": "qualified-model-free",
                "history_bank": "history-bank:users/bx/41278520d94c4ea16a5431693b46e847a672af749b6ec62fc53685feb8a4cc27",
                "view_tokens": {"R0": 6705, "R1": 7200, "R2": 7546},
            },
            "ecdsa_natural_archive": {
                "status": "failed-context-gate",
                "history_bank": "history-bank:users/bx/6d61535d6102cc4a156aa6ee777542bdfd76d7b22c73d224d86d5aea36682681",
                "R0_tokens": 46825,
                "limit": 32000,
            },
            "ecdsa_synthetic_small_diff": {
                "status": "failed-clean-validity-gate",
                "commit": "292329a5dc24d5d6aace5dd700a99a9f638c4bc2",
                "classical_mismatches": 5,
                "phase_garbage_batches": 4,
            },
        },
        "known_risk": "AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed",
        "inputs": [{"path": path, "sha256": digest} for path, digest in sorted(EXPECTED.items())],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="compare the existing freeze to a fresh derivation")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[5]
    output = Path(__file__).resolve().with_name("v36-result-freeze.json")
    derived = build_freeze(root)
    bytes_out = (json.dumps(derived, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if args.verify:
        if output.read_bytes() != bytes_out:
            raise SystemExit("existing result freeze differs from fresh derivation")
        action = "verified"
    else:
        with output.open("xb") as handle:
            handle.write(bytes_out)
        action = "created"
    print(json.dumps({"action": action, "path": output.relative_to(root).as_posix(), "sha256": sha256(output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
