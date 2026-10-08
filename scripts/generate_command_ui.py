#!/usr/bin/env python3
"""Generate command input presentation types from OpenAPI and machine contracts."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.generate_api import generate as generate_openapi  # noqa: E402


def merge_schema(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Combine allOf object shapes while preserving ordinary schema keywords."""
    result = dict(left)
    for key, value in right.items():
        if key == "properties" and isinstance(value, dict):
            properties = dict(result.get(key, {}))
            for name, property_schema in value.items():
                if name in properties and isinstance(properties[name], dict) and isinstance(property_schema, dict):
                    properties[name] = merge_schema(properties[name], property_schema)
                else:
                    properties[name] = property_schema
            result[key] = properties
        elif key == "required" and isinstance(value, list):
            result[key] = sorted(set(result.get(key, [])) | set(value))
        elif key == "enum" and isinstance(value, list):
            if key in result:
                allowed = {json.dumps(item, ensure_ascii=False, sort_keys=True) for item in value}
                result[key] = [
                    item for item in result[key]
                    if json.dumps(item, ensure_ascii=False, sort_keys=True) in allowed
                ]
            else:
                result[key] = unique_values(value)
        else:
            result[key] = value
    return result


def resolve_schema(
    schema: dict[str, Any],
    components: dict[str, Any],
    active_refs: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Resolve refs/allOf and summarize union branches without losing enum values."""
    resolved: dict[str, Any] = {}
    reference = schema.get("$ref")
    if reference:
        prefix = "#/components/schemas/"
        if not reference.startswith(prefix):
            raise ValueError(f"unsupported OpenAPI schema reference: {reference}")
        name = reference[len(prefix):]
        if name in active_refs:
            raise ValueError(f"recursive schema reference while resolving {name}")
        resolved = resolve_schema(
            components[name], components, active_refs | {name}
        )

    for part in schema.get("allOf", []):
        resolved = merge_schema(
            resolved, resolve_schema(part, components, active_refs)
        )

    for union_key in ("oneOf", "anyOf"):
        branches = schema.get(union_key)
        if not branches:
            continue
        branch_views = [resolve_schema(branch, components, active_refs) for branch in branches]
        types: list[str] = []
        enum_values: list[Any] = []
        for view in branch_views:
            branch_type = view.get("type")
            if isinstance(branch_type, str):
                types.append(branch_type)
            elif isinstance(branch_type, list):
                types.extend(t for t in branch_type if isinstance(t, str))
            elif isinstance(view.get("enum"), list) and view["enum"]:
                types.append(infer_enum_type(view["enum"]))
            if isinstance(view.get("enum"), list):
                enum_values.extend(view["enum"])
            if "const" in view:
                enum_values.append(view["const"])
                if "type" not in view:
                    types.append(infer_enum_type([view["const"]]))
        if types:
            resolved["type"] = select_type(types)
        if enum_values:
            resolved["enum"] = unique_values(enum_values)

    for key, value in schema.items():
        if key in {"$ref", "allOf", "oneOf", "anyOf"}:
            continue
        resolved = merge_schema(resolved, {key: value})
    if "const" in schema:
        resolved = merge_schema(resolved, {"enum": [schema["const"]]})
        if "type" not in resolved:
            resolved["type"] = infer_enum_type([schema["const"]])
    return resolved


def unique_values(values: list[Any]) -> list[Any]:
    """Deduplicate JSON values, including object/array enum members."""
    seen: set[str] = set()
    result: list[Any] = []
    for value in values:
        marker = json.dumps(value, ensure_ascii=False, sort_keys=True)
        if marker not in seen:
            seen.add(marker)
            result.append(value)
    return result


def select_type(types: list[str]) -> str:
    """Choose a stable input kind, preserving decimal-compatible strings."""
    candidates = set(types) - {"null"}
    numeric_scalars = {"string", "integer", "number"}
    if "string" in candidates and candidates <= numeric_scalars:
        return "string"
    if len(candidates) == 1:
        return next(iter(candidates))
    if candidates == {"integer", "number"}:
        return "number"
    if not candidates:
        raise ValueError("schema union contains only null and has no input type")
    raise ValueError(f"schema union has unsupported input types: {sorted(candidates)}")


def request_payload_properties(
    operation: dict[str, Any], components: dict[str, Any]
) -> dict[str, Any]:
    request = operation.get("requestBody", {})
    content = request.get("content", {}).get("application/json", {})
    request_schema = content.get("schema")
    if not isinstance(request_schema, dict):
        raise ValueError("command operation is missing an application/json request schema")
    resolved_request = resolve_schema(request_schema, components)
    payload_schema = resolved_request.get("properties", {}).get("payload")
    if not isinstance(payload_schema, dict):
        raise ValueError("command request schema has no payload object")
    resolved_payload = resolve_schema(payload_schema, components)
    properties = resolved_payload.get("properties", {})
    if not isinstance(properties, dict):
        raise ValueError("command request payload properties must be an object")
    return properties


def is_domain_ref(
    schema: dict[str, Any],
    components: dict[str, Any],
    active_refs: frozenset[str] = frozenset(),
) -> bool:
    """Recognize canonical DomainRef aliases without matching nested ref-shaped objects."""
    reference = schema.get("$ref")
    if reference:
        prefix = "#/components/schemas/"
        if not reference.startswith(prefix):
            return False
        name = reference[len(prefix):]
        if name == "DomainRef":
            return True
        if name in active_refs or name not in components:
            return False
        target = components[name]
        # A named object with its own properties (for example ContractBOQItemRef)
        # is a custom payload, even if one of those properties contains a DomainRef.
        if any(key in target for key in ("properties", "oneOf", "anyOf", "items")):
            return False
        return is_domain_ref(target, components, active_refs | {name})

    all_of = schema.get("allOf")
    if not isinstance(all_of, list):
        return False
    # allOf may add descriptive/validation constraints to a DomainRef alias, but
    # adding fields creates a different structured object and is not a DomainRef.
    if any(key in schema for key in ("properties", "required", "oneOf", "anyOf", "items")):
        return False
    if any(is_domain_ref(part, components, active_refs) for part in all_of):
        return True
    return False


def reference_kind(schema: dict[str, Any], components: dict[str, Any]) -> str | None:
    if is_domain_ref(schema, components):
        return "single"
    resolved = resolve_schema(schema, components)
    if resolved.get("type") != "array":
        return None
    items = resolved.get("items")
    if isinstance(items, dict) and is_domain_ref(items, components):
        return "multiple"
    return None


def build_command_inputs() -> dict[str, dict[str, dict[str, dict[str, Any]]]]:
    openapi = generate_openapi()
    components = openapi["components"]["schemas"]
    machines = json.loads((ROOT / "app/schema/state_machines_v1.json").read_text())["machines"]
    bindings = json.loads((ROOT / "app/reference/machine_bindings_v1.json").read_text())["machines"]

    operations: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
    for path_name, path in openapi["paths"].items():
        for operation in path.values():
            if not isinstance(operation, dict):
                continue
            command_ref = operation.get("x-domain-command")
            if command_ref:
                if ":" not in command_ref:
                    raise ValueError(f"invalid x-domain-command value {command_ref!r}")
                machine, command = command_ref.split(":", 1)
                operations[(machine, command)] = (path_name, operation)

    command_inputs: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    for machine_name in sorted(machines):
        if machine_name not in bindings:
            raise ValueError(f"state machine {machine_name!r} has no API machine binding")
        machine = machines[machine_name]
        commands: dict[str, set[str]] = {}
        for transition in machine["transitions"]:
            commands.setdefault(transition["command"], set()).update(
                transition.get("payload_fields", [])
            )

        machine_inputs: dict[str, dict[str, dict[str, Any]]] = {}
        for command in sorted(commands):
            operation_binding = operations.get((machine_name, command))
            if operation_binding is None:
                raise ValueError(
                    f"machine binding {machine_name}:{command} has no OpenAPI command operation"
                )
            path_name, operation = operation_binding
            expected_prefix = f"/projects/{{projectId}}/{bindings[machine_name]['collection']}/"
            if not path_name.startswith(expected_prefix):
                raise ValueError(
                    f"OpenAPI {machine_name}:{command} path {path_name!r} does not match machine binding collection"
                )
            properties = request_payload_properties(operation, components)
            fields: dict[str, dict[str, Any]] = {}
            for field in sorted(commands[command]):
                if field not in properties:
                    raise ValueError(
                        f"OpenAPI {machine_name}:{command} payload has no contract field {field!r}"
                    )
                view = resolve_schema(properties[field], components)
                raw_type = view.get("type")
                if isinstance(raw_type, list):
                    input_type = select_type(raw_type)
                elif isinstance(raw_type, str):
                    input_type = raw_type
                else:
                    enum = view.get("enum")
                    if isinstance(enum, list) and enum:
                        input_type = infer_enum_type(enum)
                    elif "const" in view:
                        input_type = infer_enum_type([view["const"]])
                    else:
                        raise ValueError(
                            f"OpenAPI {machine_name}:{command}.{field} has no input type"
                        )
                entry: dict[str, Any] = {"type": input_type}
                ref_kind = reference_kind(properties[field], components)
                if ref_kind is not None:
                    entry["reference"] = ref_kind
                if isinstance(view.get("enum"), list):
                    entry["enum"] = view["enum"]
                fields[field] = entry
            machine_inputs[command] = fields
        command_inputs[machine_name] = machine_inputs
    return command_inputs


def infer_enum_type(values: list[Any]) -> str:
    types = {
        "boolean" if isinstance(value, bool)
        else "integer" if isinstance(value, int) and not isinstance(value, bool)
        else "number" if isinstance(value, (float, int)) and not isinstance(value, bool)
        else "string" if isinstance(value, str)
        else "object"
        for value in values
    }
    return select_type(sorted(types))


def render(command_inputs: dict[str, dict[str, dict[str, dict[str, Any]]]]) -> str:
    serialized = json.dumps(command_inputs, ensure_ascii=False, indent=2)
    return (
        "// Generated by scripts/generate_command_ui.py from OpenAPI command schemas and machine bindings.\n"
        "export const commandInputs: Record<string, Record<string, Record<string, { type: string; reference?: 'single' | 'multiple'; enum?: readonly unknown[] }>>> = "
        + serialized
        + " as const;\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    output_path = ROOT / "apps/web/src/data/command-fields.generated.ts"
    generated = render(build_command_inputs())
    if args.check:
        if not output_path.exists() or output_path.read_text() != generated:
            raise SystemExit("Command input metadata is stale: run python scripts/generate_command_ui.py")
        print("Command input metadata is current")
    else:
        output_path.write_text(generated)
        print(f"Generated {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
