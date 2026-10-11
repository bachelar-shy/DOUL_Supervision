"""Operator-only synthetic project installation, never a browser CRUD/production fixture bypass."""
import argparse
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import tempfile

from app.reference.engine import uid
from app.reference.validation import require, validate
from services.api.demo import seed
from services.deployment.auth import subject_key

CLASSIFICATION = 'SYNTHETIC_TEST_NOT_SITE_EVIDENCE'
COMPANIES = {'ADM': '테스트 운영관리', 'SUP': '테스트 감리회사',
             'OWN': '테스트 발주처', 'CON': '테스트 시공사'}


def install(store, *, issuer, username, approval_ref, enable_project_settings=False):
    require(os.getenv('DOUL_ENVIRONMENT') == 'staging', 'NOT_AUTHORIZED', 'Synthetic project installation is staging-only')
    require(isinstance(approval_ref, str) and bool(approval_ref.strip()), 'INVALID_REQUEST', 'Operator approval reference required')
    with store.transaction(write=True):
        provision = store.meta.get('provisioning', {})
        require(provision.get('environment') == 'staging' and provision.get('syntheticData') is True,
                'NOT_AUTHORIZED', 'An explicitly synthetic staging environment is required')
        account = store.meta.get('passwordAccounts', {}).get(username, {})
        require(account.get('active') is True, 'NOT_AUTHORIZED', 'Existing active account required')
        key = subject_key(issuer, account['subject'])
        binding = store.meta.get('identityBindings', {}).get(key, {})
        require(binding.get('active') is True, 'NOT_AUTHORIZED', 'Approved identity required')
        admin = store.engine.get('RoleAssignment', binding['defaultRoleAssignmentId'])
        require(admin['actorGroup'] == 'ADM' and admin['active'] and admin['partyId'] == binding['partyId']
                and 'manage_project_roles' in admin['authorityCodes'], 'NOT_AUTHORIZED', 'Approved project administrator required')

        def revise_admin(role):
            # Explicit operator migration authorized by the user request; retain old version/audit.
            updated = dict(role, disciplines=['*'], packageIds=['*'], locationIds=['*'],
                           authorityCodes=sorted(set(role['authorityCodes']) | {'render_document'}))
            if updated == role:
                return role
            updated.update(version=role['version'] + 1, updatedAt=store.engine.at())
            validate(updated, store.engine.schemas['RoleAssignment'], store.engine.schemas)
            store.engine._save('RoleAssignment', updated)
            store.engine._event(updated, 'operator:project_settings_scope', admin['partyId'], admin['id'], uid(),
                                dict(approvalRef=approval_ref, explicitProjectWideAdministration=True), role)
            return updated

        if enable_project_settings:
            admin = revise_admin(admin)
        marker = store.meta.get('siteTestProject')
        if marker is None:
            context = seed(store.engine)
            project_id = context['projectId']
            for file_id, content in context.pop('blobs').items():
                store.put_blob(file_id, content)
            project = store.engine.get('Project', project_id)
            updated = dict(project, name='DOUL 테스트 프로젝트 · 합성자료', version=project['version'] + 1,
                           updatedAt=store.engine.at())
            store.engine._save('Project', updated)
            store.engine._event(updated, 'operator:install_synthetic_project', admin['partyId'], admin['id'], uid(),
                                dict(approvalRef=approval_ref, dataClassification=CLASSIFICATION), project)
            company_groups = {}
            for group, name in COMPANIES.items():
                actor = context['actors'][group]
                role = store.engine.get('RoleAssignment', actor['roleAssignmentId'])
                store.engine.bootstrap('Party', dict(id=role['organizationId'], projectId=project_id,
                    kind='ORGANIZATION', name=name, loginEnabled=False))
                company_groups[role['organizationId']] = group
            sample_admin = revise_admin(store.engine.get('RoleAssignment', context['actors']['ADM']['roleAssignmentId']))
            store.meta.setdefault('projectAdministration', {})[project_id] = dict(
                organizationGroups=company_groups,
                workPackages=[dict(id=context['scope']['packageId'], name='테스트 건축공사')])
            store.meta.setdefault('projectContexts', {})[project_id] = {
                name: deepcopy(context[name]) for name in ('projectId', 'scope', 'requirementRef',
                    'drawingRef', 'evidenceId', 'dataClassification', 'analysisProfile')}

            # A watermarked test PDF uses the existing source drawing's exact reference.
            from scripts.sample_project_materials import create_drawing
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'SYNTHETIC-A201.pdf'
                create_drawing('A-201', '03', 'architecture', 'SYNTHETIC TEST - NOT FOR CONSTRUCTION', 1, path)
                content = path.read_bytes()
            file_id, evidence_id = uid(), uid()
            actor = context['actors']['CON']
            store.engine.add_evidence(evidence_id, project_id, dict(sourceType='original', mediaType='document',
                fileId=file_id, fileHash=sha256(content).hexdigest(), sourcePartyId=actor['partyId'],
                drawingRef=context['drawingRef'], metadata=dict(mimeType='application/pdf', name='SYNTHETIC-A201.pdf',
                    dataClassification=CLASSIFICATION), **context['scope']), content, actor['partyId'], actor['roleAssignmentId'], uid())
            store.put_blob(file_id, content)
            image = Path(__file__).resolve().parents[1] / 'design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png'
            if image.exists():
                content = image.read_bytes(); file_id, image_id = uid(), uid()
                store.engine.add_evidence(image_id, project_id, dict(sourceType='original', mediaType='photo',
                    fileId=file_id, fileHash=sha256(content).hexdigest(), sourcePartyId=actor['partyId'],
                    metadata=dict(mimeType='image/png', name='SYNTHETIC_WWT_contact_sheet_P01-P12.png', dataClassification=CLASSIFICATION),
                    **context['scope']), content, actor['partyId'], actor['roleAssignmentId'], uid())
                store.put_blob(file_id, content)
            marker = dict(projectId=project_id, partyId=sample_admin['partyId'],
                          roleAssignmentId=sample_admin['id'], approvalRef=approval_ref,
                          dataClassification=CLASSIFICATION, installedAt=store.engine.at())
            store.meta['siteTestProject'] = marker
        require(marker.get('dataClassification') == CLASSIFICATION, 'INVALID_REQUEST', 'Unrecognized installation marker')
        sample = store.engine.get('RoleAssignment', marker['roleAssignmentId'])
        require(sample['projectId'] == marker['projectId'] and sample['partyId'] == marker['partyId']
                and sample['actorGroup'] == 'ADM', 'NOT_AUTHORIZED', 'Installation membership mismatch')
        memberships = binding.setdefault('projectAssignments', {})
        for project_id, party_id, role_id in [(admin['projectId'], admin['partyId'], admin['id']),
                                             (marker['projectId'], marker['partyId'], marker['roleAssignmentId'])]:
            approved = dict(partyId=party_id, defaultRoleAssignmentId=role_id)
            require(project_id not in memberships or memberships[project_id] == approved,
                    'NOT_AUTHORIZED', 'Existing approved membership must not be replaced')
            memberships[project_id] = approved
        return deepcopy(marker)


def main():
    from services.api.persistence import create_postgres_persistence
    from services.runtime_config import secret
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', required=True)
    parser.add_argument('--approval-ref', required=True)
    parser.add_argument('--enable-project-settings', action='store_true', help='Explicitly authorize project-wide admin setup scope with retained audit/history')
    args = parser.parse_args()
    require(os.getenv('DOUL_ENVIRONMENT') == 'staging', 'NOT_AUTHORIZED', 'Staging only')
    store = create_postgres_persistence(secret('DATABASE_URL'), demo=False)
    try:
        result = install(store, issuer=os.environ['DOUL_AUTH_ISSUER'], username=args.username,
                         approval_ref=args.approval_ref, enable_project_settings=args.enable_project_settings)
        print('Synthetic test project installed: ' + result['projectId'])
    finally:
        store.close()


if __name__ == '__main__':
    main()
