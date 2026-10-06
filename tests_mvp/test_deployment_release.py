"""Provisioning and release control gates; no real environment is modified."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services.api.store import SQLiteSnapshotAdapter, encode_map
from services.deployment.migrate import validate_initial_snapshot
from services.deployment.release import verify_recovery, activate


class FoundationValidationTests(unittest.TestCase):
    def foundation(self):
        store=SQLiteSnapshotAdapter(':memory:')
        try:
            state=store.export_state()
            permitted={'Project','Party','RoleAssignment','Qualification','Requirement'}
            records={key:value for key,value in store.engine._records.items() if key[0] in permitted}
            state['engine']['_records']=encode_map(records)
            state['engine']['_history']=encode_map({(kind,oid,r['version']):r for (kind,oid),r in records.items()})
            for name in ['_idempotency','_record_machines','_notifications']:state['engine'][name]=[]
            for name in state['documents']:state['documents'][name]=[]
            state.update(audit=[],escalations=[],documentBytes={},uploads={},requests={},conflicts={})
            actor=store.meta['actors']['SUP']
            state['meta']={'projectId':store.meta['projectId'],
                'provisioning':{'environment':'staging','snapshotFormat':1,'approvedBy':'SYNTHETIC-CI','approvalRef':'test-only','syntheticData':True},
                'identityBindings':{'synthetic':{'partyId':actor['partyId'],'defaultRoleAssignmentId':actor['roleAssignmentId'],'active':True}}}
            return state
        finally:store.close()

    def test_clean_foundation_is_accepted_without_operational_history(self):
        self.assertTrue(validate_initial_snapshot(self.foundation(),'staging'))

    def test_hidden_history_jobs_and_prior_versions_are_rejected(self):
        for field in ['history','jobs','audit','escalations']:
            state=self.foundation()
            if field=='history':state['engine']['_history']=[]
            if field=='jobs':state['meta']['workerJobs']={'completed':{'state':'done'}}
            if field=='audit':state['audit']=[{'approved':True}]
            if field=='escalations':state['escalations']=[['hidden']]
            with self.subTest(field=field),self.assertRaises(ValueError):validate_initial_snapshot(state,'staging')

    def test_synthetic_foundation_cannot_be_relabelled_as_pilot(self):
        state=self.foundation();state['meta']['provisioning']['environment']='pilot'
        with self.assertRaises(ValueError):validate_initial_snapshot(state,'pilot')


class ReleaseExecutionTests(unittest.TestCase):
    def test_backup_and_restore_must_reference_same_encrypted_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);backup=root/'backup.json';restored=root/'restore.json'
            backup.write_text(json.dumps({'encrypted':True,'bundleSha256':'a'*64}))
            restored.write_text(json.dumps({'verified':True,'bundleSha256':'a'*64,'targets':{'rpoSeconds':3600,'status':'draft'}}))
            plan={'environment':'staging','recovery':{'backupReport':str(backup),'restoreReport':str(restored)}}
            verify_recovery(plan)
            restored.write_text(json.dumps({'verified':True,'bundleSha256':'b'*64,'targets':{'rpoSeconds':3600,'status':'draft'}}))
            with self.assertRaises(ValueError):verify_recovery(plan)

    def test_validation_does_not_pull_or_activate(self):
        plan={'environment':'staging','releaseSha':'a'*40}
        with patch('services.deployment.release.preflight',return_value=(['docker','compose'],{})),patch('services.deployment.release.run') as run:
            result=activate(plan,'unused','unused',execute=False)
        self.assertEqual(result,{'validated':True,'executed':False});run.assert_not_called()

    def test_activation_and_explicit_rollback_never_delete_or_migrate(self):
        for rollback in [False,True]:
            with tempfile.TemporaryDirectory() as temp,patch('services.deployment.release.preflight',return_value=(['docker','compose'],{})),patch('services.deployment.release.run',return_value=b'') as run,patch('services.deployment.release.verify_https') as https:
                result=activate({'environment':'staging','releaseSha':'a'*40},'unused',temp,execute=True,rollback=rollback)
                self.assertTrue(result['ready']);https.assert_called_once()
                commands=[call.args[0] for call in run.call_args_list]
                self.assertEqual(commands[0],['docker','compose','pull'])
                self.assertEqual(commands[1][:4],['docker','compose','up','-d'])
                self.assertFalse(any(word in command for command in commands for word in ['down','-v','dropdb','migrate']))
                record=json.loads(next(Path(temp).glob('deployment-*.json')).read_text())
                self.assertEqual(record['action'],'rollback' if rollback else 'activate')
                self.assertFalse(record['databaseReplaced'])

    def test_failed_activation_is_recorded_without_destructive_rescue(self):
        with tempfile.TemporaryDirectory() as temp,patch('services.deployment.release.preflight',return_value=(['docker','compose'],{})),patch('services.deployment.release.run',side_effect=RuntimeError('private failure')) as run:
            with self.assertRaises(RuntimeError):activate({'environment':'staging','releaseSha':'a'*40},'unused',temp,execute=True)
            self.assertEqual(run.call_count,1)
            record=next(Path(temp).glob('deployment-*.json')).read_text()
            self.assertEqual(json.loads(record)['status'],'failed')
            self.assertNotIn('private failure',record)


if __name__=='__main__':unittest.main()
