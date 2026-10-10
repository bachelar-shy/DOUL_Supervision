"""Preview isolation, role equivalence and live authorization regression."""
from copy import deepcopy
from datetime import datetime, timezone
import unittest
from app.reference.engine import Engine
from app.reference.validation import ContractError
from services.api.demo import seed
from services.api.modules.command_preview import clone_for_preview
from app.reference.engine import uid
from scripts.benchmark_workspace_preflight import compare_workspace

class CommandPreviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.meta = seed(self.engine)
        now = datetime.now(timezone.utc)
        self.engine.now = lambda: now

    def test_all_runtime_state_including_future_attributes_is_isolated(self):
        self.engine.custom_runtime = {'nested': []}
        for clone in (clone_for_preview, lambda engine: clone_for_preview(engine, borrow_runtime=True)):
            preview = clone(self.engine)
            original = deepcopy(vars(self.engine))
            for name in ('_records', '_history', '_idempotency', '_record_machines', '_notifications'):
                getattr(preview, name).clear()
            preview._audit.append({'synthetic': True})
            preview._escalation_keys.add(('synthetic',))
            preview.custom_runtime['nested'].append('preview only')
            self.assertEqual(vars(self.engine), original)

    def test_borrowed_runtime_values_are_immutable_and_local_writes_stay_local(self):
        key = next(key for key, machine in self.engine._record_machines.items() if machine == 'issue')
        self.engine._records[key]['previewNested'] = {
            'sequence': ([{'value': [1]}],),
        }
        preview = clone_for_preview(self.engine, borrow_runtime=True)
        original_title = self.engine._records[key]['title']
        borrowed = preview._records[key]
        with self.assertRaises(TypeError):
            borrowed['title'] = 'mutated through preview'
        with self.assertRaises(TypeError):
            borrowed['previewNested']['sequence'][0][0]['value'][0] = 2
        self.assertEqual(self.engine._records[key]['previewNested']['sequence'][0][0]['value'], [1])
        self.assertEqual(self.engine._records[key]['title'], original_title)

        history = preview._history[(key[0], key[1], self.engine._records[key]['version'])]
        with self.assertRaises(TypeError):
            history['title'] = 'mutated history source'
        idem_key = next(iter(self.engine._idempotency))
        cached = preview._idempotency[idem_key]
        if 'record' in cached[1]:
            with self.assertRaises(TypeError):
                cached[1]['record']['title'] = 'mutated idempotency source'

        replacement = deepcopy(self.engine.get(*key))
        replacement['title'] = 'preview-local replacement'
        preview._save(key[0], replacement)
        self.assertEqual(preview.get(*key)['title'], 'preview-local replacement')
        self.assertEqual(self.engine._records[key]['title'], original_title)

        if self.engine._audit:
            with self.assertRaises(TypeError):
                preview._audit[0]['command'] = 'mutated source audit'
        preview._audit.append({'command': 'preview-local'})
        self.assertEqual(len(preview._audit), len(self.engine._audit) + 1)
        self.assertNotEqual(len(preview._audit), len(self.engine._audit))

    def test_every_seeded_transition_matches_legacy_for_every_role_and_state(self):
        before = deepcopy(vars(self.engine))
        for (kind, object_id), machine in list(self.engine._record_machines.items()):
            record = self.engine.get(kind, object_id)
            for transition in self.engine.machines[machine]['transitions']:
                for actor in self.meta['actors'].values():
                    outputs = []
                    for clone in (
                        deepcopy,
                        clone_for_preview,
                        lambda engine: clone_for_preview(engine, borrow_runtime=True),
                    ):
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
                    self.assertTrue(
                        all(output == outputs[0] for output in outputs[1:]),
                        (machine, transition['command'], actor['name'], outputs),
                    )
        self.assertEqual(vars(self.engine), before)

    def test_related_safety_permit_and_stop_reads_match_and_stay_isolated(self):
        now = self.engine.at()
        project_id = self.meta['projectId']
        scope = self.meta['scope']
        supervisor = self.meta['actors']['SUP']
        contractor = self.meta['actors']['CON']
        permit_id, stop_id = uid(), uid()
        permit_ref = {'objectType': 'WorkItem', 'objectId': permit_id, 'version': 1}
        stop_ref = {'objectType': 'WorkItem', 'objectId': stop_id, 'version': 1}
        permit = dict(
            **scope, id=permit_id, projectId=project_id, version=1,
            createdAt=now, updatedAt=now, createdBy=supervisor['partyId'],
            subtype='SafetyPermit', status='active', title='Preview safety permit',
            data=dict(
                permitNo='PREVIEW-1', workType='hot-work', riskLevel='high',
                responsiblePartyId=contractor['partyId'],
                safetyResponsiblePartyId=supervisor['partyId'],
                validFrom=now, validTo='2099-01-01T00:00:00Z',
                workAuthorized=True, stopOrderRefs=[stop_ref],
            ),
        )
        stop = dict(
            **scope, id=stop_id, projectId=project_id, version=1,
            createdAt=now, updatedAt=now, createdBy=supervisor['partyId'],
            subtype='SafetyStopOrder', status='verification', title='Preview stop order',
            data=dict(
                stopOrderNo='PREVIEW-S1', stopScopeType='work-area',
                stopReason='Test current linked permit during resume',
                observedAt=now, effectiveAt=now, resumeRequestAt=now,
                affectedPermitRefs=[permit_ref], resumeVerificationRefs=[],
            ),
        )
        self.engine.bootstrap('WorkItem', permit)
        self.engine.bootstrap('WorkItem', stop)
        self.engine._record_machines[('WorkItem', permit_id)] = 'safety_permit'
        self.engine._record_machines[('WorkItem', stop_id)] = 'safety_stop_order'

        before = deepcopy(vars(self.engine))
        outputs = []
        for clone in (
            clone_for_preview,
            lambda engine: clone_for_preview(engine, borrow_runtime=True),
        ):
            preview = clone(self.engine)
            try:
                result = preview.execute(
                    'safety_stop_order', stop_id, 'lift_stop', 1, {}, [],
                    supervisor['partyId'], supervisor['roleAssignmentId'],
                    'safety-preview',
                )
                outputs.append(('ready', result['record']))
            except ContractError as exc:
                outputs.append(('blocked', exc.code, str(exc), getattr(exc, 'current_version', None)))
        self.assertEqual(outputs[0], outputs[1])
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
        for clone in (
            clone_for_preview,
            lambda engine: clone_for_preview(engine, borrow_runtime=True),
        ):
            with self.assertRaises(ContractError) as denied:
                clone(self.engine).authorize(record, authority, actor['partyId'], role['id'])
            self.assertEqual(denied.exception.code, 'ASSIGNMENT_EXPIRED')
        record['version'] += 1
        self.engine._save(kind, record)
        for clone in (
            clone_for_preview,
            lambda engine: clone_for_preview(engine, borrow_runtime=True),
        ):
            self.assertEqual(clone(self.engine).get(kind, object_id)['version'], record['version'])
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
                for clone in (
                    clone_for_preview,
                    lambda engine: clone_for_preview(engine, borrow_runtime=True),
                ):
                    with self.assertRaises(ContractError) as stale:
                        clone(self.engine).execute('inspection', object_id,
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
