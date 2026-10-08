#!/usr/bin/env python3
"""Exercise the work-inbox route over TCP with a persisted 50k-row dataset.

The dataset contains 45k records in the demo project and 5k in another project
to exercise project filtering. This is a development benchmark, not production
traffic or an SLO claim.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def cpu_rss(pid: int) -> tuple[int, int]:
    stat = Path(f"/proc/{pid}/stat").read_text()
    tail = stat[stat.rfind(")") + 2:].split()
    ticks = int(tail[11]) + int(tail[12])
    resident_pages = int(tail[21])
    return ticks, resident_pages * os.sysconf("SC_PAGE_SIZE")


def docker_run(arguments: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        env.pop(key, None)
    result = subprocess.run(["docker", "--host=unix:///var/run/docker.sock", *arguments],
                            cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180)
    if check and result.returncode:
        raise RuntimeError(f"Docker command failed: {result.stderr[-2000:]}")
    return result


def postgres_cpu_usec() -> dict[str, int]:
    output = docker_run(["exec", "doul-goal-ops-inbox-postgres", "cat", "/sys/fs/cgroup/cpu.stat"]).stdout
    return {name: int(value) for name, value in (line.split() for line in output.splitlines())}


def json_request(url: str, *, data: bytes | None = None, headers: dict | None = None) -> tuple[dict, float]:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    elapsed = (time.perf_counter() - start) * 1000
    return json.loads(body), elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=int, default=50_000)
    parser.add_argument("--visible-fraction-denominator", type=int, default=10)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--page-size", type=int, default=1)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.records < 100 or args.visible_fraction_denominator < 2 or args.rounds < 2 or not 1 <= args.page_size <= 100:
        parser.error("need >=100 rows, filter denominator >=2, 2+ rounds, and page size 1..100")

    container = "doul-goal-ops-inbox-postgres"
    docker_run(["run", "-d", "--name", container,
                "-p", "127.0.0.1:15434:5432",
                "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=1g",
                "-e", "POSTGRES_DB=ops_bench", "-e", "POSTGRES_USER=ops",
                "-e", "POSTGRES_PASSWORD=disposable-only", "postgres:16-bookworm"])
    try:
        deadline = time.time() + 60
        while True:
            status = docker_run(["exec", container, "pg_isready", "-U", "ops", "-d", "ops_bench"], check=False)
            if status.returncode == 0:
                break
            if time.time() >= deadline:
                raise RuntimeError("disposable PostgreSQL did not become ready")
            time.sleep(.5)

        dsn = "postgresql://ops:disposable-only@127.0.0.1:15434/ops_bench"
        from services.api.main import create_app
        from services.api.persistence import create_postgres_persistence
        store = create_postgres_persistence(dsn, demo=True)
        app = create_app(demo=True, persistence=store)
        store = app.state.store
        project_id = store.meta["projectId"]
        actor = store.meta["actors"]["SUP"]
        base = next(record for (kind, _), record in store.engine._records.items() if kind == "Issue")
        from app.reference.validation import ContractError
        from services.api.modules.work_inbox import INBOX_MACHINES
        baseline_eligible = 0
        for (kind, object_id), record in store.engine._records.items():
            machine = store.engine._record_machines.get((kind, object_id))
            if machine not in INBOX_MACHINES or record.get("projectId") != project_id:
                continue
            try:
                store.engine.authorize_read(record, actor["partyId"], actor["roleAssignmentId"])
            except ContractError as exc:
                if exc.code in {"NOT_AUTHORIZED", "NOT_FOUND", "SCOPE_MISMATCH", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID"}:
                    continue
                raise
            candidate = False
            for transition in store.engine.machines[machine]["transitions"]:
                if transition["from"] != record.get("status"):
                    continue
                try:
                    store.engine.authorize(record, transition["authority"], actor["partyId"], actor["roleAssignmentId"])
                except ContractError:
                    continue
                candidate = True
                break
            baseline_eligible += int(candidate)
        ineligible = 0
        with store.transaction(write=True):
            for index in range(args.records):
                record_id = f"ops-issue-{index:06d}"
                record = deepcopy(base)
                record["id"] = record_id
                record["version"] = 1
                # Visible records share the current issue's valid scope/status,
                # retaining the application's real authorization and candidate checks.
                visible = index % args.visible_fraction_denominator != 0
                if not visible:
                    record["projectId"] = "ops-other-project"
                store.engine._records[("Issue", record_id)] = record
                store.engine._record_machines[("Issue", record_id)] = "issue"
                if visible:
                    ineligible += 1
        store.close()

        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            port = reserved.getsockname()[1]
            server_code = (
                "import uvicorn; from services.api.main import create_app; "
                "from services.api.persistence import create_postgres_persistence; "
                f"p=create_postgres_persistence({dsn!r},demo=True); "
                f"uvicorn.run(create_app(demo=True,persistence=p),host='127.0.0.1',port={port},log_level='critical',access_log=False)"
            )
            server = subprocess.Popen(
                [sys.executable, "-c", server_code], cwd=ROOT,
                env=dict(os.environ, PYTHONPATH=str(ROOT)),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        try:
            base_url = f"http://127.0.0.1:{port}"
            deadline = time.time() + 30
            while True:
                try:
                    json_request(base_url + "/health")
                    break
                except (urllib.error.URLError, TimeoutError):
                    if server.poll() is not None or time.time() >= deadline:
                        raise RuntimeError("API process did not become ready")
                    time.sleep(.1)
            login, _ = json_request(
                base_url + "/dev/sessions", data=json.dumps({"actorGroup": "SUP"}).encode(),
                headers={"Content-Type": "application/json"},
            )
            project_id = login["projectId"]
            headers = {"Authorization": "Bearer " + login["accessToken"]}
            route = f"/projects/{project_id}/parallel/work-inbox"
            query = urllib.parse.urlencode({"limit": args.page_size})

            before_ticks, before_rss = cpu_rss(server.pid)
            database_before = postgres_cpu_usec()
            peak_rss = [before_rss]
            monitor_done = threading.Event()

            def monitor() -> None:
                while not monitor_done.wait(.02):
                    try:
                        peak_rss[0] = max(peak_rss[0], cpu_rss(server.pid)[1])
                    except (FileNotFoundError, ProcessLookupError):
                        return

            watcher = threading.Thread(target=monitor, daemon=True)
            watcher.start()
            samples = []
            first = None
            for _ in range(args.rounds):
                page, latency = json_request(base_url + route + "?" + query, headers=headers)
                if first is None:
                    first = page
                samples.append(latency)
            monitor_done.set()
            watcher.join()
            after_ticks, after_rss = cpu_rss(server.pid)

            assert first is not None
            page_ids = [row["record"]["id"] for row in first["records"]]
            assert len(page_ids) == args.page_size and first["limit"] == args.page_size
            assert first["total"] == ineligible + baseline_eligible, f"project-filtered total {first['total']} != expected synthetic-visible {ineligible} + baseline {baseline_eligible}; sample IDs={[r['record']['id'] for r in first['records']]}"
            assert all(not object_id.startswith("ops-issue-") or int(object_id[-6:]) % args.visible_fraction_denominator != 0 for object_id in page_ids)
            assert first["nextCursor"]
            next_page, pagination_latency = json_request(
                base_url + route + "?" + urllib.parse.urlencode({"limit": args.page_size, "cursor": first["nextCursor"]}),
                headers=headers,
            )
            next_ids = [row["record"]["id"] for row in next_page["records"]]
            assert len(next_ids) == args.page_size and not set(page_ids).intersection(next_ids)
            assert next_page["total"] == ineligible + baseline_eligible
            database_after = postgres_cpu_usec()

            result = {
                "scope": "Live TCP HTTP requests to FastAPI, PostgreSQL 16 snapshot adapter, persisted synthetic records",
                "datasetRows": args.records,
                "visibleProjectRows": ineligible,
                "filteredOtherProjectRows": args.records - ineligible,
                "baselineDemoRowsEligible": baseline_eligible,
                "pageSize": args.page_size,
                "rounds": args.rounds,
                "latencyMs": {
                    "samples": [round(value, 3) for value in samples],
                    "median": round(statistics.median(samples), 3),
                    "p95NearestRank": round(sorted(samples)[max(0, int(.95 * len(samples) + .999) - 1)], 3),
                    "secondPage": round(pagination_latency, 3),
                },
                "process": {
                    "pid": server.pid,
                    "cpuTicksDelta": after_ticks - before_ticks,
                    "clockTicksPerSecond": os.sysconf("SC_CLK_TCK"),
                    "cpuMsDelta": round((after_ticks - before_ticks) * 1000 / os.sysconf("SC_CLK_TCK"), 3),
                    "rssBeforeBytes": before_rss,
                    "rssAfterBytes": after_rss,
                    "rssPeakBytes": peak_rss[0],
                },
                "database": {
                    "container": container,
                    "adapter": "PostgresSnapshotAdapter",
                    "cpuUsageUsecBefore": database_before.get("usage_usec"),
                    "cpuUsageUsecAfter": database_after.get("usage_usec"),
                    "cpuUsageUsecDelta": database_after.get("usage_usec", 0) - database_before.get("usage_usec", 0),
                },
                "paginationAndProjectFiltering": f"passed; total and two non-overlapping {args.page_size}-row pages verified over HTTP",
                "contractLatencyBudget": None,
                "status": "measured-with-significant-latency-limit",
                "limitations": [
                    "Synthetic duplicate issue records only; one local API process and PostgreSQL snapshot development persistence",
                    "API process CPU and PostgreSQL cgroup CPU are separate; PostgreSQL stores one JSON snapshot, not normalized work rows",
                    "No API latency SLO or p95 budget was found in the inspected storage/performance contracts",
                    "Authorization uses the real demo role and scope checks; no browser rendering or concurrent clients",
                ],
            }
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2))
            return 0
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
    except BaseException:
        raise
    finally:
        docker_run(["rm", "-f", container], check=False)


if __name__ == "__main__":
    raise SystemExit(main())
