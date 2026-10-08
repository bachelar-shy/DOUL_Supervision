"""Borrowed, lazy read-only views for query guards; no recursive record copy."""
from collections.abc import Mapping, Sequence
from copy import deepcopy


def readonly(value):
    if isinstance(value, Mapping):
        return RecordView(value)
    if isinstance(value, list):
        return ListView(value)
    return value


class RecordView(Mapping):
    def __init__(self, source):
        self._source = source

    def __getitem__(self, key):
        return readonly(self._source[key])

    def __iter__(self):
        return iter(self._source)

    def __len__(self):
        return len(self._source)

    def __deepcopy__(self, memo):
        return deepcopy(dict(self._source), memo)


class ListView(Sequence):
    def __init__(self, source):
        self._source = source

    def __getitem__(self, index):
        if isinstance(index, slice):
            return ListView(self._source[index])
        return readonly(self._source[index])

    def __len__(self):
        return len(self._source)

    def __eq__(self, other):
        return isinstance(other, (list, ListView)) and len(self) == len(other) and all(a == b for a, b in zip(self, other))

    def __deepcopy__(self, memo):
        return deepcopy(self._source, memo)
