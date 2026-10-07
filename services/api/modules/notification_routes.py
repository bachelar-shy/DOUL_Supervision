"""Install the optional demo in-app notification read endpoint."""
from fastapi import Request

from app.reference.validation import ContractError
from .notification_events import mark_notification_read


def install_notification_read_route(app, store, *, identity, role_for):
    """Install POST /projects/{project_id}/parallel/notifications/{id}/read.

    `identity` and `role_for` are the host application's authenticated adapters.
    The route records only a UI read receipt and leaves Notification.status intact.
    """
    @app.post('/projects/{project_id}/parallel/notifications/{notification_id}/read')
    def mark_parallel_notification_read(project_id: str, notification_id: str, request: Request):
        session = identity(request)
        role_for(session, project_id, request.headers.get('x-roleassignment-id'))
        try:
            return mark_notification_read(
                store,
                notification_id=notification_id,
                recipient_party_id=session['partyId'],
                project_id=project_id,
                accessible_project_ids=[project_id],
            )
        except PermissionError as exc:
            raise ContractError('NOT_AUTHORIZED', str(exc)) from exc
        except (ValueError, KeyError) as exc:
            raise ContractError('NOT_FOUND', 'Notification unavailable') from exc

    return mark_parallel_notification_read
