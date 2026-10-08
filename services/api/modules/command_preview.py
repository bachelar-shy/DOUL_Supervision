"""Isolated command previews without recopying static workflow contracts.

Engine execution reads these contracts; every runtime attribute (including
records, history, evidence, documents, audit and idempotency) remains deeply
isolated. A fresh memo is used for every command, never across requests.
"""
from copy import deepcopy

_CONTRACTS = ('machines', 'machine_bindings', 'policies', 'schemas')


def clone_for_preview(engine):
    # Only the loaded contract definitions are read-only engine configuration.
    # Do not add runtime maps here: commands and guards can mutate related
    # objects as well as their target, even when a preview ultimately fails.
    memo = {id(getattr(engine, name)): getattr(engine, name) for name in _CONTRACTS}
    return deepcopy(engine, memo)
