# Complete recovery set: DB, object versions, configuration and secret inventory

Issue #46. The executable implementation is `services/recovery`. It preserves
the existing safe PostgreSQL utilities and adds an authenticated encrypted set,
version-aware object recovery, configuration provenance and a verified clean
restore. It does not silently replace the running database or storage bucket.

## Recovery boundary

The current application stores official Evidence bytes inside the PostgreSQL
snapshot/blob adapter. The declared storage contract is `database-blobs-v1`.
The bundle includes those bytes plus every version/delete marker in the
configured S3 bucket. A future S3 Evidence adapter must explicitly consume the
source-to-target version mapping; provider version IDs must never be silently
rewritten or assumed unchanged. An unknown application storage contract is
rejected rather than receiving a misleading restore success.

Only the selected Compose project's API and worker writer services are stopped.
The operator must separately stop external writers and affirm that boundary.
The tool records the running writers, stops them, checks that they stopped,
compares DB and object fingerprints before/after backup, and resumes only the
writers previously running. It never runs `down -v` or removes user volumes.
Invalid tracked-release references are rejected before stopping services.

This operator adapter targets a PostgreSQL service in the supplied Compose
configuration. For a managed database, use an approved operator container or
replacement database adapter that preserves the same new-target/fingerprint
contract; do not point this script at a different DB just to make it execute.
The supplied development and staging verification uses actual Compose services.

## What is retained

- PostgreSQL custom archive, mandatory SHA-256 sidecar, application snapshot
  format, canonical snapshot hash and every Evidence blob hash.
- Every S3 object version, immutable backup byte hash, content headers, metadata,
  tags, original timestamp, delete marker and current-version identity.
- The exact XML version timestamps and pagination order. Cross-kind history is
  chronologically verified because some providers serialize versions and markers
  in separate groups. Equal-time version/marker ambiguity fails explicitly instead
  of inventing a history; a provider event journal is then required.
- The exact release commit and tracked configuration artifacts with hashes.
  Runtime Project Configuration also remains in the DB snapshot.
- A versioned secret-recovery inventory of names, vault references and owners.
  Secret material is not put in this inventory or committed to the repository.
- A consistency declaration and draft/approved RPO/RTO targets.

The full set is encrypted with AES-256-GCM using a separately stored random
32-byte recovery key and fresh nonce. The key must be an owner-only file. The
archive header is authenticated; decryption must finish authentication before
any extraction or database/object operation. Plaintext staging exists only in
private temporary directories. Backups use new output names and cannot replace
an existing backup. The archive extractor rejects links, traversal, duplicate
paths and configured size/member-limit violations.

## Backup

Create a plan from `recovery_plan.example.json`. Replace the all-zero commit,
example vault references and role placeholders with the intended environment's
exact tracked release and approved operational assignments. The example is not
an approval record and contains no valid production secrets.

```sh
python -m services.recovery backup \
  --plan /operator/approved-recovery-plan.json \
  --bundle /private-backups/project-20261006.backup.enc \
  --key-file /operator/secrets/recovery-key.bin \
  --report /private-backups/project-20261006-backup-report.json \
  --quiesce --external-writers-paused
```

Use file-backed DATABASE_URL and OBJECT_STORAGE_* credentials outside development.
The operator must verify that the DSN and Compose PostgreSQL service identify
the same source database. The later clean-restore fingerprint checks catch a
mismatched dump, but such a set is not a usable backup until restore is verified.
Schedule verified backups through the deployment platform; selecting an RPO
without an actual scheduler and retained off-host copy does not meet that RPO.

## Clean restore and verification

```sh
python -m services.recovery restore \
  --plan /operator/approved-target-plan.json \
  --bundle /private-backups/project-20261006.backup.enc \
  --key-file /operator/secrets/recovery-key.bin \
  --report /private-backups/project-20261006-restore-report.json
```

The target environment is chosen only by the explicit operator plan, never by
archive-contained command paths or credentials. After authentication and all
file checks, the tool creates a random new database and random new versioned
bucket. It compares the restored application's full snapshot/blob fingerprint,
reads each restored object version back, compares hash/metadata/tags/headers,
and verifies version count and current/deleted status.

The source database and bucket are not altered. Source ACL/public policies are
not copied. Destination encryption is explicitly configured outside development
using `DOUL_RESTORE_ENCRYPTION_CONFIG`. Object-lock settings, when present, are
passed to an object-lock-enabled new bucket; unsupported policies fail rather
than being silently dropped. This direct-object adapter supports individual
objects up to 5 GiB. Larger objects fail explicitly and require a multipart
recovery adapter before their environment can pass the restore gate.

If restore fails, new incomplete targets are left isolated for inspection.
They are not promoted and not automatically deleted. Existing data remains the
rollback source. The private result report identifies verified targets and
version mappings; `promotionApproved=false` is intentional.

## Promotion and rollback

The operation owner must review: correct project/release/config versions,
verified DB/blob/object hashes, application authorization checks, mapping of any
provider version references, secret retrieval/rotation, and required encryption.
Only then change service configuration to the new targets. Run authenticated
smoke tests before routing users. Do not change an official source reference or
claim a business workflow succeeded merely because restoration succeeded.

Keep the previous targets intact until the approved rollback/retention period
has passed. Failed cutover restores the previous release/configuration and
previous DB/bucket references. Schema downgrade or destructive data replacement
is never an implicit rollback action.

## Secret recovery procedure

The recovery approver retrieves the exact approved recovery-key version from a
separate offline/vault path, never from the backup itself. The operator retrieves
DB, Redis, S3, identity-verification and alert credentials from their inventories,
checks expiry/revocation and rotates compromised material before activation.
A lost AES key makes the encrypted bundle unrecoverable; test key retrieval and
decryption during rehearsals. Do not store raw secrets in reports, command-line
arguments or Git. Track custody/approval in the deployment evidence record.

## Initial operational targets (draft, not a measured guarantee)

| Target | Proposed development/staging baseline | Approval |
| --- | --- | --- |
| RPO | 24 hours / 86400 seconds | Operation owner must approve and schedule |
| RTO | 4 hours / 14400 seconds | Validate with realistic dataset and deployment |
| Backup execution | Platform operations | Assign named operator per environment |
| Restore execution | Recovery operator | Separate approval before promotion |
| Activation decision | Project operation owner | Required before actual cutover |

CI measures the duration of its small synthetic rehearsal, not a real project's
RTO. Pilot cannot claim its target met from that number. Confirm off-host copy,
retention, encryption-key custody, scheduler, capacity and restore frequency in
the environment configuration; no business retention period is invented here.

## Executed verification path

`platform-consistent-recovery` creates a disposable real PostgreSQL/RustFS/Redis
and API/Worker stack. It adds synthetic original Evidence, several object
versions with metadata/tags and delete markers, pauses writers, creates the
encrypted bundle, rejects wrong keys/tampering before any target operation,
restores new targets, verifies fingerprints/history/private access, and resumes
the previously running writers. Unit tests also exercise ambiguous equal-timestamp rejection,
Unicode keys, pagination, path safety, source-change rejection and private keys.

Primary references: AWS S3 ListObjectVersions/DeleteObject APIs, boto3 after-call
response hooks (also checked with Context7), and cryptography's GCM requirement
not to use plaintext before authentication finalization. This is not a claim of
an actual site backup, live disaster recovery or Pilot authorization.
