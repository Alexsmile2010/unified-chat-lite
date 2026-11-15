from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass(slots=True)
class Message:
    platform: str
    id: str
    channel: str
    author: str
    color: str = ""
    badges: list[str] = field(default_factory=list)
    text: str = ""
    emotes: list[dict] = field(default_factory=list)
    timestamp: int = 0  # unix ms
    deleted: bool = False
    kind: str = "chat"  # "chat" | "system" (subs, gifts, raids, superchats, …)
    # Twitch Shared Chat: avatar + name of the partner streamer whose chat the
    # message came from. Empty for messages from the watched channel itself.
    avatar_url: str = ""
    source_name: str = ""
    bits: int = 0
    notice: str = ""
    # Internal only: lowercase login for CLEARCHAT (ban/timeout) matching on
    # Twitch, where display names can differ from logins.
    author_login: str = ""
    # Wire form, encoded once and reused for every viewer and every bootstrap.
    _json: str | None = field(default=None, repr=False, compare=False)

    def to_payload(self) -> dict:
        return {
            "platform": self.platform,
            "id": self.id,
            "channel": self.channel,
            "author": self.author,
            "color": self.color,
            "badges": self.badges,
            "text": self.text,
            "emotes": self.emotes,
            "timestamp": self.timestamp,
            "deleted": self.deleted,
            "kind": self.kind,
            "avatar_url": self.avatar_url,
            "source_name": self.source_name,
            "bits": self.bits,
            "notice": self.notice,
        }

    def to_json(self) -> str:
        if self._json is None:
            self._json = json.dumps(self.to_payload(), separators=(",", ":"))
        return self._json

    def mark_deleted(self) -> None:
        self.deleted = True
        self._json = None


def prefix_text(prefix: str, text: str, emotes: list[dict]) -> tuple[str, list[dict]]:
    if not text.strip():
        return f"{prefix}!", []
    offset = len(prefix) + 2
    shifted = [dict(emote, begin=emote["begin"] + offset, end=emote["end"] + offset) for emote in emotes]
    return f"{prefix}: {text}", shifted
