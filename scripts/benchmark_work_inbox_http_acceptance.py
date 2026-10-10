#!/usr/bin/env python3
"""Measure the work inbox over real loopback HTTP with disposable PostgreSQL.

The default fixture writes 50,000 synthetic Issue records (45,000 in the demo
project, including one deliberately unreadable same-project row; 5,000 in a
different project). It is descriptive development evidence, not an SLO claim.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import platform
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT


def _proc_stats(pid: int) -> tuple[int, int] | None:
    """Return process CPU ticks and RSS bytes on Linux, or None elsewhere."""
    stat_path = Path(f"/proc/{pid}/stat")
    if not stat_path.is_file():
        return None
    stat = stat_path.read_text()
    tail = stat[stat.rfind(")") + 2:].split()
    ticks = int(tail[11]) + int(tail[12])
    resident_pages = int(tail[21])
    return ticks, resident_pages * os.sysconf("SC_PAGE_SIZE")


def _ps_rss(pid: int) -> int | None:
    """Portable POSIX RSS fallback; ps reports KiB on the supported hosts."""
    try:
        result = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], check=True,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        value = result.stdout.strip()
        return int(value) * 1024 if value else None
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


def _parse_ps_time(value: str) -> float | None:
    """Parse POSIX ps TIME/CPTIME fields: [[days-]hours:]minutes:seconds."""
    value = value.strip()
    if not value:
        return None
    days = 0
    if "-" in value:
        day_text, value = value.split("-", 1)
        days = int(day_text)
    parts = value.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = int(parts[0]), int(parts[1]), float(parts[2])
    elif len(parts) == 2:
        hours, minutes, seconds = 0, int(parts[0]), float(parts[1])
    else:
        return None
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def _ps_cpu_seconds(pid: int) -> float | None:
    """Portable POSIX accumulated CPU time fallback, including macOS."""
    try:
        result = subprocess.run(["ps", "-o", "cputime=", "-p", str(pid)], check=True,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return _parse_ps_time(result.stdout)
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


def docker_run(arguments: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["docker", *arguments], cwd=APP_ROOT, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if check and result.returncode:
        raise RuntimeError(f"Docker command failed: {result.stderr[-2000:]}")
    return result


def postgres_cpu_usec(container: str) -> dict[str, int] | None:
    result = docker_run(["exec", container, "cat", "/sys/fs/cgroup/cpu.stat"], check=False)
    if result.returncode:
        return None
    try:
        return {name: int(value) for name, value in (line.split() for line in result.stdout.splitlines())}
    except (ValueError, TypeError):
        return None


def request(url: str, *, data: bytes | None = None, headers: dict | None = None,
            timeout: float = 180) -> tuple[dict, float, int]:
    req = urllib.request.Request(url, data=data, headers=headers or {},
                                 method="POST" if data is not None else "GET")
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
    return json.loads(body), (time.perf_counter() - start) * 1000, len(body)


def expect_denial(url: str, headers: dict, *, expected_code: str) -> dict:
    try:
        request(url, headers=headers)
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read())
        assert exc.code == 403, f"expected 403, received {exc.code}: {body}"
        assert body.get("code") == expected_code, f"expected {expected_code}: {body}"
        return {"statusCode": exc.code, "code": body["code"]}
    raise AssertionError(f"expected denied request with {expected_code}")


def rank_p95(samples: list[float]) -> float:
    return sorted(samples)[max(0, math.ceil(.95 * len(samples)) - 1)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=int, default=50_000)
    parser.add_argument("--visible-fraction-denominator", type=int, default=10)
    parser.add_argument("--rounds", type=int, default=30,
                        help="timed requests per page size; minimum 30 for this evidence harness")
    parser.add_argument("--warmups", type=int, default=2)
    parser.add_argument("--page-sizes", type=int, nargs="+", default=[1, 100])
    parser.add_argument("--app-root", type=Path, default=ROOT)
    parser.add_argument("--postgres-image", default="postgres:16-bookworm",
                        help="already available PostgreSQL Docker image (server major must be 16)")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.records < 100 or args.visible_fraction_denominator < 2 or args.rounds < 30 or args.warmups < 0:
        parser.error("need >=100 rows, filter denominator >=2, >=30 rounds, and nonnegative warmups")
    if not args.page_sizes or any(not 1 <= n <= 100 for n in args.page_sizes):
        parser.error("page sizes must be 1..100")
    app_root = args.app_root.resolve()
    if not (app_root / "services/api/main.py").is_file():
        parser.error("--app-root must point to a checkout containing services/api/main.py")
    global APP_ROOT
    APP_ROOT = app_root
    sys.path.insert(0, str(APP_ROOT))
    from app.reference.validation import ContractError

    container = f"doul-inbox-bench-{uuid4().hex[:10]}"
    image_info = docker_run([
        "image", "inspect", "--format", "{{.Id}} {{json .RepoDigests}}", args.postgres_image,
    ]).stdout.strip()
    server = None
    try:
        docker_run(["run", "-d", "--name", container,
                    "-p", "127.0.0.1::5432",
                    "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=1g",
                    "-e", "POSTGRES_DB=ops_bench", "-e", "POSTGRES_USER=ops",
                    "-e", "POSTGRES_PASSWORD=disposable-only", args.postgres_image])
        port_info = docker_run(["port", container, "5432/tcp"]).stdout.strip().splitlines()[0]
        postgres_port = int(port_info.rsplit(":", 1)[1])
        deadline = time.time() + 90
        while True:
            status = docker_run(["exec", container, "pg_isready", "-U", "ops", "-d", "ops_bench"], check=False)
            if status.returncode == 0:
                break
            if time.time() >= deadline:
                raise RuntimeError("disposable PostgreSQL did not become ready")
            time.sleep(.5)

        dsn = f"postgresql://ops:disposable-only@127.0.0.1:{postgres_port}/ops_bench"
        from psycopg import connect
        with connect(dsn) as conn:
            postgres_version, server_version_num = conn.execute(
                "select version(), current_setting('server_version_num')"
            ).fetchone()
        postgres_major = int(server_version_num) // 10000
        if postgres_major != 16:
            raise RuntimeError(f"Expected PostgreSQL major version 16; server reports {postgres_version}")
        from services.api.main import create_app
        from services.api.persistence import create_postgres_persistence
        from services.api.modules.work_inbox import INBOX_MACHINES

        store = create_postgres_persistence(dsn, demo=True)
        app = create_app(demo=True, persistence=store)
        store = app.state.store
        project_id = store.meta["projectId"]
        actor = store.meta["actors"]["SUP"]
        foreign_role_id = store.meta["actors"]["CON"]["roleAssignmentId"]
        base = next(record for (kind, _), record in store.engine._records.items() if kind == "Issue")
        baseline_eligible = 0
        for (kind, _), record in store.engine._records.items():
            machine = store.engine._record_machines.get((kind, record.get("id")))
            if machine not in INBOX_MACHINES or record.get("projectId") != project_id:
                continue
            try:
                store.engine.authorize_read(record, actor["partyId"], actor["roleAssignmentId"])
            except ContractError as exc:
                if exc.code in {"NOT_AUTHORIZED", "NOT_FOUND", "SCOPE_MISMATCH", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID"}:
                    continue
                raise
            if any(
                transition["from"] == record.get("status")
                and _transition_authorized(store.engine, record, machine, transition["authority"], actor)
                for transition in store.engine.machines[machine]["transitions"]
            ):
                baseline_eligible += 1

        visible_rows = 0
        denied_id = f"ops-issue-{args.records - 1:06d}"
        denied_scope = False
        with store.transaction(write=True):
            for index in range(args.records):
                record_id = f"ops-issue-{index:06d}"
                record = deepcopy(base)
                record["id"] = record_id
                record["version"] = 1
                if index == args.records - 1:
                    # Keep this same-project row newest so a missing read check
                    # would expose it on page one; the real role cannot read it.
                    record["locationId"] = "ops-forbidden-location"
                    record["updatedAt"] = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
                    denied_scope = record_id == denied_id
                elif index % args.visible_fraction_denominator == 0:
                    record["projectId"] = "ops-other-project"
                else:
                    visible_rows += 1
                store.engine._records[("Issue", record_id)] = record
                store.engine._record_machines[("Issue", record_id)] = "issue"
            assert denied_scope
            try:
                store.engine.authorize_read(store.engine._records[("Issue", denied_id)], actor["partyId"], actor["roleAssignmentId"])
            except ContractError as exc:
                assert exc.code == "SCOPE_MISMATCH", f"unexpected denied fixture result: {exc.code}"
            else:
                raise AssertionError("same-project forbidden-scope fixture unexpectedly readable")
        store.close()

        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            api_port = reserved.getsockname()[1]
        server_code = (
            "import uvicorn; from services.api.main import create_app; "
            "from services.api.persistence import create_postgres_persistence; "
            f"p=create_postgres_persistence({dsn!r},demo=True); "
            f"uvicorn.run(create_app(demo=True,persistence=p),host='127.0.0.1',port={api_port},log_level='critical',access_log=False)"
        )
        server = subprocess.Popen([sys.executable, "-c", server_code], cwd=APP_ROOT,
                                  env=dict(os.environ, PYTHONPATH=str(APP_ROOT)),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base_url = f"http://127.0.0.1:{api_port}"
        deadline = time.time() + 45
        while True:
            try:
                request(base_url + "/health")
                break
            except (urllib.error.URLError, TimeoutError):
                if server.poll() is not None or time.time() >= deadline:
                    raise RuntimeError("API process did not become ready")
                time.sleep(.1)
        login, _, _ = request(base_url + "/dev/sessions",
                              data=json.dumps({"actorGroup": "SUP"}).encode(),
                              headers={"Content-Type": "application/json"})
        project_id = login["projectId"]
        auth = {"Authorization": "Bearer " + login["accessToken"]}
        route = f"{base_url}/projects/{project_id}/parallel/work-inbox"
        denied_auth = expect_denial(route + "?limit=1", {
            **auth, "X-RoleAssignment-Id": foreign_role_id,
        }, expected_code="NOT_AUTHORIZED")
        expected_total = visible_rows + baseline_eligible

        page_results = {}
        for page_size in args.page_sizes:
            query = urllib.parse.urlencode({"limit": page_size})
            # Warmups happen before the metric baseline and are still checked.
            warmup_pages = []
            for _ in range(args.warmups):
                warmup_pages.append(request(route + "?" + query, headers=auth)[0])
            assert all(item["total"] == expected_total for item in warmup_pages)

            stats_before = _proc_stats(server.pid)
            rss_before = stats_before[1] if stats_before else _ps_rss(server.pid)
            cpu_before_seconds = (
                stats_before[0] / os.sysconf("SC_CLK_TCK")
                if stats_before else _ps_cpu_seconds(server.pid)
            )
            pg_before = postgres_cpu_usec(container)
            peak_rss = [rss_before or 0]
            stop_monitor = threading.Event()

            def monitor() -> None:
                sample_interval = .02 if stats_before else .1
                while not stop_monitor.wait(sample_interval):
                    stats = _proc_stats(server.pid)
                    rss = stats[1] if stats else _ps_rss(server.pid)
                    if rss is not None:
                        peak_rss[0] = max(peak_rss[0], rss)

            monitor_thread = threading.Thread(target=monitor, daemon=True)
            monitor_thread.start()
            samples: list[float] = []
            response_bytes = 0
            first_page = None
            for _ in range(args.rounds):
                body, elapsed, body_bytes = request(route + "?" + query, headers=auth)
                if first_page is None:
                    first_page = body
                assert body["total"] == expected_total, f"exact total changed: {body['total']} != {expected_total}"
                assert len(body["records"]) == page_size and body["limit"] == page_size
                assert all(row["record"]["id"] != denied_id for row in body["records"]), "unreadable same-project row leaked"
                samples.append(elapsed)
                response_bytes += body_bytes
            assert first_page is not None
            first_ids = [row["record"]["id"] for row in first_page["records"]]
            assert first_page["nextCursor"], "expected more pages in the fixture"
            second_page, second_latency, second_bytes = request(
                route + "?" + urllib.parse.urlencode({"limit": page_size, "cursor": first_page["nextCursor"]}),
                headers=auth)
            response_bytes += second_bytes
            second_ids = [row["record"]["id"] for row in second_page["records"]]
            assert len(second_ids) == page_size and not set(first_ids).intersection(second_ids)
            assert second_page["total"] == expected_total
            assert denied_id not in second_ids
            stop_monitor.set()
            monitor_thread.join()
            stats_after = _proc_stats(server.pid)
            rss_after = stats_after[1] if stats_after else _ps_rss(server.pid)
            cpu_after_seconds = (
                stats_after[0] / os.sysconf("SC_CLK_TCK")
                if stats_after else _ps_cpu_seconds(server.pid)
            )
            pg_after = postgres_cpu_usec(container)
            if stats_before and stats_after:
                api_cpu_ms = (cpu_after_seconds - cpu_before_seconds) * 1000
                api_cpu_source = "proc process CPU ticks"
            elif cpu_before_seconds is not None and cpu_after_seconds is not None:
                api_cpu_ms = (cpu_after_seconds - cpu_before_seconds) * 1000
                api_cpu_source = "POSIX ps process TIME (centisecond resolution on macOS)"
            else:
                api_cpu_ms = None
                api_cpu_source = None
            page_results[str(page_size)] = {
                "sampleCount": len(samples),
                "warmupCount": args.warmups,
                "latencyMs": {
                    "samples": [round(value, 3) for value in samples],
                    "p50": round(statistics.median(samples), 3),
                    "p95NearestRank": round(rank_p95(samples), 3),
                    "secondPage": round(second_latency, 3),
                },
                "responseBytes": {
                    "timedRequestsTotal": response_bytes - second_bytes,
                    "timedRequestsMean": round((response_bytes - second_bytes) / len(samples), 1),
                    "secondPage": second_bytes,
                    "allMeasuredRequests": response_bytes,
                },
                "apiProcess": {
                    "cpuMsDelta": round(api_cpu_ms, 3) if api_cpu_ms is not None else None,
                    "cpuMetric": api_cpu_source,
                    "rssBaselineBytes": rss_before,
                    "rssPeakBytes": peak_rss[0] or None,
                    "rssAfterBytes": rss_after,
                    "rssPeakAboveBaselineBytes": max(0, peak_rss[0] - rss_before) if rss_before is not None else None,
                },
                "postgresCgroupCpuUsecDelta": (
                    pg_after.get("usage_usec", 0) - pg_before.get("usage_usec", 0)
                    if pg_before and pg_after else None
                ),
                "exactTotal": expected_total,
                "projectFilteredAndDisjointCursorPages": "passed over real HTTP",
                "sameProjectScopeDenialOmitted": denied_id not in first_ids + second_ids,
            }

        # Capture exact toolchain/database identity from the same disposable DB.
        result = {
            "scope": "Loopback TCP HTTP to FastAPI backed by a disposable PostgreSQL snapshot adapter",
            "status": "descriptive-measurement-no-SLO-claim",
            "source": {
                "commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=APP_ROOT,
                                          text=True, stdout=subprocess.PIPE, check=True).stdout.strip(),
                "python": sys.version,
                "platform": platform.platform(),
                "postgres": {
                    "version": postgres_version,
                    "major": postgres_major,
                    "serverVersionNum": server_version_num,
                    "requestedImage": args.postgres_image,
                    "imageIdAndRepoDigests": image_info,
                },
                "apiModulePath": str(APP_ROOT),
            },
            "fixture": {
                "syntheticIssueRows": args.records,
                "projectVisibleEligibleSyntheticRows": visible_rows,
                "filteredOtherProjectRows": args.records - visible_rows - 1,
                "sameProjectScopeDeniedRows": 1,
                "demoProjectEligibleRows": baseline_eligible,
                "exactExpectedTotal": expected_total,
                "authorizationDenialProbe": denied_auth,
                "actorGroup": "SUP",
            },
            "roundsPerPageSize": args.rounds,
            "pageSizes": page_results,
            "limits": [
                "Synthetic duplicate issue records, one local API process and development snapshot persistence; not production or field traffic.",
                "Short single-client sample; p95 is descriptive and does not imply an agreed latency budget.",
                "PostgreSQL CPU is reported when the container exposes cgroup v2 cpu.stat; otherwise null.",
                "Linux process CPU ticks are reported when /proc is available; RSS uses /proc or POSIX ps sampling.",
                "Real demo role/scope authorization remains active; no browser rendering or concurrent-client behavior is measured.",
            ],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        return 0
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
        docker_run(["rm", "-f", container], check=False)


def _transition_authorized(engine, record, machine, authority, actor) -> bool:
    from app.reference.validation import ContractError
    try:
        engine.authorize(record, authority, actor["partyId"], actor["roleAssignmentId"])
        return True
    except ContractError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
