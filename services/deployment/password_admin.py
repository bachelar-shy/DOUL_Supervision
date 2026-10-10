"""Operator-only first administrator credential; never seeds project or roles."""
import argparse
from getpass import getpass
import os
from services.runtime_config import environment, secret
from services.api.persistence import create_postgres_persistence
from .auth import PinnedJWT
from .password_auth import PasswordAccounts


def main():
    parser=argparse.ArgumentParser(description='Create the FIRST login for an already-provisioned administrator')
    parser.add_argument('--username',required=True)
    parser.add_argument('--party-id',required=True)
    parser.add_argument('--role-id',required=True)
    args=parser.parse_args()
    if environment() not in {'staging','pilot'}:
        parser.error('Requires an approved staging/pilot database')
    password=getpass('Initial password (min 12 characters): ')
    verify=getpass('Confirm initial password: ')
    if password != verify:parser.error('Passwords do not match')
    dsn=secret('DATABASE_URL')
    store=create_postgres_persistence(dsn,demo=False)
    try:
        with store.transaction():
            if store.meta.get('passwordAccounts'):
                parser.error('First-account bootstrap already performed; use administrator account management')
            role=store.engine.get('RoleAssignment',args.role_id)
            if role['partyId']!=args.party_id or role['actorGroup']!='ADM' or not role['active']:
                parser.error('Approved active administrator Party/RoleAssignment required')
            project_id=role['projectId']
        PasswordAccounts(store,PinnedJWT.configured()).create(dict(actorGroup='ADM',projectId=project_id),args.username,password,args.party_id,args.role_id)
        print('Administrator credential created. No password was printed.')
    finally:store.close()


if __name__ == '__main__':main()
