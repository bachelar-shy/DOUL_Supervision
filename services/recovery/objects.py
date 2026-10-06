"""Version-aware S3 backup and non-destructive, new-bucket restore.

Retain the server's interleaved Version/DeleteMarker order from XML. Sorting the
SDK's separate arrays by timestamp loses order when timestamps are identical.
Destination version IDs are different: preserve an explicit mapping, never
rewrite an original evidence reference silently.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlencode
from uuid import uuid4
import xml.etree.ElementTree as ET

from .archive import CHUNK, digest_file, private_directory, regular_file

NS = '{http://s3.amazonaws.com/doc/2006-03-01/}'
MAX_OBJECT = 5 * 1024**3  # Direct put_object limit; fail explicitly rather than truncate.


def ordered_xml_response(http_response, parsed, **_):
    raw = http_response.content
    if len(raw) > 16 * 1024**2 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('Unsafe or oversized version inventory XML')
    root = ET.fromstring(raw)
    if root.tag != NS + 'ListVersionsResult':
        raise ValueError('Unexpected version inventory response')
    encoded = root.findtext(NS + 'EncodingType') == 'url'
    rows = []
    for child in root:
        kind = child.tag.removeprefix(NS)
        if kind not in {'Version', 'DeleteMarker'}: continue
        key = child.findtext(NS + 'Key')
        version = child.findtext(NS + 'VersionId')
        if key is None or version is None: raise ValueError('Incomplete object version identity')
        if encoded: key = unquote(key)
        rows.append(dict(key=key, versionId=version, deleteMarker=kind == 'DeleteMarker',
                         isLatest=child.findtext(NS + 'IsLatest') == 'true',
                         lastModified=child.findtext(NS + 'LastModified'),
                         size=int(child.findtext(NS + 'Size') or 0)))
    parsed['_doulRows'] = rows
    next_key = root.findtext(NS + 'NextKeyMarker')
    parsed['_doulNextKey'] = unquote(next_key) if next_key and encoded else next_key
    parsed['_doulNextVersion'] = root.findtext(NS + 'NextVersionIdMarker')


def inventory(client, bucket, max_versions=1000000):
    uid = 'doul-version-order-' + uuid4().hex
    client.meta.events.register('after-call.s3.ListObjectVersions', ordered_xml_response, unique_id=uid)
    rows = []
    seen = set()
    marker = {}
    previous_marker = None
    try:
        while True:
            page = client.list_object_versions(Bucket=bucket, EncodingType='url', MaxKeys=1000, **marker)
            if '_doulRows' not in page: raise ValueError('Version ordering metadata unavailable')
            for row in page['_doulRows']:
                identity = (row['key'], row['versionId'])
                if identity in seen: raise ValueError('Duplicate or changing version inventory')
                if not row['versionId'] or len(row['key'].encode()) > 1024 or row['size'] < 0:
                    raise ValueError('Invalid version inventory entry')
                seen.add(identity); rows.append(row)
                if len(rows) > max_versions: raise ValueError('Version inventory exceeds configured limit')
            if not page.get('IsTruncated'): break
            current = (page.get('_doulNextKey'), page.get('_doulNextVersion'))
            if current == previous_marker or current[0] is None or current[1] is None:
                raise ValueError('Invalid version pagination cursor')
            previous_marker = current
            marker = {'KeyMarker': current[0], 'VersionIdMarker': current[1]}
    finally:
        client.meta.events.unregister('after-call.s3.ListObjectVersions', unique_id=uid)
    groups = defaultdict(list)
    for row in rows: groups[row['key']].append(row)
    ordered = []
    def timestamp(entry):
        value = entry['lastModified']
        match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|\+00:00)', value or '')
        if not match:
            raise ValueError('Invalid version timestamp')
        seconds = Decimal(int(datetime.fromisoformat(match[1]).replace(tzinfo=timezone.utc).timestamp()))
        return seconds + Decimal('0.' + (match[2] or '0'))
    for key in sorted(groups):
        entries = groups[key]
        by_time = defaultdict(list)
        for entry in entries: by_time[timestamp(entry)].append(entry)
        for tied in by_time.values():
            if len({entry['deleteMarker'] for entry in tied}) > 1:
                # Some S3-compatible servers group Version and DeleteMarker XML
                # children separately. Equal timestamps then cannot establish a
                # cross-kind historical order; do not invent a sequence.
                raise ValueError('Ambiguous equal-time version/delete-marker history')
        entries.sort(key=timestamp, reverse=True)
        if not entries[0]['isLatest'] or sum(bool(e['isLatest']) for e in entries) != 1:
            raise ValueError('Object history has no unique current version matching timestamps')
        ordered.extend(entries)
    return ordered


def backup_objects(client, bucket, root):
    root = private_directory(root)
    (root / 'bytes').mkdir(mode=0o700)
    before = inventory(client, bucket)
    source_versioning = client.get_bucket_versioning(Bucket=bucket).get('Status', 'NeverEnabled')
    entries = []
    for row in before:
        entry = deepcopy(row)
        if not row['deleteMarker']:
            if row['size'] > MAX_OBJECT:
                raise ValueError('Object exceeds supported direct restore size; no partial backup accepted')
            response = client.get_object(Bucket=bucket, Key=row['key'], VersionId=row['versionId'])
            digest = sha256()
            member = 'bytes/' + sha256((row['key'] + '\x00' + row['versionId']).encode()).hexdigest()
            count = 0
            with (root / member).open('xb') as writer:
                try:
                    while data := response['Body'].read(CHUNK):
                        count += len(data)
                        if count > MAX_OBJECT: raise ValueError('Object grew beyond configured limit')
                        digest.update(data); writer.write(data)
                finally:
                    response['Body'].close()
            if count != row['size'] or count != response['ContentLength']:
                raise ValueError('Version inventory and downloaded bytes differ')
            headers = {key: response[key] for key in
                       ('ContentType', 'ContentEncoding', 'ContentLanguage', 'ContentDisposition', 'CacheControl')
                       if key in response}
            lock = {key: response[key].isoformat() if hasattr(response[key], 'isoformat') else response[key]
                    for key in ('ObjectLockMode', 'ObjectLockRetainUntilDate', 'ObjectLockLegalHoldStatus') if key in response}
            tags = client.get_object_tagging(Bucket=bucket, Key=row['key'], VersionId=row['versionId']).get('TagSet', [])
            entry.update(member=member, sha256=digest.hexdigest(), metadata=response.get('Metadata', {}),
                         headers=headers, tags=tags, objectLock=lock)
        entries.append(entry)
    after = inventory(client, bucket)
    if before != after or source_versioning != client.get_bucket_versioning(Bucket=bucket).get('Status', 'NeverEnabled'):
        raise RuntimeError('Object source changed during backup; quiescence boundary failed')
    manifest = dict(schemaVersion=1, bucket=bucket, versioning=source_versioning,
                    order='server-newest-first-per-key', entries=entries,
                    sourceInventorySha256=sha256(json.dumps(before, sort_keys=True).encode()).hexdigest())
    (root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    return manifest


def validate_objects(root):
    root = Path(root)
    with regular_file(root / 'manifest.json') as file:
        manifest = json.load(file)
    if manifest.get('schemaVersion') != 1 or manifest.get('order') != 'server-newest-first-per-key':
        raise ValueError('Unsupported object backup schema/order')
    seen = set()
    by_key = defaultdict(list)
    for entry in manifest['entries']:
        identity = entry['key'], entry['versionId']
        if identity in seen: raise ValueError('Duplicate source version')
        seen.add(identity); by_key[entry['key']].append(entry)
        if not isinstance(entry['key'], str) or not isinstance(entry['versionId'], str):
            raise ValueError('Invalid object identity')
        if not entry['deleteMarker']:
            if not re.fullmatch(r'bytes/[a-f0-9]{64}', entry['member']) or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']):
                raise ValueError('Invalid version byte member')
            path = root / entry['member']
            if entry['size'] > MAX_OBJECT or path.stat().st_size != entry['size'] or digest_file(path) != entry['sha256']:
                raise ValueError('Object backup integrity check failed')
            if set(entry['headers']) - {'ContentType','ContentEncoding','ContentLanguage','ContentDisposition','CacheControl'}:
                raise ValueError('Unsupported restore header')
            if set(entry.get('objectLock', {})) - {'ObjectLockMode','ObjectLockRetainUntilDate','ObjectLockLegalHoldStatus'}:
                raise ValueError('Unsupported object retention setting')
    for entries in by_key.values():
        if not entries[0]['isLatest'] or sum(bool(e['isLatest']) for e in entries) != 1:
            raise ValueError('Invalid latest version history')
    return manifest


def restore_objects(client, root, prefix='doul-restore-', target_encryption=None):
    manifest = validate_objects(root)  # Validate EVERY source file before any write.
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,20}-', prefix): raise ValueError('Invalid restore bucket prefix')
    bucket = prefix + uuid4().hex
    region = client.meta.region_name or 'us-east-1'
    create = dict(Bucket=bucket)
    if region != 'us-east-1': create['CreateBucketConfiguration'] = {'LocationConstraint': region}
    if any(e.get('objectLock') for e in manifest['entries']): create['ObjectLockEnabledForBucket'] = True
    # Random, new target only. Existing source bucket is never altered.
    created = client.create_bucket(**create)
    existing = client.list_object_versions(Bucket=bucket)
    if existing.get('Versions') or existing.get('DeleteMarkers'):
        raise RuntimeError('Restore bucket was not empty')
    client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={'Status':'Enabled'})
    if client.get_bucket_versioning(Bucket=bucket).get('Status') != 'Enabled':
        raise RuntimeError('Versioning must be enabled before any restore writes')
    # New buckets have no public policy; no source ACL/policy is copied.
    if target_encryption is not None:
        client.put_bucket_encryption(Bucket=bucket, ServerSideEncryptionConfiguration=target_encryption)
    mapping = []
    for entry in reversed(manifest['entries']):
        key = entry['key']
        if entry['deleteMarker']:
            # Without VersionId this creates a marker, never physically deletes
            # historical versions. This executes ONLY in the new versioned target.
            response = client.delete_object(Bucket=bucket, Key=key)
            if response.get('DeleteMarker') is not True: raise RuntimeError('Delete marker was not preserved')
        else:
            with regular_file(Path(root) / entry['member']) as body:
                response = client.put_object(Bucket=bucket, Key=key, Body=body,
                    ContentLength=entry['size'], Metadata=entry['metadata'],
                    Tagging=urlencode([(t['Key'], t['Value']) for t in entry['tags']]),
                    **entry['headers'], **entry.get('objectLock', {}))
        version = response.get('VersionId')
        if not version or version == 'null': raise RuntimeError('Restored version has no distinct version ID')
        mapping.append(dict(sourceBucket=manifest['bucket'], sourceKey=key, sourceVersionId=entry['versionId'],
                            targetBucket=bucket, targetKey=key, targetVersionId=version,
                            deleteMarker=entry['deleteMarker'], originalLastModified=entry['lastModified'],
                            sha256=entry.get('sha256')))
        if not entry['deleteMarker']:
            verified = client.get_object(Bucket=bucket, Key=key, VersionId=version)
            digest = sha256()
            try:
                while chunk := verified['Body'].read(CHUNK): digest.update(chunk)
            finally: verified['Body'].close()
            tags = client.get_object_tagging(Bucket=bucket, Key=key, VersionId=version)['TagSet']
            if digest.hexdigest() != entry['sha256'] or verified.get('Metadata', {}) != entry['metadata'] or sorted(tags, key=lambda t:t['Key']) != sorted(entry['tags'], key=lambda t:t['Key']):
                raise RuntimeError('Restored object integrity/metadata mismatch')
            if any(verified.get(key) != value for key,value in entry['headers'].items()):
                raise RuntimeError('Restored object content headers differ')
    restored = inventory(client, bucket)
    if len(restored) != len(manifest['entries']): raise RuntimeError('Restored version count mismatch')
    actual = {(e['key'],e['versionId'],e['deleteMarker']) for e in restored}
    expected = {(e['targetKey'],e['targetVersionId'],e['deleteMarker']) for e in mapping}
    if actual != expected: raise RuntimeError('Restored version mapping mismatch')
    current_source = {e['key']: e for e in manifest['entries'] if e['isLatest']}
    current_target = {e['key']: e for e in restored if e['isLatest']}
    translated = {(m['sourceKey'],m['sourceVersionId']):m for m in mapping}
    for key, source in current_source.items():
        expected_id = translated[(key,source['versionId'])]['targetVersionId']
        if key not in current_target or current_target[key]['versionId'] != expected_id:
            raise RuntimeError('Restored latest-version semantics mismatch')
    return dict(schemaVersion=1, bucket=bucket, versionMapping=mapping,
                sourceReferencesRewritten=False, promotionApproved=False, verified=True)
