"""Legacy/optimized workspace comparison on the same synthetic SQLite snapshot."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import sys
import tempfile
from time import perf_counter
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.reference.engine import uid
from services.api.main import create_app

def compare_workspace(*, copies=10, repeats=3):
    with tempfile.TemporaryDirectory() as directory:
        database = str(Path(directory) / 'benchmark.db')
        optimized = create_app(database, demo=True)
        store = optimized.state.store
        fixed_now = datetime.now(timezone.utc)
        store.engine.now = lambda: fixed_now
        with store.transaction(True):
            originals = list(store.engine._record_machines.items())
            for (kind, object_id), machine in originals:
                if kind not in ('Inspection', 'Observation', 'Issue', 'WorkItem'):
                    continue
                source = store.engine.get(kind, object_id)
                for _ in range(copies):
                    record = deepcopy(source)
                    record['id'] = uid()
                    store.engine.bootstrap(kind, record)
                    store.engine._record_machines[(kind, record['id'])] = machine
        with patch('services.api.modules.command_preview.clone_for_preview', deepcopy):
            legacy = create_app(database, demo=True)
        legacy.state.store.engine.now = lambda: fixed_now
        results = []
        try:
            with TestClient(legacy) as old_client, TestClient(optimized) as new_client:
                for group in ('SUP', 'CON', 'OWN', 'DES', 'ADM'):
                    sessions = [client.post('/dev/sessions', json={'actorGroup': group}).json()
                                for client in (old_client, new_client)]
                    headers = [{'Authorization': 'Bearer ' + session['accessToken'],
                                'X-RoleAssignment-Id': session['actor']['roleAssignmentId']}
                               for session in sessions]
                    path = '/projects/' + sessions[0]['projectId'] + '/workspace'
                    timings = [[], []]
                    before = deepcopy(store.export_state())
                    for _ in range(repeats):
                        bodies = []
                        for index, client in enumerate((old_client, new_client)):
                            started = perf_counter()
                            response = client.get(path, headers=headers[index])
                            timings[index].append((perf_counter() - started) * 1000)
                            assert response.status_code == 200, response.text
                            bodies.append(response.json())
                        assert bodies[0] == bodies[1], group + ' response differs'
                    assert before == store.export_state(), group + ' preview mutated state'
                    previous, current = (statistics.median(values) for values in timings)
                    results.append({'role': group, 'items': len(bodies[1]['items']),
                                    'legacyMs': round(previous, 2), 'optimizedMs': round(current, 2),
                                    'speedup': round(previous / current, 2),
                                    'responseEqual': True, 'stateUnchanged': True})
        finally:
            legacy.state.store.close()
            store.close()
        return {'copiesPerWorkflowRecord': copies, 'repeats': repeats, 'roles': results}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--copies', type=int, default=10)
    parser.add_argument('--repeats', type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(compare_workspace(copies=args.copies, repeats=args.repeats), indent=2))
