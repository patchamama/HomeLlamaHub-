import asyncio
from contextlib import asynccontextmanager

from fastapi import HTTPException, status


class InferenceQueue:
    """Global semaphore-based queue for serializing inference requests."""

    def __init__(self) -> None:
        self._sem: asyncio.Semaphore | None = None
        self._max_concurrent: int = 1
        self.active_count: int = 0
        self.waiting_count: int = 0

    def configure(self, max_concurrent: int) -> None:
        """Initialize or reconfigure the semaphore.

        Can be called at startup and whenever settings change.
        If the semaphore already exists it is replaced; in-flight requests
        holding the old semaphore will complete normally.
        """
        self._max_concurrent = max_concurrent
        self._sem = asyncio.Semaphore(max_concurrent)

    @asynccontextmanager
    async def acquire(self, timeout_s: float):
        """Acquire a queue slot.

        Raises HTTPException 503 if the slot cannot be obtained within timeout_s.
        Yields control once the slot is acquired; releases on exit.
        """
        if self._sem is None:
            self.configure(self._max_concurrent)

        self.waiting_count += 1
        acquired = False
        try:
            try:
                await asyncio.wait_for(self._sem.acquire(), timeout=timeout_s)  # type: ignore[union-attr]
                acquired = True
            except TimeoutError as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Queue timeout: all inference slots are busy. Try again later.",
                ) from exc
        finally:
            self.waiting_count -= 1

        self.active_count += 1
        try:
            yield
        finally:
            self.active_count -= 1
            if acquired:
                self._sem.release()  # type: ignore[union-attr]


# Module-level singleton
inference_queue = InferenceQueue()
