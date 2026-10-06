"""Recovery integrity and version semantics with controlled S3 responses."""
from copy import deepcopy
from hashlib import sha256
from html import escape
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import quote, parse_qsl

from cryptography.exceptions import InvalidTag
from services.recovery.archive import encrypt_directory, decrypted_directory, load_key
from services.recovery.objects import inventory, backup_objects, restore_objects, validate_objects, ordered_xml_response
from services.recovery.bundle import validate_plan, ComposeBoundary


class FakeEvents:
    def __init__(self): self.handlers = {}
    def register(self, event, handler, unique_id): self.handlers[unique_id] = handler
    def unregister(self, event, unique_id): self.handlers.pop(unique_id)


class FakeS3:
    def __init__(self):
        self.buckets = {'source-bucket': {}}
        self.versioning = {'source-bucket': 'Enabled'}
        self.meta = SimpleNamespace(events=FakeEvents(), region_name='us-east-1')
        self.sequence = 0
        self.writes = []
        self.page_size = 2

    def create_bucket(self, Bucket, **kwargs):
        if Bucket in self.buckets: raise RuntimeError('already exists')
        self.buckets[Bucket] = {}; self.writes.append(('create', Bucket))
        return {}

    def put_bucket_versioning(self, Bucket, VersioningConfiguration):
        self.versioning[Bucket] = VersioningConfiguration['Status']

    def get_bucket_versioning(self, Bucket): return {'Status': self.versioning.get(Bucket, 'NeverEnabled')}

    def put_bucket_encryption(self, **kwargs): self.writes.append(('encryption', kwargs['Bucket']))

    def _new(self, bucket, key, data=None, **values):
        self.sequence += 1
        version = str(self.sequence)
        self.buckets[bucket].setdefault(key, []).insert(0, dict(version=version, data=data, **values))
        return version

    def put_object(self, Bucket, Key, Body, Metadata=None, Tagging='', **kwargs):
        data = Body.read() if hasattr(Body, 'read') else Body
        version = self._new(Bucket, Key, bytes(data), metadata=Metadata or {},
                            tags=[{'Key':k,'Value':v} for k,v in parse_qsl(Tagging)],
                            headers={k:v for k,v in kwargs.items() if k.startswith('Content') and k != 'ContentLength'})
        self.writes.append(('put', Bucket))
        return {'VersionId':version}

    def delete_object(self, Bucket, Key, **kwargs):
        assert 'VersionId' not in kwargs, 'physical deletion is forbidden'
        assert self.versioning.get(Bucket) == 'Enabled'
        version = self._new(Bucket, Key)
        self.writes.append(('marker', Bucket))
        return {'VersionId': version, 'DeleteMarker': True}

    def _entry(self, Bucket, Key, VersionId):
        return next(v for v in self.buckets[Bucket][Key] if v['version'] == VersionId)

    def get_object(self, Bucket, Key, VersionId):
        entry = self._entry(Bucket, Key, VersionId)
        if entry['data'] is None: raise RuntimeError('delete marker')
        return dict(Body=io.BytesIO(entry['data']), ContentLength=len(entry['data']),
                    Metadata=deepcopy(entry['metadata']), **entry['headers'])

    def get_object_tagging(self, Bucket, Key, VersionId):
        return {'TagSet':deepcopy(self._entry(Bucket, Key, VersionId)['tags'])}

    def list_object_versions(self, Bucket, KeyMarker=None, VersionIdMarker=None, **_):
        entries = [(key, i, v) for key in sorted(self.buckets[Bucket]) for i,v in enumerate(self.buckets[Bucket][key])]
        if KeyMarker is not None:
            at = next(i for i,(key,_,v) in enumerate(entries) if key == KeyMarker and v['version'] == VersionIdMarker)
            entries = entries[at+1:]
        page, extra = entries[:self.page_size], entries[self.page_size:]
        xml = ['<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType>']
        for key, index, version in page:
            kind = 'DeleteMarker' if version['data'] is None else 'Version'
            xml.append('<' + kind + '><Key>' + escape(quote(key, safe='')) + '</Key><VersionId>' + version['version'] +
                       '</VersionId><IsLatest>' + ('true' if index == 0 else 'false') + '</IsLatest>' +
                       ('<LastModified>2026-10-06T00:00:00.' + version['version'].zfill(9) + 'Z</LastModified>') +
                       ('<Size>' + str(len(version['data'])) + '</Size>' if version['data'] is not None else '') + '</' + kind + '>')
        if extra:
            key, _, version = page[-1]
            xml.append('<NextKeyMarker>' + escape(quote(key, safe='')) + '</NextKeyMarker><NextVersionIdMarker>' + version['version'] + '</NextVersionIdMarker>')
        xml.append('</ListVersionsResult>')
        parsed = {'IsTruncated':bool(extra)}
        if page: parsed['Versions'] = [{}]  # Only used to detect a non-empty newly-created target.
        for handler in list(self.meta.events.handlers.values()):
            handler(SimpleNamespace(content=''.join(xml).encode()), parsed)
        return parsed


class RecoveryArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.source = self.root / 'source'; self.source.mkdir(mode=0o700)
        (self.source / 'payload.json').write_text('{"synthetic":"private"}')
        self.output = self.root / 'bundle.backup.enc'; self.key = os.urandom(32)

    def test_encrypted_roundtrip_and_output_is_private(self):
        encrypt_directory(self.source, self.output, self.key)
        self.assertNotIn(b'synthetic', self.output.read_bytes())
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        with decrypted_directory(self.output, self.key) as root:
            self.assertEqual((root / 'payload.json').read_text(), (self.source / 'payload.json').read_text())
        self.assertFalse(root.exists())

    def test_wrong_key_or_tamper_never_yields_plaintext(self):
        encrypt_directory(self.source, self.output, self.key)
        reached = []
        with self.assertRaises(InvalidTag):
            with decrypted_directory(self.output, os.urandom(32)): reached.append(True)
        data = bytearray(self.output.read_bytes()); data[-20] ^= 1; self.output.write_bytes(data)
        with self.assertRaises(InvalidTag):
            with decrypted_directory(self.output, self.key): reached.append(True)
        self.assertFalse(reached)

    def test_existing_backup_and_symlink_cannot_be_replaced(self):
        encrypt_directory(self.source, self.output, self.key); old = self.output.read_bytes()
        with self.assertRaises(FileExistsError): encrypt_directory(self.source, self.output, self.key)
        self.assertEqual(self.output.read_bytes(), old)
        (self.source / 'link').symlink_to(self.output)
        with self.assertRaises((ValueError, OSError)): encrypt_directory(self.source, self.root / 'other.enc', self.key)

    def test_key_file_requires_exact_bytes_and_owner_only_permissions(self):
        path = self.root / 'key'; path.write_bytes(self.key); path.chmod(0o600)
        self.assertEqual(load_key(path), self.key)
        path.chmod(0o644)
        with self.assertRaises(ValueError): load_key(path)
        path.chmod(0o600); path.write_bytes(b'short')
        with self.assertRaises(ValueError): load_key(path)


class VersionRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'objects'
        self.client = FakeS3()
        key = 'folder/한글 & kiểm tra.png'
        self.key = key
        self.client.put_object(Bucket='source-bucket', Key=key, Body=b'v1', Metadata={'a':'b'}, Tagging='stage=one', ContentType='image/png')
        self.client.delete_object(Bucket='source-bucket', Key=key)
        self.client.put_object(Bucket='source-bucket', Key=key, Body=b'v2', Metadata={'a':'c'}, Tagging='stage=two', ContentType='image/png')
        self.client.delete_object(Bucket='source-bucket', Key='deleted-only')

    def test_order_survives_pagination_and_unicode(self):
        rows = inventory(self.client, 'source-bucket')
        self.assertEqual([r['deleteMarker'] for r in rows if r['key'] == self.key], [False,True,False])
        self.assertEqual(len(rows), 4)
        self.assertFalse(self.client.meta.events.handlers)

    def test_ambiguous_equal_time_marker_history_is_not_invented(self):
        original = self.client.list_object_versions
        def equal_time(**kwargs):
            page = original(**kwargs)
            for row in page.get('_doulRows', []): row['lastModified'] = '2026-10-06T00:00:00Z'
            return page
        self.client.list_object_versions = equal_time
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            inventory(self.client, 'source-bucket')

    def test_roundtrip_preserves_all_versions_markers_metadata_and_source(self):
        source = deepcopy(self.client.buckets['source-bucket'])
        manifest = backup_objects(self.client, 'source-bucket', self.root)
        result = restore_objects(self.client, self.root)
        self.assertTrue(result['verified'])
        self.assertFalse(result['promotionApproved'])
        self.assertEqual(self.client.buckets['source-bucket'], source)
        self.assertEqual(len(result['versionMapping']), 4)
        self.assertTrue(all(m['sourceVersionId'] != m['targetVersionId'] for m in result['versionMapping']))
        history = self.client.buckets[result['bucket']][self.key]
        self.assertEqual([v['data'] for v in history], [b'v2',None,b'v1'])
        self.assertEqual(history[0]['metadata'], {'a':'c'})
        self.assertEqual(history[0]['tags'], [{'Key':'stage','Value':'two'}])

    def test_integrity_failure_precedes_new_bucket_creation(self):
        manifest = backup_objects(self.client, 'source-bucket', self.root)
        member = next(e['member'] for e in manifest['entries'] if not e['deleteMarker'])
        (self.root / member).write_bytes(b'corrupt')
        count = len(self.client.buckets)
        with self.assertRaises(ValueError): restore_objects(self.client, self.root)
        self.assertEqual(len(self.client.buckets), count)

    def test_unsafe_member_and_duplicate_versions_are_rejected(self):
        manifest = backup_objects(self.client, 'source-bucket', self.root)
        entry = next(e for e in manifest['entries'] if not e['deleteMarker'])
        entry['member'] = '../outside'
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError): validate_objects(self.root)

    def test_source_version_change_during_backup_is_detected(self):
        original = self.client.get_object
        def changed(**kwargs):
            value = original(**kwargs)
            self.client.put_object(Bucket='source-bucket', Key='new', Body=b'new')
            return value
        self.client.get_object = changed
        with self.assertRaises(RuntimeError): backup_objects(self.client, 'source-bucket', self.root)

    def test_unsupported_or_entity_xml_fails_closed(self):
        with self.assertRaises(ValueError):
            ordered_xml_response(SimpleNamespace(content=b'<!DOCTYPE x [<!ENTITY e "bad">]><x/>'), {})
        with self.assertRaises(ValueError):
            ordered_xml_response(SimpleNamespace(content=b'<other/>'), {})


class RecoveryPlanTests(unittest.TestCase):
    def test_reference_plan_is_valid_but_unknown_raw_secret_fields_are_rejected(self):
        path = Path(__file__).resolve().parents[1] / 'infra/backup/recovery_plan.example.json'
        plan = json.loads(path.read_text())
        self.assertIs(validate_plan(plan), plan)
        value = deepcopy(plan); value['password'] = 'secret'
        with self.assertRaises(ValueError): validate_plan(value)
        value = deepcopy(plan); value['secretRecovery'][0]['value'] = 'secret'
        with self.assertRaises(ValueError): validate_plan(value)
        value = deepcopy(plan); value['configurationPaths'] = ['../../secret']
        with self.assertRaises(ValueError): validate_plan(value)

    def test_compose_boundary_only_restarts_previously_running_writers(self):
        path = Path(__file__).resolve().parents[1] / 'infra/backup/recovery_plan.example.json'
        plan = json.loads(path.read_text())
        calls = []
        def command(args, *a, **k):
            calls.append(args)
            if len(calls) == 1: return b'api\npostgres\nredis\n'
            return b'postgres\nredis\n'
        with patch('services.recovery.bundle.run_command', command):
            with ComposeBoundary(plan): pass
        self.assertEqual(calls[1][-4:], ['stop','--timeout','70','api'])
        self.assertEqual(calls[-1][-2:], ['start','api'])
        self.assertFalse(any('down' in call or '-v' in call for call in calls))


if __name__ == '__main__':
    unittest.main()
