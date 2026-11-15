import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class FakeSocket:
    """Stand-in for a Starlette WebSocket; `blocked` simulates a peer that never reads."""

    def __init__(self, blocked: bool = False):
        self.sent: list[str] = []
        self.gate = asyncio.Event()
        if not blocked:
            self.gate.set()

    async def send_text(self, text: str) -> None:
        await self.gate.wait()
        self.sent.append(text)

    def events(self) -> list[dict]:
        out: list[dict] = []
        for text in self.sent:
            payload = json.loads(text)
            out.extend(payload["events"] if payload["type"] == "batch" else [payload])
        return out

    def message_ids(self) -> list[str]:
        return [e["message"]["id"] for e in self.events() if e["type"] == "message"]


class FakeConnector:
    async def join(self, channel: str) -> None:
        pass

    async def part(self, channel: str) -> None:
        pass


class RecordingHub:
    """Hub double for connector tests."""

    def __init__(self):
        self.messages = []

    async def publish_message(self, message) -> None:
        self.messages.append(message)

    async def publish_status(self, *args, **kwargs) -> None:
        pass

    async def publish_deleted(self, *args, **kwargs) -> None:
        pass

    async def publish_viewers(self, *args, **kwargs) -> None:
        pass
