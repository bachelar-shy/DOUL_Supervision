"""Restore a user-provided reference PDF into the isolated staging test project.

Original bytes remain private runtime data. This does not issue, approve, or
replace a construction drawing, nor bind the file to a synthetic drawing.
"""
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from app.reference.engine import uid
from app.reference.validation import ContractError, require
from scripts.install_site_test_project import CLASSIFICATION
from services.deployment.auth import subject_key


def import_reference(store, *, project_id, issuer, username, content, filename,
                     expected_hash, source_reference, approval_ref):
    require(os.getenv('DOUL_ENVIRONMENT') == 'staging', 'NOT_AUTHORIZED', 'Staging only')
    require(bool(approval_ref.strip()) and bool(source_reference.strip()), 'INVALID_REQUEST', 'Provenance required')
    require(Path(filename).name == filename and filename.lower().endswith('.pdf'), 'INVALID_REQUEST', 'PDF filename required')
    # Match the resumable server upload limit, rather than the small-file UI helper.
    require(content.startswith(b'%PDF-') and 0 < len(content) <= 64 * 1024 * 1024, 'MIME_INVALID', 'Expected a PDF within the server upload limit')
    require(sha256(content).hexdigest() == expected_hash, 'CHECKSUM_MISMATCH', 'Original file hash mismatch')
    with store.transaction(write=True):
        provision = store.meta.get('provisioning', {})
        marker = store.meta.get('siteTestProject', {})
        require(provision.get('environment') == 'staging' and provision.get('syntheticData') is True
                and marker.get('projectId') == project_id and marker.get('dataClassification') == CLASSIFICATION,
                'NOT_AUTHORIZED', 'Only the installed isolated test project may receive this reference')
        account = store.meta.get('passwordAccounts', {}).get(username, {})
        require(account.get('active') is True, 'NOT_AUTHORIZED', 'Active operator account required')
        binding = store.meta.get('identityBindings', {}).get(subject_key(issuer, account['subject']), {})
        membership = binding.get('projectAssignments', {}).get(project_id, {})
        require(binding.get('active') is True and membership.get('defaultRoleAssignmentId') == marker['roleAssignmentId']
                and membership.get('partyId') == marker['partyId'], 'NOT_AUTHORIZED', 'Approved test membership required')
        operator = store.engine.get('RoleAssignment', marker['roleAssignmentId'])
        require(operator['actorGroup'] == 'ADM', 'NOT_AUTHORIZED', 'Project administrator required')
        scope = deepcopy(store.meta['projectContexts'][project_id]['scope'])
        store.engine.authorize(dict(projectId=project_id, **scope), 'manage_project_roles', operator['partyId'], operator['id'])
        # Use an existing scoped test uploader; never grant the admin upload or
        # technical approval powers. Audit identifies this as an operator import.
        uploader = None
        for (kind, _), role in store.engine._records.items():
            if kind != 'RoleAssignment' or role['projectId'] != project_id or role['actorGroup'] != 'CON':
                continue
            try:
                store.engine.authorize(dict(projectId=project_id, **scope), 'create_evidence', role['partyId'], role['id'])
            except ContractError:
                continue
            uploader = role
            break
        require(uploader is not None, 'NOT_AUTHORIZED', 'No authorized test uploader; do not widen permissions')
        identity = f'doul/test-reference/{project_id}/{source_reference}/{expected_hash}'
        evidence_id = str(uuid5(NAMESPACE_URL, identity))
        file_id = str(uuid5(NAMESPACE_URL, identity + '/file'))
        metadata = dict(name=filename, mimeType='application/pdf', byteCount=len(content),
                        dataClassification='USER_PROVIDED_ORIGINAL', documentPurpose='construction',
                        sourceApprovalStatus='unverified',
                        sourceReference=source_reference, importApprovalRef=approval_ref,
                        importedByPartyId=operator['partyId'], testOnly=True,
                        notice='사용자 제공 원본 · 공사용 도면')
        if ('Evidence', evidence_id) in store.engine._records:
            existing = store.engine.get('Evidence', evidence_id)
            require(existing['projectId'] == project_id and existing['fileId'] == file_id
                    and existing['fileHash'] == expected_hash and existing.get('metadata') == metadata
                    and 'drawingRef' not in existing and sha256(store.blob(file_id)).hexdigest() == expected_hash,
                    'CHECKSUM_MISMATCH', 'Existing reference differs; never overwrite')
            return existing
        result = store.engine.add_evidence(evidence_id, project_id,
            dict(sourceType='original', mediaType='document', fileId=file_id, fileHash=expected_hash,
                 sourcePartyId=operator['partyId'], metadata=metadata, **scope),
            content, uploader['partyId'], uploader['id'], 'restore-reference-' + evidence_id)
        store.put_blob(file_id, content)
        store.engine._event(result['record'], 'operator:restore_user_reference', operator['partyId'], operator['id'], uid(),
                            dict(approvalRef=approval_ref, sourceReference=source_reference,
                                 sha256=expected_hash, uploaderRoleId=uploader['id'], constructionApproval='NOT_ASSERTED'), None)
        return deepcopy(result['record'])


def main():
    import argparse
    from services.api.persistence import create_postgres_persistence
    from services.runtime_config import secret
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project-id', 'username', 'file', 'expected-hash', 'source-reference', 'approval-ref'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    require(os.getenv('DOUL_ENVIRONMENT') == 'staging', 'NOT_AUTHORIZED', 'Staging only')
    store = create_postgres_persistence(secret('DATABASE_URL'), demo=False)
    try:
        record = import_reference(store, project_id=args.project_id, issuer=os.environ['DOUL_AUTH_ISSUER'],
            username=args.username, content=Path(args.file).read_bytes(), filename=Path(args.file).name,
            expected_hash=args.expected_hash, source_reference=args.source_reference, approval_ref=args.approval_ref)
        print(f"Reference restored: {record['metadata']['name']} / {record['id']} / {record['fileHash']}")
    finally:
        store.close()


if __name__ == '__main__':
    main()
