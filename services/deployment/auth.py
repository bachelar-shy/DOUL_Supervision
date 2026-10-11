"""Pinned-key API access-token verification; token role claims are never authorities."""
from datetime import datetime, timezone
from hashlib import sha256
import os
import re

from app.reference.validation import ContractError, require
from services.runtime_config import secret, service_url

HUMANS = {'SUP', 'CON', 'OWN', 'DES', 'ADM'}


def subject_key(issuer, subject):
    return sha256((issuer + '\x00' + subject).encode()).hexdigest()


class PinnedJWT:
    def __init__(self, public_key, issuer, audience, key_id, max_lifetime=3600):
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
        key = load_pem_public_key(public_key.encode() if isinstance(public_key, str) else public_key)
        if not isinstance(key, RSAPublicKey) or key.key_size < 2048:
            raise ValueError('RSA public key of at least 2048 bits required')
        service_url(issuer)
        if not audience or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', key_id):
            raise ValueError('Explicit audience and key ID required')
        if not 60 <= max_lifetime <= 3600:
            raise ValueError('Access-token lifetime must be 60..3600 seconds')
        self.key = key
        self.issuer = issuer
        self.audience = audience
        self.key_id = key_id
        self.max_lifetime = max_lifetime

    @classmethod
    def configured(cls):
        return cls(secret('DOUL_AUTH_PUBLIC_KEY', multiline=True), os.environ['DOUL_AUTH_ISSUER'],
                   os.environ['DOUL_AUTH_AUDIENCE'], os.environ['DOUL_AUTH_KEY_ID'])

    def verify(self, token):
        import jwt
        try:
            if not isinstance(token, str) or not 1 <= len(token) <= 16384:
                raise ValueError('Token length')
            header = jwt.get_unverified_header(token)
            if (header.get('alg') != 'RS256' or header.get('kid') != self.key_id or
                header.get('typ') not in {'JWT', 'at+jwt'} or any(k in header for k in ('jku', 'x5u', 'crit'))):
                raise ValueError('Unsupported token header')
            claims = jwt.decode(token, self.key, algorithms=['RS256'], issuer=self.issuer, audience=self.audience,
                leeway=15, options={'require': ['exp', 'iat', 'nbf', 'iss', 'aud', 'sub'], 'strict_aud': True})
            if not isinstance(claims['sub'], str) or not 1 <= len(claims['sub']) <= 256:
                raise ValueError('Subject')
            if any(type(claims[k]) is not int for k in ('exp', 'iat', 'nbf')):
                raise ValueError('NumericDate types')
            if not 0 < claims['exp'] - claims['iat'] <= self.max_lifetime or not claims['iat'] <= claims['nbf'] < claims['exp']:
                raise ValueError('Token time interval')
            return claims
        except Exception:
            raise ContractError('UNAUTHENTICATED', 'Access token could not be verified')

    def session(self, token, store):
        claims = self.verify(token)
        key = subject_key(self.issuer, claims['sub'])
        with store.transaction():
            binding = store.meta.get('identityBindings', {}).get(key)
            require(binding is not None and binding.get('active') is True,
                    'UNAUTHENTICATED', 'Identity is not provisioned or is revoked')
            require(claims['iat'] >= binding.get('validAfter', 0), 'UNAUTHENTICATED', 'Identity credential was revoked')
            selected_project = claims.get('projectId')
            approved = binding
            if selected_project is not None:
                require(isinstance(selected_project, str), 'UNAUTHENTICATED', 'Invalid project session')
                approved = binding.get('projectAssignments', {}).get(selected_project)
                require(isinstance(approved, dict), 'NOT_AUTHORIZED', 'Project membership is not provisioned')
            role = store.engine.get('RoleAssignment', approved['defaultRoleAssignmentId'])
            party = store.engine.get('Party', approved['partyId'])
            require(selected_project is None or role['projectId'] == selected_project, 'UNAUTHENTICATED', 'Project membership mismatch')
            require(role['partyId'] == party['id'] and role['actorGroup'] in HUMANS and
                    party.get('loginEnabled') is True and party['kind'] == 'PERSON',
                    'UNAUTHENTICATED', 'Service/source identities cannot establish a human session')
            return dict(partyId=party['id'], roleAssignmentId=role['id'], actorGroup=role['actorGroup'], name=party['name'],
                        identityKey=key, issuedAt=claims['iat'], selectedProjectId=selected_project,
                        expires=datetime.fromtimestamp(claims['exp'], timezone.utc))
