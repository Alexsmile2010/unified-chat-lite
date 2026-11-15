import asyncio
import json

from conftest import FakeConnector, FakeSocket
from server import hub as hub_module
from server.hub import Hub, Viewer
from server.models import Message

# "youtube" keeps the hub from starting the Twitch emote fetch.
PLATFORM = "youtube"


def make_hub() -> Hub:
    hub = Hub()
    hub.register_connector(PLATFORM, FakeConnector())
    return hub


def msg(i: int, channel: str = "chan", ts: int | None = None) -> Message:
    return Message(platform=PLATFORM, id=f"m{i}", channel=channel, author="a", text=f"t{i}",
                   timestamp=i if ts is None else ts, author_login="a")


async def settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0)


def test_blocked_viewer_does_not_delay_others():
    async def run():
        hub = make_hub()
        healthy, stuck = FakeSocket(), FakeSocket(blocked=True)
        await hub.subscribe(Viewer(healthy), PLATFORM, "chan")
        await hub.subscribe(Viewer(stuck), PLATFORM, "chan")
        for i in range(50):
            await asyncio.wait_for(hub.publish_message(msg(i)), timeout=1)
        await settle()
        assert healthy.message_ids() == [f"m{i}" for i in range(50)]
        assert stuck.sent == []
    asyncio.run(run())


def test_events_keep_order_and_batch():
    async def run():
        hub = make_hub()
        sock = FakeSocket(blocked=True)
        await hub.subscribe(Viewer(sock), PLATFORM, "chan")
        for i in range(30):
            await hub.publish_message(msg(i))
        await settle()
        sock.gate.set()
        await settle()
        assert sock.message_ids() == [f"m{i}" for i in range(30)]
        assert any(json.loads(text)["type"] == "batch" for text in sock.sent)
        assert len(sock.sent) < 30
    asyncio.run(run())


def test_overflow_closes_viewer():
    async def run():
        hub = make_hub()
        viewer = Viewer(FakeSocket(blocked=True))
        await hub.subscribe(viewer, PLATFORM, "chan")
        for i in range(hub_module.MAX_OUTBOX + 10):
            await hub.publish_message(msg(i))
        assert viewer.closed
    asyncio.run(run())


def test_send_timeout_closes_viewer(monkeypatch):
    monkeypatch.setattr(hub_module, "SEND_TIMEOUT_SECONDS", 0.05)

    async def run():
        hub = make_hub()
        viewer = Viewer(FakeSocket(blocked=True))
        await hub.subscribe(viewer, PLATFORM, "chan")
        await hub.publish_message(msg(1))
        await asyncio.sleep(0.2)
        assert viewer.closed
    asyncio.run(run())


def test_closed_viewer_ignores_further_pushes():
    async def run():
        sock = FakeSocket()
        viewer = Viewer(sock)
        viewer.close()
        viewer.send({"type": "ping"})
        await settle()
        assert sock.sent == []
    asyncio.run(run())


def test_duplicate_ids_dropped_until_evicted():
    async def run():
        hub = make_hub()
        sock = FakeSocket()
        await hub.subscribe(Viewer(sock), PLATFORM, "chan")
        await hub.publish_message(msg(0))
        await hub.publish_message(msg(0))
        await settle()
        assert sock.message_ids() == ["m0"]
        for i in range(1, hub_module.RECENT_LIMIT + 1):
            await hub.publish_message(msg(i))
        await hub.publish_message(msg(0))  # evicted from the window, so new again
        await settle()
        assert sock.message_ids().count("m0") == 2
    asyncio.run(run())


def test_bootstrap_holds_last_200_sorted():
    async def run():
        hub = make_hub()
        viewer = Viewer(FakeSocket())
        await hub.subscribe(viewer, PLATFORM, "one")
        await hub.subscribe(viewer, PLATFORM, "two")
        for i in range(250):
            await hub.publish_message(msg(i, "one", ts=i * 10))
        for i in range(1000, 1010):
            await hub.publish_message(msg(i, "two", ts=2000 + (i - 1000) * 10 + 5))
        payload = json.loads(hub.bootstrap_text(viewer))
        assert payload["type"] == "bootstrap"
        assert hub_module.RECENT_LIMIT == 200
        assert len(payload["messages"]) == 210
        stamps = [m["timestamp"] for m in payload["messages"]]
        assert stamps == sorted(stamps)
        assert "m49" not in {m["id"] for m in payload["messages"]}
        assert "author_login" not in payload["messages"][0]
        assert {s["channel"] for s in payload["statuses"]} == {"one", "two"}
    asyncio.run(run())


def test_deleted_updates_cached_json():
    async def run():
        hub = make_hub()
        sock = FakeSocket()
        viewer = Viewer(sock)
        await hub.subscribe(viewer, PLATFORM, "chan")
        await hub.publish_message(msg(1))
        await hub.publish_message(msg(2))
        await hub.publish_deleted(PLATFORM, "chan", message_id="m1")
        await settle()
        assert {"type": "deleted", "ids": ["m1"]} in sock.events()
        by_id = {m["id"]: m for m in json.loads(hub.bootstrap_text(viewer))["messages"]}
        assert by_id["m1"]["deleted"] is True and by_id["m2"]["deleted"] is False
    asyncio.run(run())
