#!/usr/bin/env python3
"""Reproducible projection-only benchmark; does not model DB, SDK or command-preview costs."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import statistics
import sys
import time
import tracemalloc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.api.modules.work_inbox import build_work_inbox

class QueryEngine:
    def __init__(self, count):
        payload = {"checks": [{"values": list(range(128))} for _ in range(4)]}
        self._records = {("Issue", f"issue-{i:06}"): {
            "id": f"issue-{i:06}", "projectId": "project", "status": "under_review",
            "version": 3, "updatedAt": "2026-10-08T00:00:00Z", "data": payload,
        } for i in range(count)}
        self._record_machines = {key: "issue" for key in self._records}
        self.reads = 0

    def get(self, kind, object_id):
        self.reads += 1
        return deepcopy(self._records[(kind, object_id)])

def measure(count, rounds):
    engine = QueryEngine(count)
    samples = []
    for _ in range(rounds):
        engine.reads = 0
        preflights = 0
        def preflight(machine, row, session, role):
            nonlocal preflights
            preflights += 1
            return [{"command": "issue.review", "expectedVersion": row["version"], "ready": True}]
        cpu_start, start = time.process_time(), time.perf_counter()
        result = build_work_inbox(engine, "project", {}, {"id": "role", "projectId": "project", "active": True},
            readable=lambda *args: None, has_candidates=lambda *args: True, preflight=preflight, limit=1)
        samples.append({"wall_ms": (time.perf_counter()-start)*1000,
                        "cpu_ms": (time.process_time()-cpu_start)*1000,
                        "record_gets": engine.reads, "preflights": preflights})
        assert result["total"] == count and engine.reads == preflights == 1
    tracemalloc.start()
    result = build_work_inbox(engine, "project", {}, {"id": "role", "projectId": "project", "active": True},
        readable=lambda *args: None, has_candidates=lambda *args: True, preflight=preflight, limit=1)
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {"records": count, "limit": 1, "rounds": rounds, "samples": samples,
            "median_wall_ms": statistics.median(s["wall_ms"] for s in samples),
            "median_cpu_ms": statistics.median(s["cpu_ms"] for s in samples),
            "projection_peak_python_bytes": peak, "projection_retained_python_bytes": current}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    result = {"scope": "Projection-only; cheap synthetic guards/preflight, shared immutable nested source payload",
              "excludes": ["source engine construction", "real authorization/dependency reads", "command-preview clone",
                           "API/store transaction", "persistence IO", "process RSS/native memory"],
              "measurements": [measure(n, args.rounds) for n in [3500, 50000]]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
