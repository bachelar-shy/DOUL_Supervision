"""Install the in-app notification read endpoint used by the demo surface."""
from fastapi import Request

from app.reference.validation import ContractError
from .notification_events import mark_notification_read_in_transaction


def install_notification_read_route(app, store, *, identity, role_for):
    """Install POST /projects/{project_id}/parallel/notifications/{id}/read.

    Role selection, exact source authorization, and receipt persistence share a
    single write transaction so a concurrent revocation cannot race the read.
    """
    @app.post('/projects/{project_id}/parallel/notifications/{notification_id}/read')
    def mark_parallel_notification_read(project_id: str, notification_id: str, request: Request):
        session = identity(request)
        try:
            with store.transaction(write=True):
                role = role_for(session, project_id, request.headers.get('x-roleassignment-id'))
                record = store.engine.get('Notification', notification_id)
                if record.get('projectId') != project_id or record.get('recipientPartyId') != session['partyId']:
                    raise ContractError('NOT_FOUND', 'Notification unavailable')
                source = store.engine.resolve(record['sourceRef'], project_id)
                store.engine.authorize_read(source, session['partyId'], role['id'])
                return mark_notification_read_in_transaction(
                    store,
                    notification_id=notification_id,
                    recipient_party_id=session['partyId'],
                    project_id=project_id,
                    accessible_project_ids=[project_id],
                )
        except ContractError as exc:
            # Avoid revealing whether a notification or its source exists when
            # the current role has lost access.
            if exc.code in {'NOT_AUTHORIZED', 'NOT_FOUND', 'OBJECT_NOT_FOUND', 'PROJECT_MISMATCH', 'ASSIGNMENT_EXPIRED'}:
                raise ContractError('NOT_FOUND', 'Notification unavailable') from exc
            raise
        except (PermissionError, KeyError, ValueError) as exc:
            raise ContractError('NOT_FOUND', 'Notification unavailable') from exc

    return mark_parallel_notification_read
