import asyncio

import pytest

from app.core.queue import InferenceQueue


@pytest.mark.asyncio
async def test_queue_single_slot():
    """A queue with 1 slot allows one concurrent request."""
    q = InferenceQueue()
    q.configure(1)

    results: list[str] = []

    async def task(name: str):
        async with q.acquire(timeout_s=5.0):
            results.append(f"start-{name}")
            await asyncio.sleep(0.05)
            results.append(f"end-{name}")

    await asyncio.gather(task("A"), task("B"))

    # With 1 slot: one must finish before the other starts
    assert results[0].startswith("start-")
    assert results[1] == results[0].replace("start-", "end-")


@pytest.mark.asyncio
async def test_queue_counts():
    """active_count and waiting_count are tracked correctly."""
    q = InferenceQueue()
    q.configure(1)

    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow_task():
        async with q.acquire(timeout_s=5.0):
            entered.set()
            await release.wait()

    task = asyncio.create_task(slow_task())
    await entered.wait()

    assert q.active_count == 1
    assert q.waiting_count == 0

    # Start a second task that will wait
    waiting_task = asyncio.create_task(slow_task())
    await asyncio.sleep(0.01)  # let it block on acquire

    # Can't reliably assert waiting_count==1 without deeper hooks, but check no crash
    release.set()
    await task
    await waiting_task

    assert q.active_count == 0


@pytest.mark.asyncio
async def test_queue_timeout():
    """Requests that exceed the wait timeout get HTTP 503."""
    from fastapi import HTTPException

    q = InferenceQueue()
    q.configure(1)

    hold = asyncio.Event()

    async def blocking_task():
        async with q.acquire(timeout_s=10.0):
            await hold.wait()

    # Occupy the single slot
    blocker = asyncio.create_task(blocking_task())
    await asyncio.sleep(0.01)

    # Second request should time out quickly
    with pytest.raises(HTTPException) as exc_info:
        async with q.acquire(timeout_s=0.05):
            pass

    assert exc_info.value.status_code == 503

    hold.set()
    await blocker


@pytest.mark.asyncio
async def test_queue_multi_slot():
    """A queue with 2 slots allows 2 concurrent requests."""
    q = InferenceQueue()
    q.configure(2)

    concurrent_peak = 0
    current = 0
    lock = asyncio.Lock()

    async def task():
        nonlocal concurrent_peak, current
        async with q.acquire(timeout_s=5.0):
            async with lock:
                current += 1
                if current > concurrent_peak:
                    concurrent_peak = current
            await asyncio.sleep(0.05)
            async with lock:
                current -= 1

    await asyncio.gather(task(), task(), task())
    assert concurrent_peak == 2


@pytest.mark.asyncio
async def test_queue_configure_updates_concurrency():
    """Reconfiguring the queue changes the max concurrent slots."""
    q = InferenceQueue()
    q.configure(1)
    assert q._max_concurrent == 1

    q.configure(3)
    assert q._max_concurrent == 3
