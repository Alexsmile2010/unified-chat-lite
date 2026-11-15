# Stability and Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A slow viewer can never stall other viewers or upstream reads, and the page renders bursts of chat without freezing.

**Architecture:** The hub stops awaiting sockets: every viewer owns a bounded outbox drained by its own writer task, and a viewer that falls behind is disconnected and re-bootstrapped. The browser stops rebuilding the feed: cards are appended in per-frame batches and evicted from the top.

**Tech Stack:** Python 3.12, FastAPI/uvicorn, vanilla JS, pytest (dev only).

**Spec:** `docs/superpowers/specs/2026-11-15-stability-and-render-design.md`

## Global Constraints

- No new runtime dependencies; no build step; vanilla JS only.
- `RECENT_LIMIT = 200`, `MAX_OUTBOX = 1000`, `SEND_TIMEOUT_SECONDS = 10`, `PING_INTERVAL_SECONDS = 10`, browser watchdog 25 s.
- Chat appearance and settings behaviour must not change.
- Connectors keep calling `await hub.publish_*()`; only the hub's internals change.
- Render budget: ≤ 0.3 ms per message in `tests/browser/render_bench.js`.

## Review Focus

- Burst larger than the visible window (1000 messages in one frame): only the newest window is rendered, nothing throws.
- Message deleted while still in the pending batch: it must render as deleted.
- Viewer disconnects normally while its writer is mid-send: no task leak, no traceback.
- Invalid JSON from a browser on `/ws`: connection closes cleanly, server unaffected.
- User scrolled up during a burst: position holds, counter grows, older cards survive up to 5× the window.

---

### Task 1: Non-blocking hub

**Files:** Modify `server/hub.py`, `server/models.py`, `server/main.py`, `Dockerfile`. Create `requirements-dev.txt`, `tests/test_hub.py`, `tests/test_stalled_viewer.py`.

**Interfaces — produces:**
- `Viewer(websocket)`: `send(payload: dict) -> None`, `push(text: str) -> None` (both synchronous), `close() -> None`, `closed: bool`, `keys: set[tuple[str, str]]`.
- `Message.to_json() -> str` (cached; reset when `deleted` flips).
- `Hub.bootstrap_text(viewer) -> str`.
- Wire events: `{"type":"batch","events":[…]}`, `{"type":"ping"}`.

- [ ] Write `tests/test_hub.py`: `test_blocked_viewer_does_not_delay_others`, `test_events_keep_order_and_batch`, `test_overflow_closes_viewer`, `test_send_timeout_closes_viewer`, `test_duplicate_ids_dropped`, `test_bootstrap_holds_last_200_sorted`, `test_deleted_updates_cached_json`.
- [ ] Write `tests/test_stalled_viewer.py`: real uvicorn, one healthy websocket, one raw socket that never reads; assert the healthy one receives every message and the stalled socket is closed by the server.
- [ ] Run; expect failures against the current hub.
- [ ] Implement; run; expect pass.
- [ ] `main.py`: synchronous sends, ping loop, clean exit on bad JSON, `viewer.close()` in `finally`. `Dockerfile` CMD gains `--ws-per-message-deflate false`.

### Task 2: Connector error isolation

**Files:** Modify `server/connectors/twitch.py`, `kick.py`, `youtube.py`. Create `tests/test_connectors.py`.

- [ ] Tests: feed the malformed inputs from the spec (fact 6) through a new per-item wrapper (`TwitchChat._safe_line`, `KickChat._safe_frame`, YouTube `_process` per action) and assert no exception and that the next good message is still published.
- [ ] Run (fail) → wrap each item in `try/except Exception` with `logger.exception` → run (pass).

### Task 3: Incremental rendering and connection watchdog

**Files:** Modify `web/app.js`, `web/styles.css`. Create `tests/browser/render_bench.js`.

- [ ] `renderCard(message) -> string`; `cardById: Map`; `addMessage` queues, `flush()` appends one fragment per frame (rAF with a 100 ms timer fallback), trims from the top, scrolls once when pinned.
- [ ] `pinned` maintained by the `scroll` listener; deletions toggle the card's class; overlay cards are removed on `animationend`; the 1 s overlay rebuild goes away.
- [ ] `.message-card { content-visibility: auto; contain-intrinsic-size: auto 2em; }`; images get `decoding="async"`.
- [ ] `HubConnection`: handle `batch` and `ping`; watchdog reconnects after 25 s of silence and on `online`.
- [ ] Run `render_bench.js` in the browser; expect ≤ 0.3 ms per message. Check main page, `/popout`, `/overlay` against live channels.

### Task 4: End-to-end check

- [ ] Rebuild the image, run the stalled-viewer scenario against the container, load a live channel in two windows.
