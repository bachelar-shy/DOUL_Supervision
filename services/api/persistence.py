"""Application-facing persistence boundary for the local HTTP adapter.

The application depends on this port rather than on SQLite details. The current
implementation remains the SQLite snapshot adapter; a later PostgreSQL adapter
can satisfy the same boundary without changing Product/Functional contracts.
"""
from contextlib import AbstractContextManager
from typing import Any, MutableMapping, Protocol, runtime_checkable

from app.reference.documents import Documents
from app.reference.engine import Engine


@runtime_checkable
class PersistencePort(Protocol):
    """Minimal persistence/runtime surface required by main.create_app."""

    adapter_name: str
    engine: Engine
    documents: Documents
    meta: MutableMapping[str, Any]
    uploads: MutableMapping[str, Any]
    requests: MutableMapping[str, Any]
    conflicts: list

    def transaction(self, write: bool = False) -> AbstractContextManager:
        ...

    def put_blob(self, file_id: str, content: bytes) -> None:
        ...

    def blob(self, file_id: str) -> bytes:
        ...

    def close(self) -> None:
        ...


def create_local_persistence(path=':memory:', demo=True):
    """Create the current local-development persistence adapter lazily."""
    from .store import SQLiteSnapshotAdapter

    return SQLiteSnapshotAdapter(path, demo=demo)
