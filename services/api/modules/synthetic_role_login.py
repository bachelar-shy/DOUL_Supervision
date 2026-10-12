"""Explicitly enabled staging-only passwordless entry to the existing synthetic test project.

No real project, password account or technical qualification is created. The issued JWT
uses the regular pinned signer and is bound to exactly one synthetic project role.
"""
import os

from fastapi import Request

from app.reference.validation import ContractError, require
from services.deployment.auth import subject_key

ROLES = frozenset({'OWN', 'CON', 'SUP', 'ADM'})
MARKER = 'SYNTHETIC_TEST_NOT_SITE_EVIDENCE'
FLAG = 'synthetic-only'


def configured(stage, *, demo, password_accounts):
    value = os.environ.get('DOUL_TEST_ROLE_LOGIN', '')
    if value not in {'', FLAG}:
        raise RuntimeError('DOUL_TEST_ROLE_LOGIN requires an explicit synthetic-only value')
    if value and (stage != 'staging' or demo or password_accounts is None):
        raise RuntimeError('Passwordless role login is permitted only with staging password authentication')
    return value == FLAG


def synthetic_project_id(store):
    marker = store.meta.get('siteTestProject')
    require(isinstance(marker, dict) and marker.get('dataClassification') == MARKER,
            'NOT_AUTHORIZED', 'Synthetic staging project is not installed')
    project_id = marker['projectId']
    context = store.meta.get('projectContexts', {}).get(project_id, {})
    provision = store.meta.get('provisioning', {})
    require(context.get('dataClassification') == MARKER and
            provision.get('environment') == 'staging' and provision.get('syntheticData') is True,
            'NOT_AUTHORIZED', 'Only isolated synthetic staging data is available')
    return project_id


def validate_synthetic_identity(store, session, enabled):
    """Invalidate shortcut JWTs immediately when staging shortcut mode is disabled."""
    binding = store.meta.get('identityBindings', {}).get(session.get('identityKey'), {})
    if binding.get('syntheticRoleShortcut') is not True:
        return
    require(enabled, 'UNAUTHENTICATED', 'Test login is disabled')
    project_id = synthetic_project_id(store)
    role = store.engine.get('RoleAssignment', session['roleAssignmentId'])
    require(role['projectId'] == project_id and
            binding.get('defaultRoleAssignmentId') == role['id'] and
            not binding.get('projectAssignments') and
            session.get('selectedProjectId') is None,
            'UNAUTHENTICATED', 'Test session cannot leave its synthetic project')


def install_synthetic_role_login(app, store, *, stage, enabled, password_accounts, origins, body_json):
    @app.post('/auth/test-role-login')
    async def login_test_role(request: Request):
        require(enabled, 'NOT_AUTHORIZED', 'Test role login is disabled')
        require(request.headers.get('origin') in origins, 'ORIGIN_DENIED',
                'Only the configured HTTPS test site may request a test session')
        body = await body_json(request)
        require(set(body) == {'role'} and isinstance(body.get('role'), str) and body['role'] in ROLES,
                'INVALID_REQUEST', 'Select one of the four provided test roles')
        group = body['role']
        with store.transaction(write=True):
            project_id = synthetic_project_id(store)
            assignments = [r for (kind, _), r in store.engine._records.items()
                           if kind == 'RoleAssignment' and r['projectId'] == project_id
                           and r['actorGroup'] == group and r['active']]
            # The original synthetic administrator identity is deterministic, even if
            # new staff are added later. Select stable original fixture roles for others.
            marker = store.meta['siteTestProject']
            if group == 'ADM':
                assignment = store.engine.get('RoleAssignment', marker['roleAssignmentId'])
                require(assignment in assignments, 'NOT_AUTHORIZED', 'Test administrator is inactive')
            else:
                require(bool(assignments), 'NOT_AUTHORIZED', 'Test role is not assigned')
                assignment = min(assignments, key=lambda r: (r['createdAt'], r['id']))
            party = store.engine.get('Party', assignment['partyId'])
            require(party['kind'] == 'PERSON' and party['projectId'] == project_id and
                    party.get('loginEnabled') is True, 'NOT_AUTHORIZED', 'Test role is disabled')
            subject = 'staging-synthetic-role:' + project_id + ':' + group
            identity_key = subject_key(password_accounts.verifier.issuer, subject)
            bindings = store.meta.setdefault('identityBindings', {})
            expected = dict(active=True, partyId=party['id'],
                            defaultRoleAssignmentId=assignment['id'], validAfter=0,
                            syntheticRoleShortcut=True)
            current = bindings.get(identity_key)
            require(current is None or current == expected, 'NOT_AUTHORIZED',
                    'Test role binding was modified')
            if current is None:
                bindings[identity_key] = expected
        # Authenticate through the same signed short-lived JWT used by real accounts.
        # There is never a credential, password or cross-project membership on this identity.
        return password_accounts._issue(subject)
