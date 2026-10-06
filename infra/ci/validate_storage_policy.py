#!/usr/bin/env python3
"""Validate the Platform storage operations baseline against Product invariants."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def require(condition: bool, message: str):
    if not condition:
        raise SystemExit(message)


policy = load("infra/storage_policy_v1.json")
domain = load("app/schema/domain_model_v2.json")
media = load("app/schema/media_analysis_contract_v1.json")

invariants = set(domain["invariants"])
require("evidence_original_immutable" in invariants, "Domain original-evidence invariant missing")
require("official_records_no_physical_delete" in invariants, "Domain no-delete invariant missing")
require(
    "derived_evidence_has_immutable_parent_and_source_range" in invariants,
    "Domain derived-evidence invariant missing",
)
require(media["original_evidence_immutable"] is True, "Media contract original-evidence invariant changed")
require(media["upload"]["server_hash_verification"] is True, "Media contract server hash verification changed")
require("verify_hash_mime_and_quarantine" in media["pipeline"], "Media quarantine gate missing")

original = policy["object_classes"]["original_evidence"]
require(original["immutable"] is True, "Platform policy must keep original evidence immutable")
require(original["physical_delete"] is False, "Platform policy must prohibit original evidence physical delete")
require(original["hash_algorithm"] == "sha256", "Platform policy must require SHA-256")
require(original["quarantine_before_finalize"] is True, "Platform policy must quarantine before finalize")
require(original["server_hash_verification"] is True, "Platform policy must verify hash server-side")

derived = policy["object_classes"]["derived_evidence"]
require(derived["immutable_parent_required"] is True, "Derived evidence must keep immutable parent")
require(derived["source_range_required"] is True, "Derived evidence must keep source range")

access = policy["access"]
require(access["default_private"] is True, "Storage must default private")
require(access["anonymous_public_access_prohibited"] is True, "Anonymous public access must be prohibited")
require(access["cross_project_access_prohibited"] is True, "Cross-project access must be prohibited")

retention = policy["retention"]
require(retention["period_days"] is None, "Platform must not invent a retention duration")
require(retention["platform_must_not_invent_period"] is True, "Retention ownership boundary missing")
require(retention["official_record_physical_delete_prohibited"] is True, "Official records must not be physically deleted")

consistency = policy["consistency"]
require(consistency["database_and_object_storage_not_assumed_atomic"] is True, "DB/object atomicity assumption is unsafe")
require(consistency["reconciliation_required"] is True, "Reconciliation is required")
require(consistency["reconciliation_must_not_invent_domain_success"] is True, "Reconciliation cannot create domain success")

require(policy["encryption"]["transport"]["pilot"] == "tls-required", "Pilot transport must require TLS")
require(policy["encryption"]["at_rest"]["pilot"] == "required", "Pilot at-rest encryption required")
require(policy["backup_recovery"]["restore_test_required_before_pilot"] is True, "Pilot requires restore test")
require(policy["observability"]["system_log_separate_from_business_audit"] is True, "System/Audit logs must remain separate")

print("storage-policy-ok")
