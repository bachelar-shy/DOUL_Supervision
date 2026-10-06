# Development object-storage transition: preserve legacy data

PR #30 changes the development S3-compatible runtime from MinIO to RustFS.
This is a runtime selection, not a verified migration of existing object data.

## Default behavior

RustFS and its permission helper mount only `object-storage-rustfs-data`.
The former `object-storage-data` volume is deliberately neither mounted nor
declared in the new Compose file. A previously existing legacy MinIO volume is
therefore not chowned, overwritten, interpreted by RustFS, or included in the
new Compose stack's volume cleanup. Do not run volume-prune commands to remove
it during this transition.

The new RustFS bucket starts empty. Existing object identifiers, versions,
metadata and database references are NOT automatically migrated. A successful
fresh-volume CI run must not be reported as an existing-data migration pass.

## Existing-data transition gate

An environment that needs its old data must not switch application traffic
until a separate approved migration is complete:

1. Identify the exact legacy Compose project/volume, object versions, bucket
   configuration and referring database snapshot. Stop writes at a documented
   DB/object consistency boundary and back up both stores.
2. Keep the legacy runtime and volume intact as the rollback source. Export
   through its supported S3 interface to a separate destination; do not point
   RustFS at MinIO's on-disk directory or assume layout compatibility.
3. Import to the separate RustFS volume. Inventory every required object/version
   and metadata field; record any provider version-ID mapping rather than
   silently replacing exact source references.
4. Verify object counts, byte hashes, source/version references, authenticated
   reads and anonymous/cross-project denial. Reconcile database references.
5. Record the migration result and approved cutover/rollback steps. Only an
   explicit retention/disposition decision may remove a legacy backup/volume.

These steps are a gate, not an executed migration claim. Full DB/object recovery
and consistency remain tracked under #46. Production provider selection remains
separate. Never use the demonstration credentials with real project data.

## Regression checks

`tests/test_runtime_volume_boundary.py` checks that both RustFS runtime and
its permission helper use the new volume and the legacy volume is absent from
the active Compose model. Existing container CI additionally validates Compose,
starts the fresh stack, and exercises private-policy recovery and persistence.
