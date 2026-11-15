"""End to end: a browser that stops reading must not stall anyone else."""
import asyncio
import base64
import json
import os
import socket

import uvicorn
import websockets

from conftest import FakeConnector
from server import main
from server.models import Message

PLATFORM = "youtube"
TOTAL = 4000
SUBSCRIBE = json.dumps({"type": "subscribe", "channels": {PLATFORM: "stalltest"}})


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_stalled_socket(port: int) -> socket.socket:
    """Raw WebSocket client that subscribes and then never reads again."""
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    sock.connect(("127.0.0.1", port))
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((
        f"GET /ws HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    sock.recv(1024)
    payload, mask = SUBSCRIBE.encode(), os.urandom(4)
    sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask
                 + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
    return sock


def drain_until_closed(sock: socket.socket) -> bool:
    sock.settimeout(5)
    try:
        while sock.recv(65536):
            pass
        return True
    except ConnectionError:
        return True
    except TimeoutError:
        return False


def test_stalled_viewer_is_dropped_and_others_keep_receiving():
    async def run():
        main.hub.connectors[PLATFORM] = FakeConnector()
        port = free_port()
        server = uvicorn.Server(uvicorn.Config(
            main.app, host="127.0.0.1", port=port, log_level="error", access_log=False))
        serving = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.01)

        received: set[str] = set()

        async def healthy():
            async with websockets.connect(f"ws://127.0.0.1:{port}/ws", max_size=None) as ws:
                await ws.send(SUBSCRIBE)
                async for raw in ws:
                    payload = json.loads(raw)
                    for event in payload["events"] if payload["type"] == "batch" else [payload]:
                        if event["type"] == "message":
                            received.add(event["message"]["id"])

        reader = asyncio.create_task(healthy())
        stalled = await asyncio.to_thread(open_stalled_socket, port)
        while len(main.viewers) < 2 or ("youtube", "stalltest") not in main.hub.channels:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.1)

        async def publish_all():
            for i in range(TOTAL):
                await main.hub.publish_message(Message(
                    platform=PLATFORM, id=f"s{i}", channel="stalltest", author="a",
                    text="x" * 2000, timestamp=i))
                if i % 20 == 0:
                    await asyncio.sleep(0.002)

        try:
            # The upstream side must never wait on a socket.
            await asyncio.wait_for(publish_all(), timeout=20)
            deadline = asyncio.get_running_loop().time() + 20
            while (len(received) < TOTAL or len(main.viewers) != 1) and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.05)
            assert len(received) == TOTAL, f"healthy viewer got {len(received)} of {TOTAL}"
            assert len(main.viewers) == 1, f"stalled viewer still registered: {[(v.closed, len(v._outbox)) for v in main.viewers]}"
            assert await asyncio.to_thread(drain_until_closed, stalled), "server kept the stalled socket open"
        finally:
            stalled.close()
            reader.cancel()
            server.should_exit = True
            await serving
    asyncio.run(run())
