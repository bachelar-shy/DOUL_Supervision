#!/usr/bin/env python3
"""Fail closed before tests when installed dependencies differ from selected locks."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import subprocess
import sys

BOOTSTRAP = {"pip", "setuptools", "wheel"}
PROBE = """import importlib.metadata as m, json, sys, platform
print(json.dumps({"executable": sys.executable, "version": platform.python_version(),
"prefix": sys.prefix, "base_prefix": sys.base_prefix,
"packages": [[d.metadata["Name"], d.version] for d in m.distributions()]}))
"""

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def canonical(name):
    return re.sub(r"[-_.]+", "-", name).lower()

def read_pins(path):
    pins = {}
    for line in Path(path).read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        match = re.fullmatch(r"([\w.-]+)(?:\[([\w,.-]+)\])?==([^\s;]+)", line)
        if not match:
            raise ValueError("Only complete exact pins are supported: " + line)
        name, extras, version = match.groups()
        name = canonical(name)
        if name in pins and pins[name] != version:
            raise ValueError("Conflicting pin: " + name)
        pins[name] = version
        if extras:
            if name != "psycopg" or extras != "binary":
                raise ValueError("Pin extra distributions explicitly: " + line)
            pins["psycopg-binary"] = version
    if not pins:
        raise ValueError("Empty lock file")
    return pins

def compare_python(pins, installed):
    errors = []
    actual = {}
    for name, version in installed:
        name = canonical(name)
        if name in actual:
            errors.append("Duplicate distribution: " + name)
        actual[name] = version
    for name, version in pins.items():
        if actual.get(name) != version:
            errors.append(f"{name}: locked={version}, installed={actual.get(name, 'MISSING')}")
    for name in sorted(set(actual) - set(pins) - BOOTSTRAP):
        errors.append("Unpinned distribution: " + name)
    return errors

def clean_env():
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    return env

def check_python(root, executable, lock):
    lock = (root / lock).resolve()
    executable = os.path.abspath(executable)
    report = {"lock": str(lock), "lock_sha256": digest(lock), "profile": "production-api" if lock == (root / "services/api/requirements.lock").resolve() else "explicit-alternate", "requested_executable": executable}
    probe = subprocess.run([executable, "-I", "-c", PROBE], text=True,
                           capture_output=True, env=clean_env())
    if probe.returncode:
        raise ValueError("Python probe failed: " + probe.stderr)
    inventory = json.loads(probe.stdout)
    report.update({k: v for k, v in inventory.items() if k != "packages"})
    report["inventory_sha256"] = hashlib.sha256(
        json.dumps(sorted(inventory["packages"])).encode()).hexdigest()
    errors = compare_python(read_pins(lock), inventory["packages"])
    if inventory["prefix"] == inventory["base_prefix"]:
        errors.append("A dedicated virtualenv is required")
    compatible = subprocess.run([executable, "-I", "-m", "pip", "check"],
                                text=True, capture_output=True, env=clean_env())
    report["pip_check"] = compatible.stdout.strip()
    if compatible.returncode:
        errors.append("pip check failed: " + compatible.stdout + compatible.stderr)
    report["errors"] = errors
    return report

def compare_node(root, packages):
    errors = []
    manifests = {}
    installed = []
    fields = ("dependencies", "devDependencies", "optionalDependencies", "workspaces", "peerDependencies", "peerDependenciesMeta")
    for relative, locked in packages.items():
        path = root / relative
        if locked.get("link"):
            target = (root / locked["resolved"]).resolve()
            if not path.is_symlink() or path.resolve() != target:
                errors.append("Workspace link differs: " + relative)
            continue
        manifest = path / "package.json"
        if "node_modules" not in Path(relative).parts:
            if not manifest.is_file():
                errors.append("Missing workspace manifest: " + relative)
                continue
            actual = json.loads(manifest.read_text())
            manifests[relative] = digest(manifest)
            for field in fields:
                if actual.get(field, {} if field != "workspaces" else []) != locked.get(
                    field, {} if field != "workspaces" else []):
                    errors.append("Manifest/lock differ: " + relative + ":" + field)
            continue
        if not manifest.is_file():
            if not locked.get("optional"):
                errors.append("Missing locked package: " + relative)
            continue
        actual = json.loads(manifest.read_text())
        installed.append([relative, actual.get("version")])
        if actual.get("version") != locked.get("version"):
            errors.append("Locked version differs: " + relative)
    return errors, manifests, installed

def check_braces_backport(root, lock_data):
    metadata_path = root / "security/backports/braces-3.0.3.json"
    metadata = json.loads(metadata_path.read_text())
    expected = metadata["package"]
    matches = [(name, package) for name, package in lock_data["packages"].items()
               if name == "node_modules/braces" or name.endswith("/node_modules/braces")]
    errors = []
    report = {"metadata": str(metadata_path), "advisory": metadata["advisory"]["id"],
              "expected_version": expected["version"], "upstream_head": metadata["upstream"]["headCommit"],
              "files": []}
    if len(matches) != 1 or matches[0][0] != expected["lockPath"]:
        errors.append("braces backport expects exactly one locked copy at " + expected["lockPath"])
        report["errors"] = errors
        return report
    lock_path, locked = matches[0]
    if locked.get("version") != expected["version"] or locked.get("integrity") != expected["integrity"]:
        errors.append("braces lock identity differs from the reviewed backport source")
    package_root = root / lock_path
    manifest_path = package_root / "package.json"
    license_path = package_root / "LICENSE"
    if not manifest_path.is_file() or not license_path.is_file():
        errors.append("braces package or MIT license is missing; install locked dependencies first")
    else:
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("name") != expected["name"] or manifest.get("version") != expected["version"]:
            errors.append("installed braces identity differs from the reviewed backport source")
        if manifest.get("license") != metadata["license"]["expression"]:
            errors.append("installed braces license differs from the reviewed backport source")
    for source in metadata["files"]:
        target = package_root / source["path"]
        if not target.is_file():
            errors.append("braces backport source is missing: " + source["path"])
            continue
        actual_hash = digest(target)
        report["files"].append({"path": source["path"], "sha256": actual_hash,
                                "patched": actual_hash == source["patchedSha256"]})
        if actual_hash != source["patchedSha256"]:
            errors.append("braces security backport is missing or differs from the reviewed target: " + source["path"])
    report["errors"] = errors
    return report

def check_node_forge_backport(root, lock_data):
    metadata_path = root / "security/backports/node-forge-1.4.0.json"
    metadata = json.loads(metadata_path.read_text())
    expected = metadata["package"]
    matches = [(name, package) for name, package in lock_data["packages"].items()
               if name.endswith("node_modules/node-forge")]
    errors = []
    report = {"metadata": str(metadata_path), "advisory": metadata["advisory"]["id"],
              "expected_version": expected["version"], "expected_sha256": expected["patchedSha256"]}
    if len(matches) != 1 or matches[0][0] != expected["lockPath"]:
        errors.append("node-forge backport expects exactly one locked copy at " + expected["lockPath"])
        report["errors"] = errors
        return report
    lock_path, locked = matches[0]
    if locked.get("version") != expected["version"] or locked.get("integrity") != expected["integrity"]:
        errors.append("node-forge lock identity differs from the reviewed backport source")
    package_root = root / lock_path
    manifest_path = package_root / "package.json"
    target = package_root / expected["originalFile"]
    if not manifest_path.is_file() or not target.is_file():
        errors.append("node-forge package or RSA source is missing; install locked dependencies first")
    else:
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("name") != expected["name"] or manifest.get("version") != expected["version"]:
            errors.append("installed node-forge identity differs from the reviewed backport source")
        actual_hash = digest(target)
        report["installed_sha256"] = actual_hash
        if actual_hash != expected["patchedSha256"]:
            errors.append("node-forge RSA backport is missing or differs from the reviewed target")
    report["errors"] = errors
    return report

def check_node(root):
    lock = root / "package-lock.json"
    data = json.loads(lock.read_text())
    if data.get("lockfileVersion", 0) < 2:
        raise ValueError("package-lock v2/v3 required")
    errors, manifests, installed = compare_node(root, data["packages"])
    braces_backport = check_braces_backport(root, data)
    node_forge_backport = check_node_forge_backport(root, data)
    errors.extend(braces_backport["errors"])
    errors.extend(node_forge_backport["errors"])
    tree = subprocess.run(["npm", "ls", "--all", "--json"], cwd=root, text=True,
                          capture_output=True)
    try:
        problems = json.loads(tree.stdout).get("problems", [])
        errors.extend(problems)
    except json.JSONDecodeError:
        errors.append("npm ls did not produce valid JSON")
    if tree.returncode and not errors:
        errors.append("npm ls failed: " + tree.stderr)
    return {"lock": str(lock), "lock_sha256": digest(lock), "manifest_sha256": manifests,
            "inventory_sha256": hashlib.sha256(json.dumps(sorted(installed)).encode()).hexdigest(),
            "node_version": subprocess.check_output(["node", "--version"], text=True).strip(),
            "npm_version": subprocess.check_output(["npm", "--version"], text=True).strip(),
            "braces_backport": braces_backport,
            "node_forge_backport": node_forge_backport,
            "errors": errors}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--python", default=os.environ.get("DOUL_TEST_PYTHON", ".venv/bin/python"))
    parser.add_argument("--lock", default="services/api/requirements.lock")
    parser.add_argument("--node", action="store_true")
    parser.add_argument("--node-only", action="store_true")
    parser.add_argument("--report", type=Path, default=Path(".local/dependency-environment.json"))
    parser.add_argument("--suite", choices=["contracts", "api", "all"])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.node_only and args.suite:
        parser.error("--suite requires Python validation; omit --node-only")
    root = args.root.resolve()
    executable = Path(args.python).expanduser()
    if not executable.is_absolute():
        executable = root / executable
    report = {"root": str(root), "platform": sys.platform, "machine": platform.machine(), "errors": []}
    try:
        if not args.node_only:
            report["python"] = check_python(root, str(executable), args.lock)
            report["errors"].extend(report["python"]["errors"])
        if args.node or args.node_only:
            report["node"] = check_node(root)
            report["errors"].extend(report["node"]["errors"])
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        report["errors"].append(str(exc))
    report["ok"] = not report["errors"]
    output = args.report if args.report.is_absolute() else root / args.report
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    if not report["ok"]:
        return 2
    commands = []
    if args.suite in ("contracts", "all"):
        commands += [[str(executable), "scripts/validate_contracts.py"],
                     [str(executable), "-m", "unittest", "discover", "-s", "tests", "-q"]]
    if args.suite in ("api", "all"):
        commands.append([str(executable), "-m", "unittest", "discover", "-s", "tests_mvp", "-v"])
    if args.command:
        command = args.command[1:] if args.command[0] == "--" else args.command
        commands.append([str(executable) if item == "{python}" else item for item in command])
    env = clean_env()
    env["PATH"] = str(executable.parent) + os.pathsep + env["PATH"]
    for command in commands:
        result = subprocess.run(command, cwd=root, env=env)
        if result.returncode:
            return result.returncode
    return 0

if __name__ == "__main__":
    sys.exit(main())
