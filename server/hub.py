"""Shared-connection hub.

The server keeps ONE upstream connection per unique (platform, channel) —
not per viewer. Ten viewers watching the same streamer share a single
upstream, and the hub fans every event out to all of them. Load grows with
the number of unique channels, not the number of users.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Callable, Protocol

from .emotes import fetch_channel_emotes
from .models import Message

logger = logging.getLogger(__name__)

RECENT_LIMIT = 200  # matches the browser's visible window, so a reconnect leaves no gap
LINGER_SECONDS = 30
MAX_OUTBOX = 1000  # events a viewer may fall behind before it is dropped
SEND_TIMEOUT_SECONDS = 10


def encode(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"))


class Connector(Protocol):
    async def join(self, channel: str, /) -> None: ...
    async def part(self, channel: str, /) -> None: ...


class Viewer:
    """One frontend WebSocket client and the channel keys it subscribes to.

    Nothing that publishes ever waits on this client's socket: events go into
    an outbox and a single writer task drains it. Whatever piled up while the
    previous frame was in flight leaves as one batch frame, so a slow client
    gets fewer, larger frames instead of holding anyone up. A client that
    falls MAX_OUTBOX events behind, or whose socket accepts nothing for
    SEND_TIMEOUT_SECONDS, is disconnected; on reconnect the bootstrap brings
    it back in sync.
    """

    __slots__ = ("websocket", "keys", "closed", "_on_close", "_outbox", "_wake", "_writer")

    def __init__(self, websocket, on_close: Callable[[], None] | None = None):
        self.websocket = websocket
        # Called once when the hub gives up on this client; must tear the
        # connection down without waiting on the socket.
        self._on_close = on_close
        self.keys: set[tuple[str, str]] = set()
        self.closed = False
        self._outbox: deque[str] = deque()
        self._wake = asyncio.Event()
        self._writer: asyncio.Task | None = None

    def send(self, payload: dict) -> None:
        self.push(encode(payload))

    def push(self, text: str) -> None:
        """Queue one encoded event. Never blocks, never raises."""
        if self.closed:
            return
        if len(self._outbox) >= MAX_OUTBOX:
            logger.warning("viewer fell %d events behind, dropping it", MAX_OUTBOX)
            self.close()
            return
        self._outbox.append(text)
        self._wake.set()
        if self._writer is None:
            self._writer = asyncio.create_task(self._drain())

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self._outbox.clear()
        if self._writer is not None and self._writer is not asyncio.current_task():
            self._writer.cancel()
        if self._on_close is not None:
            self._on_close()

    async def _drain(self) -> None:
        outbox, wake = self._outbox, self._wake
        try:
            while True:
                if not outbox:
                    wake.clear()
                    await wake.wait()
                if len(outbox) == 1:
                    frame = outbox.popleft()
                else:
                    frame = '{"type":"batch","events":[' + ",".join(outbox) + "]}"
                    outbox.clear()
                async with asyncio.timeout(SEND_TIMEOUT_SECONDS):
                    await self.websocket.send_text(frame)
        except asyncio.CancelledError:
            raise
        except Exception:  # socket gone or stuck
            self.close()


class ChannelHandle:
    """Hub-side state for one unique (platform, channel)."""

    def __init__(self, key: tuple[str, str]):
        self.key = key
        self.viewers: set[Viewer] = set()
        self.recent: deque[Message] = deque(maxlen=RECENT_LIMIT)
        self.recent_ids: set[str] = set()
        self.status = {
            "platform": key[0],
            "channel": key[1],
            "dot": "warn",
            "state": "connecting",
            "detail": "Starting…",
        }
        self.linger_task: asyncio.Task | None = None
        self.emotes: dict[str, str] | None = None
        self.emotes_task: asyncio.Task | None = None
        self.hype_train: dict | None = None


class Hub:
    def __init__(self):
        self.channels: dict[tuple[str, str], ChannelHandle] = {}
        self.connectors: dict[str, Connector] = {}

    def register_connector(self, platform: str, connector: Connector) -> None:
        self.connectors[platform] = connector

    async def subscribe(self, viewer: Viewer, platform: str, channel: str) -> None:
        key = (platform, channel)
        handle = self.channels.get(key)
        created = False
        if handle is None:
            created = True
            handle = ChannelHandle(key)
            self.channels[key] = handle
        if handle.linger_task is not None:
            handle.linger_task.cancel()
            handle.linger_task = None
        handle.viewers.add(viewer)
        viewer.keys.add(key)
        if created:
            await self.connectors[platform].join(channel)
        if platform == "twitch":
            if handle.emotes is not None:
                viewer.send(_emotes_payload(handle))
            elif handle.emotes_task is None:
                handle.emotes_task = asyncio.create_task(self._load_emotes(handle))
        if platform == "twitch" and handle.hype_train:
            viewer.send({"type": "hype_train", "channel": channel, **handle.hype_train})

    async def unsubscribe(self, viewer: Viewer, key: tuple[str, str]) -> None:
        viewer.keys.discard(key)
        handle = self.channels.get(key)
        if handle is None:
            return
        handle.viewers.discard(viewer)
        if not handle.viewers and handle.linger_task is None:
            handle.linger_task = asyncio.create_task(self._linger(handle))

    async def drop_viewer(self, viewer: Viewer) -> None:
        for key in list(viewer.keys):
            await self.unsubscribe(viewer, key)

    async def _linger(self, handle: ChannelHandle) -> None:
        try:
            await asyncio.sleep(LINGER_SECONDS)
        except asyncio.CancelledError:
            return
        if handle.viewers:
            handle.linger_task = None
            return
        platform, channel = handle.key
        self.channels.pop(handle.key, None)
        if handle.emotes_task is not None:
            handle.emotes_task.cancel()
        await self.connectors[platform].part(channel)

    async def _load_emotes(self, handle: ChannelHandle) -> None:
        try:
            handle.emotes = await fetch_channel_emotes(handle.key[1])
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("third-party emotes failed for %s: %s", handle.key[1], exc)
            handle.emotes = {}
        self._broadcast(handle, _emotes_payload(handle))

    async def publish_message(self, message: Message) -> None:
        handle = self.channels.get((message.platform, message.channel))
        if handle is None:
            return
        # Upstream reconnects can double-deliver; ids never legitimately repeat.
        if message.id in handle.recent_ids:
            return
        if len(handle.recent) == RECENT_LIMIT:
            handle.recent_ids.discard(handle.recent[0].id)
        handle.recent.append(message)
        handle.recent_ids.add(message.id)
        self._fan_out(handle, '{"type":"message","message":' + message.to_json() + "}")

    async def publish_deleted(
        self,
        platform: str,
        channel: str,
        *,
        message_id: str | None = None,
        author_login: str | None = None,
    ) -> None:
        handle = self.channels.get((platform, channel))
        if handle is None:
            return
        ids = []
        for message in handle.recent:
            if message.deleted:
                continue
            if message_id is not None and message.id != message_id:
                continue
            if author_login is not None and message.author_login != author_login:
                continue
            message.mark_deleted()
            ids.append(message.id)
        if ids:
            self._broadcast(handle, {"type": "deleted", "ids": ids})

    async def publish_hype_train(self, channel: str, payload: dict) -> None:
        handle = self.channels.get(("twitch", channel))
        if handle is None:
            return
        handle.hype_train = None if payload.get("phase") == "end" else payload
        self._broadcast(handle, {"type": "hype_train", "channel": channel, **payload})

    async def publish_status(
        self,
        platform: str,
        channel: str,
        dot: str,
        state: str,
        detail: str = "",
        video_id: str | None = None,
    ) -> None:
        handle = self.channels.get((platform, channel))
        if handle is None:
            return
        handle.status = {
            "platform": platform,
            "channel": channel,
            "dot": dot,
            "state": state,
            "detail": detail,
            "viewers": handle.status.get("viewers") if state == "connected" else None,
        }
        # Only on connected statuses, so a stale id never survives a stream ending.
        if video_id:
            handle.status["video_id"] = video_id
        self._broadcast(handle, {"type": "status", "status": handle.status})

    async def publish_viewers(self, platform: str, channel: str, count: int | None) -> None:
        handle = self.channels.get((platform, channel))
        if handle is None or handle.status.get("viewers") == count:
            return
        handle.status = {**handle.status, "viewers": count}
        self._broadcast(handle, {"type": "status", "status": handle.status})

    def _broadcast(self, handle: ChannelHandle, payload: dict) -> None:
        try:
            text = encode(payload)
        except (TypeError, ValueError) as exc:
            logger.warning("unserializable broadcast payload: %s", exc)
            return
        self._fan_out(handle, text)

    def _fan_out(self, handle: ChannelHandle, text: str) -> None:
        # Encoded once, queued per viewer; a viewer dropped mid-loop is only
        # flagged here and leaves handle.viewers when its socket handler exits.
        for viewer in handle.viewers:
            viewer.push(text)

    def bootstrap_text(self, viewer: Viewer) -> str:
        messages: list[Message] = []
        statuses: list[dict] = []
        for key in viewer.keys:
            handle = self.channels.get(key)
            if handle is None:
                continue
            messages.extend(handle.recent)
            statuses.append(handle.status)
        messages.sort(key=lambda message: message.timestamp)
        return (
            '{"type":"bootstrap","messages":['
            + ",".join(message.to_json() for message in messages)
            + '],"statuses":' + encode(statuses) + "}"
        )


def _emotes_payload(handle: ChannelHandle) -> dict:
    return {
        "type": "emotes",
        "platform": handle.key[0],
        "channel": handle.key[1],
        "emotes": handle.emotes or {},
    }
