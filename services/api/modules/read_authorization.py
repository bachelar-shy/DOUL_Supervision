"""Request-scoped read-only authorization view with immutable config lookups.

The view delegates authorization decisions to the reference Engine methods.
Only configuration records repeatedly fetched by those methods are memoized;
record scope, authorization policy checks, and the engine clock remain live for
every call. Create a new view inside each read transaction.
"""
from __future__ import annotations

from typing import Any

from app.reference.engine import Engine
from app.reference.read_views import readonly


_CACHE_KINDS = frozenset({"RoleAssignment", "Project", "Qualification"})


def _freeze(value: Any) -> Any:
    """Copy a configuration value into recursively immutable containers."""
    # Engine.get already deep-copies. Its standard lazy readonly wrapper blocks
    # writes while retaining list/dict equality and indexing semantics.
    return readonly(value)


class ReadAuthorizationView:
    """Use Engine authorization logic while caching immutable config reads."""

    def __init__(self, engine):
        self._engine = engine
        self._configuration = {}

    def __getattr__(self, name):
        return getattr(self._engine, name)

    def get(self, kind, object_id, version=None):
        if kind not in _CACHE_KINDS:
            return self._engine.get(kind, object_id, version)
        key = (kind, object_id, version)
        if key not in self._configuration:
            self._configuration[key] = _freeze(
                self._engine.get(kind, object_id, version)
            )
        return self._configuration[key]

    def authorize(self, record, authority, party_id, role_id, *, qualification=None):
        return Engine.authorize(
            self, record, authority, party_id, role_id, qualification=qualification
        )

    def authorize_read(self, record, party_id, role_id):
        return Engine.authorize_read(self, record, party_id, role_id)

    def _qualified(self, record, role):
        return Engine._qualified(self, record, role)

    def _scope(self, values, target, location=False):
        return Engine._scope(self, values, target, location)

    def resolve(self, reference, project_id=None):
        return Engine.resolve(self, reference, project_id)
