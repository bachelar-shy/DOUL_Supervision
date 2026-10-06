"""Shared, secret-safe runtime configuration primitives."""
from __future__ import annotations

import os
import stat
from urllib.parse import urlsplit


ENVIRONMENTS = {'development', 'staging', 'pilot'}


def environment():
    value = os.getenv('DOUL_ENVIRONMENT', 'development').strip().lower()
    if value not in ENVIRONMENTS:
        raise ValueError('Unsupported runtime environment')
    return value


def secret(name, required=True, multiline=False):
    raw = os.getenv(name, '')
    filename = os.getenv(name + '_FILE', '')
    if raw and filename:
        raise ValueError(name + ': choose file or environment, not both')
    if environment() != 'development' and raw:
        raise ValueError(name + ': file-backed secret required outside development')
    value = raw
    if filename:
        fd = os.open(filename, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
                raise ValueError(name + ': invalid secret file')
            if environment() != 'development' and info.st_mode & 0o027:
                raise ValueError(name + ': secret file must deny other access and group writes')
            with os.fdopen(fd, 'r', encoding='utf-8') as handle:
                fd = -1
                value = handle.read(65537)
        finally:
            if fd >= 0: os.close(fd)
    value = value.strip()
    if len(value) > 65536 or '\x00' in value or (not multiline and ('\n' in value or '\r' in value)):
        raise ValueError(name + ': invalid secret value')
    if required and not value:
        raise ValueError(name + ': required configuration missing')
    return value


def service_url(value, allow_http=False):
    parsed = urlsplit(value)
    if parsed.scheme not in ({'http', 'https'} if allow_http else {'https'}) or not parsed.hostname:
        raise ValueError('HTTPS service URL required')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Service URL must not contain credentials, query or fragment')
    return value.rstrip('/')


def object_storage_client():
    import boto3
    from botocore.config import Config
    endpoint = service_url(os.environ['OBJECT_STORAGE_ENDPOINT'], allow_http=environment() == 'development')
    return boto3.client('s3', endpoint_url=endpoint,
        aws_access_key_id=secret('OBJECT_STORAGE_ACCESS_KEY'),
        aws_secret_access_key=secret('OBJECT_STORAGE_SECRET_KEY'),
        region_name=os.getenv('OBJECT_STORAGE_REGION', 'us-east-1'),
        config=Config(signature_version='s3v4', connect_timeout=5, read_timeout=15,
                      retries={'mode': 'standard', 'max_attempts': 2},
                      s3={'addressing_style': 'path'},
                      request_checksum_calculation='when_required', response_checksum_validation='when_required'))


DEFAULT_PASSWORDS = {'local-postgres-only', 'local-redis-only', 'disposable-ci-only', 'password', 'changeme'}


def validate_database_dsn(dsn, stage=None):
    """Validate operational credentials/TLS before a pool can open a socket."""
    from psycopg.conninfo import conninfo_to_dict
    stage = stage or environment()
    if stage == 'development':
        return dsn
    if stage not in {'staging', 'pilot'}:
        raise ValueError('Unknown database environment')
    settings = conninfo_to_dict(dsn)
    if not all(settings.get(key) for key in ('host', 'dbname', 'user', 'password')):
        raise ValueError('Explicit database identity required')
    if settings['password'] in DEFAULT_PASSWORDS:
        raise ValueError('Development/default database credentials prohibited')
    if stage == 'pilot' and (settings.get('sslmode') != 'verify-full' or not settings.get('sslrootcert')):
        raise ValueError('Pilot database connections require verified TLS')
    return dsn


def validate_redis_url(url, stage=None):
    """Use the client's parsed settings: URL options override keyword defaults."""
    from redis.connection import parse_url
    stage = stage or environment()
    if stage == 'development':
        return url
    if stage not in {'staging', 'pilot'}:
        raise ValueError('Unknown Redis environment')
    parsed = urlsplit(url)
    settings = parse_url(url)
    if parsed.scheme not in {'redis', 'rediss'} or not settings.get('host') or not settings.get('password'):
        raise ValueError('Authenticated Redis URL required')
    if settings['password'] in DEFAULT_PASSWORDS:
        raise ValueError('Development/default Redis credentials prohibited')
    if stage == 'pilot':
        if parsed.scheme != 'rediss':
            raise ValueError('Pilot Redis connections require TLS')
        if settings.get('ssl_cert_reqs', 'required') != 'required' or settings.get('ssl_check_hostname', True) is not True:
            raise ValueError('Pilot Redis certificate and hostname verification cannot be disabled')
    return url
