"""Reclaim abandoned PDF-to-sheet jobs without losing committed pages.

Processing sets themselves are the durable work ledger. An API restart or lost
BackgroundTasks invocation is repaired by the poller, whose DB lease is claimed
by the renderer. All shared store mutations remain transactional.
"""
from __future__ import annotations

import asyncio
import logging
import time

from .drawing_sheets import _render_set

LOG = logging.getLogger(__name__)
POLL_SECONDS = 30
CLAIM_TIMEOUT_SECONDS = 120


def recoverable_sets(store):
    with store.transaction():
        now = time.time()
        return [(project_id, row["id"])
                for project_id, sets in store.meta.get("drawingSets", {}).items()
                for row in sets.values()
                if row.get("status") == "processing"
                and (not row.get("renderOwner") or
                     now - row.get("renderHeartbeat", 0) >= CLAIM_TIMEOUT_SECONDS)]


def install_drawing_recovery(app, store):
    active: dict[tuple[str, str], asyncio.Task] = {}

    async def poll():
        try:
            while True:
                try:
                    for project_id, set_id in recoverable_sets(store):
                        key = (project_id, set_id)
                        if key in active and not active[key].done():
                            continue

                        async def render(p=project_id, s=set_id):
                            await asyncio.to_thread(_render_set, store, p, s)

                        task = asyncio.create_task(render())
                        active[key] = task
                        task.add_done_callback(lambda _task, k=key: active.pop(k, None))
                except Exception:
                    LOG.exception("Drawing conversion recovery scan failed")
                await asyncio.sleep(POLL_SECONDS)
        except asyncio.CancelledError:
            raise

    @app.on_event("startup")
    async def start_drawing_recovery():
        app.state.drawing_recovery_poll = asyncio.create_task(poll())

    @app.on_event("shutdown")
    async def stop_drawing_recovery():
        task = getattr(app.state, "drawing_recovery_poll", None)
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
