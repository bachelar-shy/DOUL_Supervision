"""Isolated command previews without recopying static workflow contracts.

The default preview remains a deep clone. Work-inbox preflight may opt into a
lazy runtime overlay: existing runtime values are recursively immutable
borrowed reads, while all writes land in clone-local overrides. A fresh overlay
is created for every command and must not outlive its source read transaction.
"""
from collections.abc import Mapping, MutableMapping, Sequence
from copy import deepcopy

_CONTRACTS = ('machines', 'machine_bindings', 'policies', 'schemas')
_RUNTIME_MAPS = frozenset({
    '_records', '_history', '_idempotency', '_record_machines',
    '_notifications', 'documents',
})


class _BorrowedMapping(Mapping):
    """Recursively immutable view of a runtime value owned by the source."""

    def __init__(self, source):
        self._source = source

    def __getitem__(self, key):
        return _borrow(self._source[key])

    def __iter__(self):
        return iter(self._source)

    def __len__(self):
        return len(self._source)

    def __deepcopy__(self, memo):
        value = {key: deepcopy(self[key], memo) for key in self}
        memo[id(self)] = value
        return value


class _BorrowedSequence(Sequence):
    """Immutable list/tuple view with mutable-copy deepcopy semantics."""

    def __init__(self, source):
        self._source = source

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [_borrow(value) for value in self._source[index]]
        return _borrow(self._source[index])

    def __len__(self):
        return len(self._source)

    def __eq__(self, other):
        if not isinstance(other, Sequence) or isinstance(other, (str, bytes)):
            return False
        return len(self) == len(other) and all(a == b for a, b in zip(self, other))

    def __deepcopy__(self, memo):
        value = [deepcopy(item, memo) for item in self]
        memo[id(self)] = value
        return value


def _borrow(value):
    if isinstance(value, Mapping):
        return _BorrowedMapping(value)
    if isinstance(value, (list, tuple)):
        return _BorrowedSequence(value)
    if isinstance(value, (set, frozenset)):
        return frozenset(_borrow(item) for item in value)
    return value


class _OverlayMap(MutableMapping):
    """Map overlay whose untouched base values cannot be mutated."""

    def __init__(self, base):
        self._base = base
        self._writes = {}
        self._deleted = set()

    def __getitem__(self, key):
        if key in self._writes:
            return self._writes[key]
        if key in self._deleted or key not in self._base:
            raise KeyError(key)
        return _borrow(self._base[key])

    def __setitem__(self, key, value):
        self._writes[key] = deepcopy(value)
        self._deleted.discard(key)

    def __delitem__(self, key):
        if key in self._writes:
            del self._writes[key]
            if key in self._base:
                self._deleted.add(key)
            return
        if key in self._deleted or key not in self._base:
            raise KeyError(key)
        self._deleted.add(key)

    def __iter__(self):
        for key in self._base:
            if key not in self._deleted:
                yield key
        for key in self._writes:
            if key not in self._base:
                yield key

    def __len__(self):
        added = sum(1 for key in self._writes if key not in self._base)
        removed = sum(1 for key in self._deleted if key in self._base)
        return len(self._base) + added - removed

    def __deepcopy__(self, memo):
        materialized = {
            deepcopy(key, memo): deepcopy(self[key], memo)
            for key in self
        }
        memo[id(self)] = materialized
        return materialized


class _OverlayAudit:
    """Append-only transaction audit view with immutable borrowed history."""

    def __init__(self, base):
        self._base = base
        self._appended = []

    def __len__(self):
        return len(self._base) + len(self._appended)

    def __iter__(self):
        for item in self._base:
            yield _borrow(item)
        yield from self._appended

    def __getitem__(self, index):
        if isinstance(index, slice):
            return list(self)[index]
        base_length = len(self._base)
        if index < 0:
            index += len(self)
        if index < 0 or index >= len(self):
            raise IndexError(index)
        if index < base_length:
            return _borrow(self._base[index])
        return self._appended[index - base_length]

    def append(self, value):
        self._appended.append(deepcopy(value))

    def __deepcopy__(self, memo):
        materialized = [deepcopy(item, memo) for item in self]
        memo[id(self)] = materialized
        return materialized


def clone_for_preview(engine, *, borrow_runtime=False):
    # Only the loaded contract definitions are read-only engine configuration.
    memo = {id(getattr(engine, name)): getattr(engine, name) for name in _CONTRACTS}
    if not borrow_runtime:
        return deepcopy(engine, memo)

    # Engine command paths read existing runtime values through get() (which
    # returns deep copies) or inspect them without mutation. `_save`, audit,
    # idempotency, and machine writes replace/append at the top level and are
    # isolated by these overlays. Any nested write to an untouched base value
    # raises instead of leaking into the live engine.
    clone = type(engine).__new__(type(engine))
    for name, value in vars(engine).items():
        if name in _CONTRACTS:
            setattr(clone, name, value)
        elif name in _RUNTIME_MAPS:
            setattr(clone, name, _OverlayMap(value))
        elif name == '_audit':
            setattr(clone, name, _OverlayAudit(value))
        elif name == '_escalation_keys':
            setattr(clone, name, set(value))
        else:
            # Keep safety for newly introduced runtime attributes by default.
            setattr(clone, name, deepcopy(value, memo))
    return clone
