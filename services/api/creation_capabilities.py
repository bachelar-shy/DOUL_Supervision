"""Server-derived create affordances for the current project assignment.

Capabilities are advisory presentation data. The engine remains the authority
at create time and rechecks the same machine binding, scope, and qualification
gates against the submitted record.
"""

from copy import deepcopy

from app.reference.validation import ContractError


_MISSING_PREREQUISITES = {
    "QUALIFICATION_INVALID",
    "QUALIFICATION_RULE_MISSING",
}
_UNAUTHORIZED = {
    "NOT_AUTHORIZED",
    "ASSIGNMENT_EXPIRED",
    "SCOPE_MISMATCH",
    "ORGANIZATION_MISMATCH",
    "NONHUMAN_OFFICIAL_DENIED",
    "PROJECT_MISMATCH",
}


def _scope_gaps(policy, scope):
    required = []
    for enabled, field in (
        (policy.get("discipline_scope_required"), "discipline"),
        (policy.get("package_scope_required"), "packageId"),
        (policy.get("location_scope_required"), "locationId"),
    ):
        if enabled:
            required.append(field)
    return [field for field in required if not scope.get(field)]


def build_creation_capabilities(
    engine,
    project_id,
    party_id,
    role,
    project_scope,
    *,
    queue_enabled=True,
    connected=True,
    machine_bindings=None,
):
    """Return capabilities keyed by every machine known to the engine.

    ``project_scope`` must come from trusted project configuration. It is used
    only to probe the create authority; user supplied form data never changes
    this result. Creation itself still runs through ``engine.create``.
    """
    bindings = machine_bindings or engine.machine_bindings
    scope = deepcopy(project_scope) if isinstance(project_scope, dict) else {}
    result = {}

    for machine in engine.machines:
        binding = bindings.get(machine, {})
        authority = binding.get("create_authority")
        entry = {
            "machine": machine,
            "authority": authority,
            "status": "unauthorized",
            "canCreate": False,
            "reasons": [],
        }

        if not authority or authority not in engine.policies:
            entry["status"] = "unavailable"
            entry["reasons"].append("CREATE_AUTHORITY_UNAVAILABLE")
            result[machine] = entry
            continue

        if not connected:
            entry["status"] = "unavailable"
            entry["reasons"].append("CONNECTIVITY_UNAVAILABLE")
            result[machine] = entry
            continue

        if machine == "analysis_run" and not queue_enabled:
            entry["status"] = "unavailable"
            entry["reasons"].append("ANALYSIS_QUEUE_UNAVAILABLE")
            result[machine] = entry
            continue

        if not scope:
            entry["status"] = "prerequisites_missing"
            entry["reasons"].append("PROJECT_SCOPE_UNAVAILABLE")
            result[machine] = entry
            continue

        policy = engine.policies[authority]
        missing_scope = _scope_gaps(policy, scope)
        if missing_scope:
            entry["status"] = "prerequisites_missing"
            entry["reasons"] = ["PROJECT_SCOPE_MISSING:" + field for field in missing_scope]
            result[machine] = entry
            continue

        probe = {"projectId": project_id, **scope}
        try:
            engine.authorize(probe, authority, party_id, role["id"])
        except ContractError as exc:
            if exc.code in _MISSING_PREREQUISITES:
                entry["status"] = "prerequisites_missing"
            elif exc.code in _UNAUTHORIZED:
                entry["status"] = "unauthorized"
            else:
                # Unknown or newly added engine guards fail closed in the UI.
                entry["status"] = "prerequisites_missing"
            entry["reasons"].append(exc.code)
        else:
            entry["status"] = "available"
            entry["canCreate"] = True

        result[machine] = entry

    return result
