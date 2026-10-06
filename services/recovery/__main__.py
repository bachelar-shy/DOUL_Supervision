"""Operator-only recovery CLI. All operations target an explicit supplied plan."""
import argparse
import json
import os
from pathlib import Path

from services.runtime_config import secret, object_storage_client, environment
from services.telemetry import emit, configure_logging
from .archive import load_key, private_directory
from .bundle import validate_plan, create_bundle, restore_bundle, ComposeBoundary


def main():
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['backup','restore'])
    parser.add_argument('--plan', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--key-file', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--quiesce', action='store_true')
    parser.add_argument('--external-writers-paused', action='store_true')
    args = parser.parse_args()
    if args.operation == 'backup' and not (args.quiesce and args.external_writers_paused):
        parser.error('backup requires explicit --quiesce --external-writers-paused')
    client = None
    try:
        plan = validate_plan(json.loads(Path(args.plan).read_text()))
        key = load_key(args.key_file)
        dsn = secret('DATABASE_URL')
        client = object_storage_client()
        # The configured target encryption policy is separate from source metadata.
        encryption = None
        if environment() != 'development':
            config = os.getenv('DOUL_RESTORE_ENCRYPTION_CONFIG')
            if not config: raise ValueError('Approved target storage encryption configuration required')
            encryption = json.loads(Path(config).read_text())
        report = Path(args.report)
        private_directory(report.parent)
        if report.exists() or report.is_symlink(): raise FileExistsError('Recovery report already exists')
        boundary = ComposeBoundary(plan)
        if args.operation == 'backup':
            result = create_bundle(plan, args.bundle, key, client, dsn, boundary)
        else:
            result = restore_bundle(args.bundle, key, client, dsn, boundary, target_encryption=encryption)
        fd = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            json.dump(result, handle, sort_keys=True, ensure_ascii=False, allow_nan=False)
            handle.flush(); os.fsync(handle.fileno())
        emit('recovery', args.operation + '-verified')
        return 0
    except Exception as exc:
        emit('recovery', 'operation-failed', errorType=type(exc).__name__)
        return 1
    finally:
        if client is not None: client.close()


if __name__ == '__main__':
    raise SystemExit(main())
