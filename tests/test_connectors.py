import asyncio
import json

from conftest import RecordingHub
from server.connectors.twitch import TwitchChat
from server.connectors.youtube import YouTubeChat

GOOD_TWITCH = "@id=ok;display-name=A;tmi-sent-ts=1700000000000 :a!a@a.tmi.twitch.tv PRIVMSG #chan :hello"


def test_twitch_bad_line_is_skipped():
    async def run():
        hub = RecordingHub()
        twitch = TwitchChat(hub)
        await twitch._safe_line("@id=bad;tmi-sent-ts=abc :a!a@a.tmi.twitch.tv PRIVMSG #chan :hello")
        await twitch._safe_line(GOOD_TWITCH)
        assert [m.id for m in hub.messages] == ["ok"]
    asyncio.run(run())


def yt_text(message_id: str, usec: str) -> dict:
    return {"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {
        "id": message_id, "timestampUsec": usec, "message": {"runs": [{"text": "hi"}]},
        "authorName": {"simpleText": "a"}}}}}


def test_youtube_bad_action_is_skipped():
    async def run():
        hub = RecordingHub()
        youtube = YouTubeChat(hub)
        data = {"continuationContents": {"liveChatContinuation": {
            "actions": [yt_text("bad", "abc"), yt_text("ok", "1700000000000000")],
            "continuations": [{"timedContinuationData": {"continuation": "next", "timeoutMs": 1500}}],
        }}}
        assert await youtube._process("chan", data) == ("next", 1500)
        assert [m.id for m in hub.messages] == ["ok"]
    asyncio.run(run())
