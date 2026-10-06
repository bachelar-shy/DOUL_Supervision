"""Shell/filesystem safety tests; Docker/PostgreSQL are controlled test doubles."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
DUMP = b'PGDMP-valid-synthetic-archive'
FAKE_DOCKER = r'''#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
i = args.index('exec') + 1
env = os.environ.copy()
while args[i].startswith('-'):
    if args[i] == '-e':
        key, value = args[i + 1].split('=', 1)
        env[key] = value
        i += 2
    else:
        i += 1
assert args[i] == 'postgres'
raise SystemExit(subprocess.call(args[i + 1:], env=env))
'''
FAKE_POSTGRES = r'''#!/usr/bin/env python3
import json, os, pathlib, stat, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
record = {'command': name, 'args': args}
if name == 'pg_dump':
    record['temporaryMode'] = stat.S_IMODE(os.fstat(1).st_mode)
    record['temporaryDirectories'] = [stat.S_IMODE(p.stat().st_mode) for p in pathlib.Path(os.environ['TEST_ROOT']).rglob('.doul-backup.*') if p.is_dir()]
with open(os.environ['TEST_LOG'], 'a') as log:
    log.write(json.dumps(record) + '\n')
state = pathlib.Path(os.environ['TEST_STATE'])
if name == 'pg_dump':
    sys.stdout.buffer.write(b'PGDMP-valid-synthetic-archive')
    raise SystemExit(1 if os.environ.get('FAIL_DUMP') else 0)
if name == 'createdb':
    try:
        (state / args[-1]).open('xb').close()
    except FileExistsError:
        raise SystemExit(1)
    raise SystemExit(0)
if name == 'pg_restore':
    data = sys.stdin.buffer.read()
    if not data.startswith(b'PGDMP-valid'):
        raise SystemExit(1)
    if '--list' in args:
        raise SystemExit(0)
    if '--file=/dev/null' in args:
        raise SystemExit(1 if data.endswith(b'truncated') else 0)
    if os.environ.get('FAIL_RESTORE'):
        raise SystemExit(1)
    assert '--single-transaction' in args
    (state / args[args.index('-d') + 1]).write_bytes(data)
    raise SystemExit(0)
raise SystemExit(91)
'''


class PostgresBackupSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.state = self.root / 'state'
        self.state.mkdir()
        self.log = self.root / 'commands.jsonl'
        for name, script in [('docker', FAKE_DOCKER)] + [(name, FAKE_POSTGRES) for name in ('pg_dump', 'createdb', 'pg_restore', 'dropdb')]:
            path = self.bin / name
            path.write_text(script)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        POSTGRES_USER='test_user', POSTGRES_DB='primary',
                        TEST_ROOT=str(self.root), TEST_STATE=str(self.state), TEST_LOG=str(self.log))
        self.output = self.root / 'backups' / 'probe.dump'

    def run_script(self, name, *args, **env):
        return subprocess.run(['sh', str(ROOT / name), *map(str, args)], env=dict(self.env, **env),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
                              preexec_fn=lambda: os.umask(0o022))

    def records(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def dump(self, data=DUMP, digest=True):
        path = self.root / 'input.dump'
        path.write_bytes(data)
        if digest:
            Path(str(path) + '.sha256').write_text(hashlib.sha256(data).hexdigest() + '\n')
        return path

    def assert_no_database_mutation(self):
        self.assertFalse(any(x['command'] in ('createdb', 'dropdb') or
                             (x['command'] == 'pg_restore' and '-d' in x['args']) for x in self.records()))

    def test_backup_is_private_from_creation_under_umask_022(self):
        result = self.run_script('postgres_backup.sh', 'source', self.output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(self.output.parent.stat().st_mode), 0o700)
        for path in (self.output, Path(str(self.output) + '.sha256')):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        record = next(x for x in self.records() if x['command'] == 'pg_dump')
        self.assertEqual(record['temporaryMode'], 0o600)
        self.assertEqual(record['temporaryDirectories'], [0o700])
        self.assertFalse(list(self.output.parent.glob('.doul-backup.*')))
        self.assertFalse(Path(str(self.output) + '.lock').exists())

    def test_backup_overwrite_and_failed_dump_preserve_previous_pair(self):
        self.assertEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
        self.output.write_bytes(b'old-backup')
        sidecar = Path(str(self.output) + '.sha256')
        sidecar.write_text('old-sidecar')
        result = self.run_script('postgres_backup.sh', 'source', self.output, FAIL_DUMP='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.output.read_bytes(), b'old-backup')
        self.assertEqual(sidecar.read_text(), 'old-sidecar')
        self.assertFalse(list(self.output.parent.glob('.doul-backup.*')))
        self.assertFalse(Path(str(self.output) + '.lock').exists())
        self.assertEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
        self.assertEqual(self.output.read_bytes(), DUMP)

    def test_backup_refuses_shared_directory(self):
        self.output.parent.mkdir(mode=0o755)
        self.output.parent.chmod(0o755)
        self.assertNotEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
        self.assertEqual(self.records(), [])

    def test_backup_refuses_symlink_destinations_and_directory(self):
        self.output.parent.mkdir(mode=0o700)
        victim = self.root / 'victim'
        victim.write_text('do-not-touch')
        for path in (self.output, Path(str(self.output) + '.sha256')):
            path.symlink_to(victim)
            self.assertNotEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
            self.assertEqual(victim.read_text(), 'do-not-touch')
            path.unlink()
        linked = self.root / 'linked'
        linked.symlink_to(self.output.parent, target_is_directory=True)
        self.assertNotEqual(self.run_script('postgres_backup.sh', 'source', linked / 'probe.dump').returncode, 0)
        self.assertEqual(self.records(), [])

    def test_backup_does_not_reuse_predictable_temporary_path_or_lock(self):
        self.output.parent.mkdir(mode=0o700)
        legacy = Path(str(self.output) + '.tmp.12345')
        legacy.symlink_to(self.root / 'must-not-exist')
        self.assertEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
        self.assertTrue(legacy.is_symlink())
        self.assertFalse((self.root / 'must-not-exist').exists())
        lock = Path(str(self.output) + '.lock')
        lock.mkdir()
        self.assertNotEqual(self.run_script('postgres_backup.sh', 'source', self.output).returncode, 0)
        self.assertTrue(lock.exists())

    def test_restore_requires_valid_matching_sidecar(self):
        dump = self.dump(digest=False)
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        for digest in ('invalid', '0' * 64, 'g' * 64):
            Path(str(dump) + '.sha256').write_text(digest)
            self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        self.assertEqual(self.records(), [])

    def test_restore_rejects_matching_non_archive_before_creating_target(self):
        dump = self.dump(b'not-a-postgresql-archive')
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        self.assert_no_database_mutation()

    def test_restore_reads_body_not_only_toc_before_creating_target(self):
        dump = self.dump(b'PGDMP-valid-truncated')
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        self.assert_no_database_mutation()
        self.assertTrue(any('--file=/dev/null' in x['args'] for x in self.records()))

    def test_restore_never_replaces_an_existing_target(self):
        dump = self.dump()
        target = self.state / 'target'
        target.write_text('existing-data')
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        self.assertEqual(target.read_text(), 'existing-data')
        self.assertFalse(any(x['command'] == 'dropdb' or '-d' in x['args'] for x in self.records()))

    def test_restore_protects_primary_system_and_truncated_identifiers(self):
        dump = self.dump()
        for target in ('primary', 'postgres', 'template0', 'template1', 'x' * 64):
            with self.subTest(target=target):
                self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, target).returncode, 0)
        self.assert_no_database_mutation()
        self.assertEqual(self.records(), [])

    def test_failed_restore_only_leaves_new_empty_target(self):
        dump = self.dump()
        existing = self.state / 'unrelated'
        existing.write_text('keep')
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'new_target', FAIL_RESTORE='1').returncode, 0)
        self.assertEqual(existing.read_text(), 'keep')
        self.assertEqual((self.state / 'new_target').read_bytes(), b'')
        self.assertFalse(any(x['command'] == 'dropdb' for x in self.records()))

    def test_successful_restore_uses_single_transaction(self):
        dump = self.dump()
        result = self.run_script('postgres_restore_clean.sh', dump, 'target')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.state / 'target').read_bytes(), DUMP)
        self.assertFalse(any(x['command'] == 'dropdb' for x in self.records()))

    def test_restore_rejects_symlink_dump_and_sidecar(self):
        dump = self.dump()
        linked = self.root / 'linked.dump'
        linked.symlink_to(dump)
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', linked, 'target').returncode, 0)
        sidecar = Path(str(dump) + '.sha256')
        saved = self.root / 'saved.sha256'
        sidecar.rename(saved)
        sidecar.symlink_to(saved)
        self.assertNotEqual(self.run_script('postgres_restore_clean.sh', dump, 'target').returncode, 0)
        self.assertEqual(self.records(), [])


if __name__ == '__main__':
    unittest.main()
