"""Run only in the disposable CI Compose cluster after the standard restore probe."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
COMPOSE = ['docker', 'compose', '-f', os.getenv('DOUL_COMPOSE_FILE', 'infra/compose/compose.dev.yml')]


def checked(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise AssertionError('CI probe command failed: ' + result.stderr)
    return result.stdout.strip()


def database_exists(name):
    assert re.fullmatch(r'[A-Za-z0-9_]{1,63}', name)
    sql = "SELECT count(*) FROM pg_database WHERE datname='" + name + "'"
    return checked(COMPOSE + ['exec', '-T', 'postgres', 'sh', '-ec',
        'psql -w -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "' + sql + '"']) != '0'


def restore_must_fail(dump, target):
    result = subprocess.run(['sh', str(ROOT / 'postgres_restore_clean.sh'), str(dump), target],
                            capture_output=True, text=True, timeout=90)
    assert result.returncode != 0, 'unsafe restore unexpectedly succeeded'


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: test_postgres_restore_live.py <verified_probe.dump>')
    source = Path(sys.argv[1])
    original = source.read_bytes()
    assert stat.S_IMODE(source.stat().st_mode) == 0o600
    assert stat.S_IMODE(Path(str(source) + '.sha256').stat().st_mode) == 0o600
    assert stat.S_IMODE(source.parent.stat().st_mode) == 0o700
    os.umask(0o077)
    cases = [
        ('missing', original, None),
        ('format', original, 'invalid'),
        ('mismatch', original, '0' * 64),
        ('not_archive', b'not-an-archive', hashlib.sha256(b'not-an-archive').hexdigest()),
        ('truncated', original[:max(1, len(original) // 2)], None),
    ]
    with tempfile.TemporaryDirectory(prefix='doul-restore-negative-') as temp:
        for index, (label, data, digest) in enumerate(cases):
            dump = Path(temp) / (label + '.dump')
            dump.write_bytes(data)
            if label == 'truncated':
                digest = hashlib.sha256(data).hexdigest()
            if digest is not None:
                Path(str(dump) + '.sha256').write_text(digest + '\n')
            target = 'doul_rejected_probe_' + str(index)
            assert not database_exists(target), 'CI target must start absent'
            restore_must_fail(dump, target)
            assert not database_exists(target), 'invalid archive created a database'
            print('live-negative-ok case=' + label)

    # The existing successful probe must survive even a VALID replacement input.
    restore_must_fail(source, 'doul_restore_probe')
    restored = checked(COMPOSE + ['exec', '-T', 'postgres', 'sh', '-ec',
        'psql -w -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d doul_restore_probe -c "SELECT payload FROM platform_restore_probe WHERE id=1"'])
    assert restored == 'snapshot-v1', 'existing target data changed'
    for target in ('postgres', 'template0', 'template1'):
        restore_must_fail(source, target)
    primary = checked(COMPOSE + ['exec', '-T', 'postgres', 'sh', '-ec', 'printf "%s" "$POSTGRES_DB"'])
    restore_must_fail(source, primary)
    print('live-existing-primary-system-protection-ok')


if __name__ == '__main__':
    main()
