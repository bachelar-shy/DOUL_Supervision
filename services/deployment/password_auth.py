"""Administrator-managed password credentials layered over the existing pinned JWT identity."""
import base64
from hashlib import scrypt
import hmac
import re
import secrets
import time

import jwt
from app.reference.validation import ContractError, require
from .auth import subject_key
from services.runtime_config import secret

USER_RE = re.compile(r'[a-z][a-z0-9._-]{2,63}\Z')
DUMMY_SALT = b'doul-credential-dummy-salt'


def _hash(password, salt):
    return scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1, dklen=32)


def _password_ok(password):
    return isinstance(password, str) and 12 <= len(password) <= 128 and len(password.encode('utf-8')) <= 256


class PasswordAccounts:
    def __init__(self, store, verifier):
        self.store = store
        self.verifier = verifier
        self.private_key = secret('DOUL_AUTH_PRIVATE_KEY', multiline=True)
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        key = load_pem_private_key(self.private_key.encode(), password=None)
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
        if not isinstance(key, RSAPrivateKey) or key.key_size < 2048 or key.public_key().public_numbers() != verifier.key.public_numbers():
            raise ValueError('Signing key does not match the pinned authentication key')

    def create(self, actor, username, password, party_id, role_id):
        require(actor['actorGroup'] == 'ADM', 'NOT_AUTHORIZED', 'Administrator access required')
        require(isinstance(username, str) and USER_RE.fullmatch(username) is not None and _password_ok(password), 'INVALID_REQUEST', 'Invalid account credentials')
        with self.store.transaction(write=True):
            role = self.store.engine.get('RoleAssignment', role_id)
            party = self.store.engine.get('Party', party_id)
            require(role['partyId'] == party_id and role['active'] and role['actorGroup'] in {'SUP','CON','OWN','DES','ADM'} and party.get('loginEnabled') is True and party.get('kind') == 'PERSON', 'INVALID_REQUEST', 'An enabled human identity with a valid role is required')
            require(role['projectId'] == actor['projectId'] and party['projectId'] == actor['projectId'], 'NOT_AUTHORIZED', 'Project mismatch')
            accounts = self.store.meta.setdefault('passwordAccounts', {})
            require(username not in accounts, 'OBJECT_EXISTS', 'Account already exists')
            salt = secrets.token_bytes(16)
            subject = 'local:' + username
            key = subject_key(self.verifier.issuer, subject)
            bindings = self.store.meta.setdefault('identityBindings', {})
            require(key not in bindings, 'OBJECT_EXISTS', 'Account identity already bound')
            accounts[username] = dict(salt=base64.b64encode(salt).decode(), digest=base64.b64encode(_hash(password, salt)).decode(), failed=0, blockedUntil=0, active=True, subject=subject)
            bindings[key] = dict(active=True, partyId=party_id, defaultRoleAssignmentId=role_id, validAfter=0)
        return dict(username=username, partyId=party_id, roleAssignmentId=role_id)

    def login(self, username, password):
        if not isinstance(username, str) or len(username) > 64 or not isinstance(password, str) or len(password) > 256:
            raise ContractError('UNAUTHENTICATED', 'Invalid username or password')
        now = int(time.time())
        with self.store.transaction(write=True):
            accounts = self.store.meta.setdefault('passwordAccounts', {})
            account = accounts.get(username)
            if account is None:
                _hash('invalid-password', DUMMY_SALT)
                raise ContractError('UNAUTHENTICATED', 'Invalid username or password')
            if account.get('blockedUntil', 0) > now or not account.get('active', False):
                raise ContractError('UNAUTHENTICATED', 'Invalid username or password')
            correct = hmac.compare_digest(_hash(password, base64.b64decode(account['salt'])), base64.b64decode(account['digest']))
            if not correct:
                failures = account.get('failed', 0) + 1
                account['failed'] = failures
                if failures >= 5:
                    account['blockedUntil'] = now + 900
                    account['failed'] = 0
                # The persistence transaction must commit failed-attempt counters.
                result = None
            else:
                account['failed'] = 0
                account['blockedUntil'] = 0
                result = account['subject']
        if result is None:
            raise ContractError('UNAUTHENTICATED', 'Invalid username or password')
        return self._issue(result)

    def _issue(self, subject, project_id=None):
        now = int(time.time())
        claims = dict(iss=self.verifier.issuer, aud=self.verifier.audience, sub=subject, iat=now, nbf=now, exp=now+900, jti=secrets.token_urlsafe(20))
        if project_id is not None: claims['projectId'] = project_id
        token = jwt.encode(claims, self.private_key, algorithm='RS256', headers=dict(kid=self.verifier.key_id, typ='at+jwt'))
        session = self.verifier.session(token, self.store)
        return dict(accessToken=token, projectId=self.store.engine.get('RoleAssignment',session['roleAssignmentId'])['projectId'], actor=dict(partyId=session['partyId'], roleAssignmentId=session['roleAssignmentId'], actorGroup=session['actorGroup'], name=session['name']), mode='PASSWORD')

    def select_project(self, token, project_id):
        claims = self.verifier.verify(token)
        result = self._issue(claims['sub'], project_id)
        self.revoke(token)
        return result

    def revoke(self, token):
        claims = self.verifier.verify(token)
        require(isinstance(claims.get('jti'), str) and bool(claims['jti']), 'UNAUTHENTICATED', 'Session token cannot be revoked')
        with self.store.transaction(write=True):
            revoked = self.store.meta.setdefault('revokedAccessTokens', {})
            now = int(time.time())
            for key, expiry in list(revoked.items()):
                if expiry <= now: del revoked[key]
            revoked[claims['jti']] = claims['exp']

    def is_revoked(self, token):
        claims = self.verifier.verify(token)
        with self.store.transaction():
            return claims.get('jti') in self.store.meta.get('revokedAccessTokens', {})
