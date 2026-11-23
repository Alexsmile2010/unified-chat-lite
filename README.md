<p align="center">
  <img width="220" src="web/assets/favicon.ico" alt="Unified-Chat Logo">
</p>

<h1 align="center">Unified Chat LITE</h1>

<p align="center">
  <strong>Your multistream chat, finally in one place. 🎯</strong><br>
  One unified chat for Twitch and YouTube in a single clean feed.
</p><br>
<p align="center">
  👉<a href="https://unified-chat.com/">Try it here</a>
</p>
<p align="center">
  <a href="https://status.kimsec.net/api/badge/16/uptime/30d?labelSuffix=d">
  <img src="https://status.kimsec.net/api/badge/16/uptime/30d?labelSuffix=d" alt="Uptime status"></a>
</p>
<br>
<p align="center" width="100%">
<a href="https://www.buymeacoffee.com/kimsec">
<img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&amp;emoji=%E2%98%95&amp;slug=kimsec&amp;button_colour=FFDD00&amp;font_colour=000000&amp;font_family=Inter&amp;outline_colour=000000&amp;coffee_colour=ffffff" alt="Buy Me A Coffee"></a></p>

---

Zero-setup, read-only multistream chat viewer — a simplified spin-off of
[kimsec/unified-chat](https://github.com/kimsec/unified-chat) with no OAuth,
no per-user hosting and no moderation/sending.

Open [unified-chat.com](https://unified-chat.com/), type your channel names
(Twitch / YouTube) and watch the aggregated chat. Channels are
shareable as links: `https://unified-chat.com/?twitch=channelname&youtube=handle`.

## Features

- **Unified feed** — up to four chats in one view, with per-platform filters,
  timestamps and clickable links/emotes. Messages that @-mention a connected
  channel are highlighted.
- **7TV / BTTV / FFZ emotes** — third-party emotes render automatically in
  Twitch chats, no browser extension needed.
- **Twitch chat GIFs** — GIFs sent in Twitch chat show as images.
- **Twitch badges** — broadcaster, mod, VIP, sub and more, using Twitch's own
  badge art.
- **Expand** — one click fills the window with the chat; ✕ or Esc brings the
  page back. The state lives in the URL (`?expand=1`), so a bookmark or shared
  link opens straight into it.
- **Combined viewers** — a badge sums the live viewers of every connected
  stream; hover for the per-platform split, also shown under Connector Status.
- **Stream player** — press ▶ in the expanded chat to watch Twitch or
  YouTube (once live) above the chat. Starts muted; platform icons switch source.
- **Alert sounds** — paste your StreamElements/Streamlabs alert overlay URLs
  under Settings → Alert sounds and they play in the expanded chat. Stored
  only in your browser, never on the server.
- **OBS overlay** — use `/overlay?twitch=channelname` as a transparent
  browser source with auto-fading messages (see parameters below).
- **Event notices** — subs, resubs, gift subs, raids, cheers with animated
  cheermotes, bits Power-ups and Hype Chats (Twitch), Super
  Chats/Stickers and memberships (YouTube) render with a highlight border.
- **Hype Train** — a live progress bar (level + %) appears when a Twitch hype
  train is rolling, and fades out when it ends.
- **Shared chat** — in Twitch dual streams, messages from the partner's chat
  show that streamer's avatar.
- **Installable (PWA)** — install as an app from the browser's address bar;
  it opens with your last used channels.
- **Efficient** — the server keeps one upstream connection per unique channel
  (not per viewer) and fans out through an internal WebSocket hub.

## Settings

All toggles live in the sidebar and are stored locally in the browser:

| Setting | Default | Does |
|---|---|---|
| Platform | on | platform icon in front of each message |
| User badges | on | Twitch badges (mod, sub, VIP...) |
| 7TV/BTTV/FFZ emotes | on | third-party emotes in Twitch chats |
| Highlight mentions | on | highlight messages @-mentioning a connected channel |
| 24-hour clock | on | 24h vs 12h timestamps |
| Text size | 16 px | chat text size |
| Alert sounds | – | alert overlay URLs whose sounds play in the expanded chat |

## OBS overlay parameters

Append to the overlay link, e.g.
`/overlay?twitch=channelname&fade=90&size=18&max=8`:

| Parameter | Default | Does |
|---|---|---|
| `fade=<s>` | 60 | seconds before a message fades out; `0` = never fade |
| `size=<px>` | – | text size |
| `align=right` | left | right-align messages |
| `max=<n>` | 200 | max messages on screen |
| `icons=0` | on | hide platform icons |

## Privacy

This service stores **no data** — it is a pure pass-through proxy:

- Chat messages live only in memory: a rolling buffer of the last ~100
  messages per channel (so new viewers get instant history) plus what each
  browser holds on screen. Nothing is written to disk, no database, and a
  restart wipes everything.
- With the recommended flags (`--no-access-log --log-level warning`) the
  server logs no requests, no IP addresses and no watched channels.
- The browser's localStorage keeps only the visitor's own settings (channel
  names, toggles) — locally, on their machine, never sent anywhere.


## Self-hosting

### Run on macOS (no Docker)

Needs Python 3.11 or newer (`python3 --version`).

```bash
./scripts/multichat.sh start    # first run creates .venv and installs requirements
./scripts/multichat.sh status
./scripts/multichat.sh stop
```

- `start` runs the server in the background, so closing the Terminal window keeps it running. Open <http://localhost:8100/>.
- Logs go to `logs/multichat.log`, the PID to `logs/multichat.pid`.
- `MULTICHAT_PORT` (default `8100`) and `MULTICHAT_HOST` (default `0.0.0.0`, reachable from other devices on your network; set `127.0.0.1` to allow this machine only) change where it listens.

### Run manually (any OS)

```bash
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 8100 \
  --no-access-log --log-level warning --ws-per-message-deflate false
```

On Windows use `python` instead of `python3` and `.venv\Scripts\` instead of `.venv/bin/`. This runs in the foreground, so it stops when the terminal closes.

### Docker (alternative)

Docker Desktop keeps a Linux VM running and uses noticeably more memory than the native run above.

Save this as `docker-compose.yml`:

```yaml
services:
  unified-chat-lite:
    image: kim3k/unified-chat-lite:latest
    container_name: unified-chat-lite
    restart: unless-stopped
    ports:
      - "8100:8000"
```
Run `docker compose up -d`

### Announcement banner (optional)

Push a site-wide banner (e.g. "The app is updating in a moment — please refresh in a few seconds") without restarting. Off by default; mainly useful when hosting for other people.

To enable, add to the service in `docker-compose.yml`:

```yaml
    environment:
      - ANNOUNCE_TOKEN=${ANNOUNCE_TOKEN:-}
```

Put the secret in a `.env` file next to it (`ANNOUNCE_TOKEN=<openssl rand -hex 32>`), then `docker compose up -d`.

Usage, from the machine running Docker (or your public domain — the token is the gate):

```bash
curl -X POST http://localhost:8100/announce \
  -H "content-type: application/json" \
  -d '{"token":"<your token>","text":"Maintenance at 18:00 UTC — a few seconds, refresh after."}'
```

- Clear: same call with `"text":""` (a restart also clears it)
- Without a token configured the endpoint answers 404
- Without Docker, export `ANNOUNCE_TOKEN` in your shell before `./scripts/multichat.sh start`



## License

[MIT](LICENSE)
