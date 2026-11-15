from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .connectors.twitch import TwitchChat
from .connectors.youtube import YouTubeChat
from .hub import Hub, Viewer
from .stats import Stats

logging.basicConfig(level=logging.WARNING)

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
SUPPORTED_PLATFORMS = ("twitch", "youtube")

# Names go straight into IRC commands and URLs, so reject anything outside
# each platform's own username charset.
CHANNEL_PATTERNS = {
    "twitch": re.compile(r"^[a-z0-9_]{1,25}$"),
    "youtube": re.compile(r"^@?[a-z0-9._-]{1,50}$"),
}

# Site-wide announcement banner; in-memory on purpose — a restart clears it.
ANNOUNCE_TOKEN = os.getenv("ANNOUNCE_TOKEN", "")
ANNOUNCE_MAX_CHARS = 300
announcement = {"text": ""}
viewers: set[Viewer] = set()

TRANSPORT_KEY = "unified_chat.transport"


class TransportTap:
    """Remembers each WebSocket's TCP transport so a stuck client can be cut off.

    A graceful close queues its frame behind the bytes the client is not
    reading and never completes, and ASGI offers no hard disconnect. As the
    outermost middleware this still sees uvicorn's own `send`, whose owner
    holds the transport. Any other server simply leaves the key unset.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            scope[TRANSPORT_KEY] = getattr(getattr(send, "__self__", None), "transport", None)
        await self.app(scope, receive, send)


app = FastAPI(title="Unified Chat Lite")
app.add_middleware(TransportTap)
stats = Stats()
hub = Hub()
hub.register_connector("twitch", TwitchChat(hub))
hub.register_connector("youtube", YouTubeChat(hub))


PING_INTERVAL_SECONDS = 10
PING_FRAME = '{"type":"ping"}'
background_tasks: set[asyncio.Task] = set()


async def ping_viewers() -> None:
    """Application-level heartbeat: page scripts cannot see protocol pings, so
    this is what lets a browser notice a silently dead connection."""
    while True:
        await asyncio.sleep(PING_INTERVAL_SECONDS)
        for viewer in list(viewers):
            viewer.push(PING_FRAME)


@app.on_event("startup")
async def start_background_tasks() -> None:
    for job in (stats.autosave(), ping_viewers()):
        task = asyncio.create_task(job)
        background_tasks.add(task)
        task.add_done_callback(background_tasks.discard)


@app.on_event("shutdown")
async def save_stats() -> None:
    stats.save()


@app.websocket("/ws")
async def viewer_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    transport = websocket.scope.get(TRANSPORT_KEY)
    handler = asyncio.current_task()
    # Without a transport to abort, cancelling this handler is the next best thing.
    viewer = Viewer(websocket, on_close=transport.abort if transport is not None else handler.cancel)
    stats.connection_opened()
    viewers.add(viewer)
    if announcement["text"]:
        viewer.send({"type": "announce", "text": announcement["text"]})
    try:
        while not viewer.closed:
            payload = await websocket.receive_json()
            if isinstance(payload, dict) and payload.get("type") == "subscribe":
                await handle_subscribe(viewer, payload.get("channels") or {})
    except (WebSocketDisconnect, asyncio.CancelledError, ValueError, KeyError, RuntimeError):
        pass  # peer gone, or sent something that is not our protocol
    finally:
        viewers.discard(viewer)
        stats.connection_closed()
        await hub.drop_viewer(viewer)
        viewer.close()


async def handle_subscribe(viewer: Viewer, channels: dict) -> None:
    desired = set()
    for platform in SUPPORTED_PLATFORMS:
        channel = channels.get(platform)
        if not isinstance(channel, str):
            continue
        channel = channel.strip().lstrip("#").lower()
        if channel and CHANNEL_PATTERNS[platform].match(channel):
            desired.add((platform, channel))

    for key in viewer.keys - desired:
        await hub.unsubscribe(viewer, key)
    for platform, channel in desired - viewer.keys:
        await hub.subscribe(viewer, platform, channel)

    viewer.push(hub.bootstrap_text(viewer))


@app.get("/announcement")
async def get_announcement() -> dict:
    return {"text": announcement["text"]}


@app.post("/announce")
async def announce(request: Request) -> dict:
    if not ANNOUNCE_TOKEN:
        raise HTTPException(status_code=404)
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400)
    token = str(data.get("token") or "")
    if not secrets.compare_digest(token, ANNOUNCE_TOKEN):
        raise HTTPException(status_code=403)
    text = str(data.get("text") or "").strip()[:ANNOUNCE_MAX_CHARS]
    announcement["text"] = text
    for viewer in list(viewers):
        viewer.send({"type": "announce", "text": text})
    return {"ok": True, "viewers": len(viewers)}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/stats")
async def stats_endpoint() -> dict:
    return stats.snapshot(len(hub.channels))


@app.get("/popout")
@app.get("/overlay")
async def popout_page() -> FileResponse:
    return FileResponse(WEB_DIR / "popout.html")


@app.get("/popout.html")
async def popout_legacy(request: Request) -> RedirectResponse:
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(f"/popout{query}", status_code=301)


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")