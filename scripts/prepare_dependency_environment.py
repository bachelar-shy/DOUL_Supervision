#!/usr/bin/env python3
"""Create/reuse one immutable virtualenv per lock and interpreter, without changing live envs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from dependency_environment import check_python, clean_env, digest, read_pins

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, help="Base Python executable")
    parser.add_argument("--lock", default="services/api/requirements.lock")
    parser.add_argument("--cache", type=Path, required=True, help="Shared external cache directory")
    args = parser.parse_args()
    root = Path.cwd().resolve()
    lock = (root / args.lock).resolve()
    read_pins(lock)
    lock_hash = digest(lock)
    runtime = subprocess.check_output([args.python, "-I", "-c",
        "import json,platform,sys; print(json.dumps([platform.python_implementation(), platform.python_version(), sys.platform, platform.machine()]))"],
        text=True, env=clean_env()).strip()
    key = hashlib.sha256((lock_hash + runtime).encode()).hexdigest()
    cache = args.cache.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / key
    guard = cache / (key + ".installing")
    try:
        guard.mkdir()
    except FileExistsError:
        raise SystemExit("Another installer holds " + str(guard) + "; wait for it, do not modify its environment.")
    try:
        executable = target / "bin/python"
        if not target.exists():
            subprocess.run([args.python, "-I", "-m", "venv", str(target)], check=True, env=clean_env())
            subprocess.run([str(executable), "-I", "-m", "pip", "install", "-r", str(lock)], check=True, env=clean_env())
        report = check_python(root, str(executable), str(lock))
        if digest(lock) != lock_hash or report["errors"]:
            raise SystemExit("Cache validation failed; do not reuse or mutate it: " + json.dumps(report))
        (target / "dependency-environment.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"python": str(executable), "cache_key": key, "lock_sha256": lock_hash}))
    finally:
        guard.rmdir()

if __name__ == "__main__":
    main()
