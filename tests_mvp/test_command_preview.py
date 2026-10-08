"""Preview isolation, role equivalence and live authorization regression."""
from copy import deepcopy
from datetime import datetime, timezone
import unittest
from app.reference.engine import Engine
from app.reference.validation import ContractError
from services.api.demo import seed
from services.api.modules.command_preview import clone_for_preview
from scripts.benchmark_workspace_preflight import compare_workspace

class CommandPreviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.meta = seed(self.engine)
        now = datetime.now(timezone.utc)
        self.engine.now = lambda: now

    def test_all_runtime_state_including_future_attributes_is_isolated(self):
        self.engine.custom_runtime = {'nested': []}
        preview = clone_for_preview(self.engine)
        original = deepcopy(vars(self.engine))
        for name in ('_records', '_history', '_idempotency', '_record_machines', '_notifications'):
            getattr(preview, name).clear()
        preview._audit.append({'synthetic': True})
        preview._escalation_keys.add(('synthetic',))
        preview.custom_runtime['nested'].append('preview only')
        self.assertEqual(vars(self.engine), original)

    def test_every_seeded_transition_matches_legacy_for_every_role_and_state(self):
        before = deepcopy(vars(self.engine))
        for (kind, object_id), machine in list(self.engine._record_machines.items()):
            record = self.engine.get(kind, object_id)
            for transition in self.engine.machines[machine]['transitions']:
                for actor in self.meta['actors'].values():
                    outputs = []
                    for clone in (deepcopy, clone_for_preview):
                        preview = clone(self.engine)
                        simulated = deepcopy(record)
                        simulated['status'] = transition['from']
                        preview._save(kind, simulated)
                        try:
                            result = preview.execute(machine, object_id, transition['command'],
                                record['version'], {}, [], actor['partyId'],
                                actor['roleAssignmentId'], 'comparison')
                            outputs.append(('ready', result['record']))
                        except ContractError as exc:
                            outputs.append(('blocked', exc.code, str(exc), getattr(exc, 'current_version', None)))
                    self.assertEqual(outputs[0], outputs[1], (machine, transition['command'], actor['name']))
        self.assertEqual(vars(self.engine), before)

    def test_fresh_previews_observe_revocation_and_version_changes(self):
        actor = self.meta['actors']['CON']
        kind, object_id = next(key for key, machine in self.engine._record_machines.items()
                               if machine == 'inspection')
        record = self.engine.get(kind, object_id)
        authority = self.engine.machines['inspection']['transitions'][0]['authority']
        role = self.engine.get('RoleAssignment', actor['roleAssignmentId'])
        role['active'] = False
        self.engine._save('RoleAssignment', role)
        with self.assertRaises(ContractError) as denied:
            clone_for_preview(self.engine).authorize(record, authority, actor['partyId'], role['id'])
        self.assertEqual(denied.exception.code, 'ASSIGNMENT_EXPIRED')
        record['version'] += 1
        self.engine._save(kind, record)
        self.assertEqual(clone_for_preview(self.engine).get(kind, object_id)['version'], record['version'])
        role['active'] = True
        self.engine._save('RoleAssignment', role)
        for transition in self.engine.machines['inspection']['transitions']:
            if transition['from'] != record['status']:
                continue
            for candidate in self.meta['actors'].values():
                try:
                    self.engine.authorize(record, transition['authority'],
                                          candidate['partyId'], candidate['roleAssignmentId'])
                except ContractError:
                    continue
                with self.assertRaises(ContractError) as stale:
                    clone_for_preview(self.engine).execute('inspection', object_id,
                        transition['command'], record['version'] - 1, {}, [],
                        candidate['partyId'], candidate['roleAssignmentId'], 'stale')
                self.assertEqual(stale.exception.code, 'VERSION_CONFLICT')
                return
        self.fail('Seed fixture has no authorized current inspection command')

    def test_workspace_json_is_identical_across_all_human_roles(self):
        result = compare_workspace(copies=0, repeats=1)
        self.assertEqual(len(result['roles']), 5)
        self.assertTrue(all(row['responseEqual'] and row['stateUnchanged'] for row in result['roles']))

if __name__ == '__main__':
    unittest.main()
