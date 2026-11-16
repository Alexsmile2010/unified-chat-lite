const isPopout = document.body.dataset.mode === "popout";

// Overlay mode (/overlay): transparent OBS variant with auto-fading messages.
const pageParams = new URLSearchParams(window.location.search);
const isOverlay = isPopout && (window.location.pathname === "/overlay" || pageParams.has("overlay"));
const OVERLAY_FADE_MS = Math.max(Number(pageParams.get("fade")) || 60, 5) * 1000;
// Overlay message styles (?style=…). "classic" is outlined text that fades;
// each other style brings its own card look and enter/exit animations, and
// names the exit animation so finished cards can be removed.
const OVERLAY_STYLES = {
  classic: { exitAnimation: "overlay-fade", exitMs: 2500 },
  sticker: { exitAnimation: "sticker-out", exitMs: 300, enterMs: 440, slideNeighbours: true, tilts: ["-1deg", "0.8deg"] },
  hunt: { exitAnimation: "hunt-out", exitMs: 300, enterMs: 440, slideNeighbours: true, tilts: ["-1deg", "0.8deg"], torn: true },
};
const overlayStyleName = Object.hasOwn(OVERLAY_STYLES, pageParams.get("style")) ? pageParams.get("style") : "classic";
const overlayStyle = OVERLAY_STYLES[overlayStyleName];
const OVERLAY_FADE_OUT_MS = overlayStyle.exitMs;
const OVERLAY_NEVER_FADE = pageParams.get("fade") === "0";
const overlayOptions = {
  size: Math.min(Math.max(Number(pageParams.get("size")) || 0, 0), 64),
  alignRight: pageParams.get("align") === "right",
  max: Math.min(Math.max(Number(pageParams.get("max")) || 0, 0), 200),
  icons: pageParams.get("icons") !== "0",
};
if (isOverlay) {
  const root = document.documentElement;
  root.classList.add("overlay-mode");
  if (overlayOptions.size) root.style.setProperty("--overlay-font", `${overlayOptions.size}px`);
  if (overlayOptions.alignRight) root.classList.add("overlay-align-right");
  if (!overlayOptions.icons) root.classList.add("overlay-no-icons");
  if (OVERLAY_NEVER_FADE) root.classList.add("overlay-no-fade");
  if (overlayStyleName !== "classic") root.classList.add(`overlay-style-${overlayStyleName}`);
}

// Expand (?expand=1): the main page expands into the popout layout in place.
let isExpanded = !isPopout && (pageParams.get("expand") ?? "0") !== "0";
document.documentElement.classList.toggle("expand-mode", isExpanded);

const state = {
  messages: [],
  statuses: new Map(),
  filters: {
    twitch: true,
    youtube: true,
  },
};
const MAX_VISIBLE_MESSAGES = isOverlay && overlayOptions.max ? overlayOptions.max : 200;

const feedEl = document.getElementById("feed");
const statusGridEl = document.getElementById("status-grid");
const channelsFormEl = document.getElementById("channels-form");
const PLATFORMS = ["twitch", "youtube"];
const channelInputs = Object.fromEntries(PLATFORMS.map((p) => [p, document.getElementById(`channel-${p}`)]));
const channelClears = Object.fromEntries(PLATFORMS.map((p) => [p, document.getElementById(`clear-${p}`)]));

const PLATFORM_NAMES = { twitch: "Twitch", youtube: "YouTube" };
const PLATFORM_SVGS = {
  twitch: `<svg viewBox="0 0 256 268" aria-hidden="true"><path fill="#9146ff" d="M17.46 0L0 46.56v185.21h63.14V268h46.87l36.49-36.23h54.91L256 177.68V0H17.46zm23.07 23.07H232.9v143.14l-41.47 41.47h-69.15L85.79 244.2v-36.52H40.53V23.07zm69.15 104.55h23.07V69.26h-23.07v58.36zm63.14 0h23.07V69.26h-23.07v58.36z"/></svg>`,
  youtube: `<svg viewBox="0 0 576 512" aria-hidden="true"><path fill="#ff0000" d="M549.66 124.63a68.28 68.28 0 0 0-48.05-48.28C458.78 64 288 64 288 64S117.22 64 74.39 76.35a68.28 68.28 0 0 0-48.05 48.28C14.48 167.83 14.48 256 14.48 256s0 88.17 11.86 131.37a68.28 68.28 0 0 0 48.05 48.28C117.22 448 288 448 288 448s170.78 0 213.61-12.35a68.28 68.28 0 0 0 48.05-48.28C561.52 344.17 561.52 256 561.52 256s0-88.17-11.86-131.37zM232.15 337.28V174.72L374.86 256l-142.71 81.28z"/></svg>`,
};

// Platform icon in messages is opt-out.
const PLATFORM_STORAGE_KEY = "showPlatform";
let showPlatform = readPlatformPreference();

function readPlatformPreference() {
  try {
    return window.localStorage.getItem(PLATFORM_STORAGE_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

function platformMarkup(platform) {
  return `<span class="platform-pill ${platform}">${PLATFORM_SVGS[platform]}</span>`;
}

const TWITCH_BADGE_IDS = {
  broadcaster: "5527c58c-fb7d-422d-b71b-f309dcb85cc1",
  moderator: "3267646d-33f0-4b17-b3df-f923a41db1d0",
  vip: "b817aba4-fad8-49e2-b88a-7cc744dfa6ec",
  partner: "d12a2e27-16f6-41d0-ab77-b780518f00a3",
  subscriber: "5d9f2208-5dd8-11e7-8513-2ff4adfae661",
  founder: "511b78a9-ab37-472f-9569-457753bbe7d3",
  premium: "bbbe0db0-a598-423e-86d0-f9fb98ca1933",
  turbo: "bd444ec6-8f34-4bf9-91f4-af1e3428d80f",
  staff: "d97c37bd-a6f5-4c38-8f57-4e4bef88af34",
  "sub-gifter": "f1d8486f-eb2e-4553-b44f-4d614617afc1",
};

const BADGES_STORAGE_KEY = "showBadges";
let showBadges = readBadgesPreference();

function readBadgesPreference() {
  try {
    return window.localStorage.getItem(BADGES_STORAGE_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

function sourceAvatarMarkup(message) {
  if (!message.avatar_url) return "";
  const title = message.source_name ? `${message.source_name}'s chat` : "Shared chat source";
  return `<img class="source-streamer-avatar" decoding="async" src="${escapeHtml(message.avatar_url)}" alt="" title="${escapeHtml(title)}">`;
}

function badgesMarkup(message) {
  if (!showBadges || message.platform !== "twitch" || !message.badges?.length) return "";
  return message.badges.map((badge) => {
    const name = String(badge).split("/")[0].toLowerCase();
    const id = TWITCH_BADGE_IDS[name];
    if (!id) return "";
    return `<img class="badge" decoding="async" src="https://static-cdn.jtvnw.net/badges/v1/${id}/1" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`;
  }).join("");
}


const AUTHOR_COLOR_BG = "#09111f";
const MIN_AUTHOR_CONTRAST = 4.0;

function parseHexColor(value) {
  if (!value) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) return null;
  const hex = `#${match[1].toLowerCase()}`;
  const n = parseInt(match[1], 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
    hex,
  };
}

const AUTHOR_COLOR_BG_RGB = parseHexColor(AUTHOR_COLOR_BG);

function srgbChannelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  );
}

function contrastRatio(fg, bg) {
  const fgLum = relativeLuminance(fg);
  const bgLum = relativeLuminance(bg);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixTowardWhite(rgb, amount) {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * amount),
    g: Math.round(rgb.g + (255 - rgb.g) * amount),
    b: Math.round(rgb.b + (255 - rgb.b) * amount),
  };
}

function rgbToHex(rgb) {
  return `#${((rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).padStart(6, "0")}`;
}

function ensureReadableColor(value) {
  const color = parseHexColor(value);
  if (!color || !AUTHOR_COLOR_BG_RGB) return "";
  if (contrastRatio(color, AUTHOR_COLOR_BG_RGB) >= MIN_AUTHOR_CONTRAST) return color.hex;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 8; i += 1) {
    const mid = (low + high) / 2;
    const candidate = mixTowardWhite(color, mid);
    if (contrastRatio(candidate, AUTHOR_COLOR_BG_RGB) >= MIN_AUTHOR_CONTRAST) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return rgbToHex(mixTowardWhite(color, high));
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/;

function linkifyText(text) {
  if (!text) return "";
  let result = "";
  let last = 0;
  URL_REGEX.lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    let url = match[0];
    let trailing = "";
    const trail = url.match(TRAILING_PUNCT);
    if (trail) {
      trailing = trail[0];
      url = url.slice(0, -trailing.length);
    }
    result += escapeHtml(text.slice(last, match.index));
    const escaped = escapeHtml(url);
    result += `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="message-link">${escaped}</a>`;
    result += escapeHtml(trailing);
    last = match.index + match[0].length;
  }
  result += escapeHtml(text.slice(last));
  return result;
}

const EMOTE_IMAGE_URLS = {
  twitch: (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/1.0`,
  youtube: (id) => id, // YouTube emote ids are complete image URLs
};

// Third-party emotes (7TV/BTTV/FFZ), platform → (name → url), sent by the hub.
const thirdPartyEmotes = new Map();

const THIRD_PARTY_EMOTES_STORAGE_KEY = "showThirdPartyEmotes";
let showThirdPartyEmotes = readThirdPartyEmotesPreference();

function readThirdPartyEmotesPreference() {
  try {
    return window.localStorage.getItem(THIRD_PARTY_EMOTES_STORAGE_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

function emoteImg(url, name) {
  return `<img class="emote" decoding="async" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`;
}

// Global cheermotes from Twitch's open CDN, only applied to messages that
// actually carried bits.
const CHEERMOTE_PREFIXES = new Set([
  "cheer", "cheerwhal", "corgo", "uni", "showlove", "party", "seemsgood", "pride",
  "kappa", "frankerz", "heyguys", "dansgame", "trihard", "kreygasm", "4head",
  "swiftrage", "notlikethis", "failfish", "vohiyo", "pjsalt", "mrdestructoid",
  "bday", "ripcheer", "shamrock",
]);
const CHEER_TIERS = [
  [10000, "#f43021"],
  [5000, "#0099fe"],
  [1000, "#1db2a5"],
  [100, "#9c3ee8"],
  [1, "#979797"],
];

const CHEER_WORD_RE = /^([a-z][a-z0-9_]*?)(\d+)$/i;
const POWER_UP_SVG = `<svg class="bits-gem" viewBox="0 0 24 24" aria-hidden="true" style="color:#ffd166"><path fill="currentColor" d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.5z"/></svg>`;

function bitsGemSvg(color) {
  return `<svg class="bits-gem" viewBox="0 0 24 24" aria-hidden="true" style="color:${color}"><path fill="currentColor" d="M12 2 3.5 9.5 12 22l8.5-12.5z"/><path fill="#fff" opacity=".35" d="M12 2 7.5 9.5h9z"/></svg>`;
}

function cheerTier(amount) {
  return CHEER_TIERS.find(([min]) => amount >= min) || CHEER_TIERS[CHEER_TIERS.length - 1];
}

// Channel cheermotes (e.g. "xqcCheer100") only count when all cheer-shaped
// words add up to exactly the bits sent, so "Team10" stays text.
function findCheerWords(text, bits) {
  const known = new Set();
  const all = new Set();
  let total = 0;
  for (const word of text.split(/\s+/)) {
    const match = CHEER_WORD_RE.exec(word);
    if (!match) continue;
    all.add(word);
    total += Number(match[2]);
    if (CHEERMOTE_PREFIXES.has(match[1].toLowerCase())) known.add(word);
  }
  return total === bits ? all : known;
}

function cheermoteMarkup(word) {
  const [, rawPrefix, digits] = CHEER_WORD_RE.exec(word);
  const prefix = rawPrefix.toLowerCase();
  const amount = Number(digits);
  const [tier, color] = cheerTier(amount);
  const image = CHEERMOTE_PREFIXES.has(prefix)
    ? `<img class="emote" decoding="async" src="https://d3aqoihi2n8ty8.cloudfront.net/actions/${prefix}/dark/animated/${tier}/1.gif" alt="${escapeHtml(word)}" title="${escapeHtml(word)}">`
    : `<span title="${escapeHtml(word)}">${bitsGemSvg(color)}</span>`;
  return `${image}<span class="cheer-amount" style="color:${color}">${amount}</span>`;
}

function paidNoticeMarkup(message) {
  const color = ensureReadableColor(message.color);
  const author = `<span class="author-name"${color ? ` style="color:${color}"` : ""}>${escapeHtml(message.author)}</span>`;
  const colon = message.text ? ":" : "";
  if (message.bits > 0) {
    const [, tierColor] = cheerTier(message.bits);
    const amount = `${message.bits.toLocaleString()} ${message.bits === 1 ? "bit" : "bits"}`;
    return `<span class="paid-head">${bitsGemSvg(tierColor)}${badgesMarkup(message)}${author} cheered <strong class="cheer-total" style="color:${tierColor}">${amount}</strong>${colon}</span>`;
  }
  return `<span class="paid-head">${POWER_UP_SVG}${badgesMarkup(message)}${author} ${escapeHtml(message.notice)}${colon}</span>`;
}

function renderPlainText(text, platform, cheers) {
  if (platform !== "twitch") return linkifyText(text);
  const emoteMap = showThirdPartyEmotes ? thirdPartyEmotes.get(platform) : undefined;
  if (!emoteMap?.size && !cheers?.size) return linkifyText(text);
  return text.split(" ").map((word) => {
    if (cheers?.has(word)) return cheermoteMarkup(word);
    const url = emoteMap?.get(word);
    return url ? emoteImg(url, word) : linkifyText(word);
  }).join(" ");
}

function renderMessageText(text, emotes, platform, bits = 0) {
  const cheers = bits > 0 ? findCheerWords(text, bits) : null;
  if (!emotes || !emotes.length) return renderPlainText(text, platform, cheers);
  const emoteUrl = EMOTE_IMAGE_URLS[platform] || EMOTE_IMAGE_URLS.twitch;
  const chars = Array.from(text);
  const sorted = [...emotes].sort((a, b) => a.begin - b.begin);
  let result = "";
  let cursor = 0;
  for (const emote of sorted) {
    if (emote.begin > cursor) {
      result += renderPlainText(chars.slice(cursor, emote.begin).join(""), platform, cheers);
    }
    result += emote.gif
      ? `<img class="chat-gif" decoding="async" src="${escapeHtml(emote.id)}" alt="${escapeHtml(emote.text)}" title="${escapeHtml(emote.text)}" loading="lazy">`
      : emoteImg(emoteUrl(emote.id), emote.text);
    cursor = emote.end;
  }
  if (cursor < chars.length) {
    result += renderPlainText(chars.slice(cursor).join(""), platform, cheers);
  }
  return result;
}

const CHAT_FONT_STORAGE_KEY = "chatFontPx";
let chatFontPx = readChatFontPreference();

function readChatFontPreference() {
  try {
    return Number(window.localStorage.getItem(CHAT_FONT_STORAGE_KEY)) || 0;
  } catch (_) {
    return 0;
  }
}

function applyChatFont(px) {
  chatFontPx = px;
  if (px) {
    document.documentElement.style.setProperty("--chat-font", `${px}px`);
  } else {
    document.documentElement.style.removeProperty("--chat-font");
  }
}

applyChatFont(chatFontPx);

// Messages @-mentioning a connected channel get highlighted.
const MENTIONS_STORAGE_KEY = "highlightMentions";
let highlightMentions = readMentionsPreference();
let mentionRegex = null;

function readMentionsPreference() {
  try {
    return window.localStorage.getItem(MENTIONS_STORAGE_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

function updateMentionRegex(channels) {
  const names = Object.values(channels)
    .filter(Boolean)
    .map((name) => name.replace(/^@/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  mentionRegex = names.length ? new RegExp(`@(?:${names.join("|")})\\b`, "i") : null;
}

// 24-hour clock by default; switchable in Settings.
const CLOCK_STORAGE_KEY = "use24hClock";
let use24hClock = readClockPreference();

function readClockPreference() {
  try {
    return window.localStorage.getItem(CLOCK_STORAGE_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24hClock,
  });
}

// Cross-window sync (main window -> popouts) over a BroadcastChannel.
const syncChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("unified-chat-lite-sync")
  : null;

function broadcast(payload) {
  syncChannel?.postMessage(payload);
}

function applyShowPlatform(value) {
  showPlatform = Boolean(value);
  if (togglePlatform) {
    togglePlatform.classList.toggle("active", showPlatform);
  }
  renderMessages();
}

if (syncChannel) {
  syncChannel.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== "object") return;
    if (!isPopout) return;

    switch (payload.type) {
      case "channels":
        applyPopoutChannels(payload.channels);
        break;
      case "clear":
        state.messages = [];
        renderMessages();
        break;
      case "showPlatform":
        applyShowPlatform(payload.value);
        break;
      case "showBadges":
        showBadges = Boolean(payload.value);
        renderMessages();
        break;
      case "showThirdPartyEmotes":
        showThirdPartyEmotes = Boolean(payload.value);
        renderMessages();
        break;
      case "chatFont":
        applyChatFont(Number(payload.value) || 0);
        break;
      case "highlightMentions":
        highlightMentions = Boolean(payload.value);
        renderMessages();
        break;
      case "alertUrls":
        applyPopoutAlerts(payload.urls);
        break;
      case "obsMonitor":
        applyObsConfig(payload.config);
        break;
      case "use24hClock":
        use24hClock = Boolean(payload.value);
        renderMessages();
        break;
    }
  });
}

// Rendering. The feed is append-only: every message becomes one card, built
// once. New cards are queued and added as a single batch per frame and the
// oldest are evicted from the top, so the cost of a message stays flat no
// matter how busy the chat is. A full rebuild (renderMessages) is kept for
// the rare events that change how every card looks: a bootstrap, a filter or
// a setting.
const EMPTY_STATE_HTML = `<div class="empty-state">No messages yet. Connect to a channel to get started.</div>`;
const FLUSH_FALLBACK_MS = 100;
const SLIDE_MAX_CARDS = 40; // above this the neighbour slide costs more than it shows
const cardTemplate = document.createElement("template");
const cardById = new Map();
let pendingMessages = [];
let flushFrame = 0;
let flushTimer = 0;
let feedHasCards = false;
// Whether the feed follows new messages. The scroll listener keeps it
// current, so adding a message never has to measure the page.
let pinnedToBottom = true;

const scrollBottomBtn = document.getElementById("scroll-bottom");
let unseenCount = 0;

// Scrolled-up readers keep a longer backlog so the text under their eyes
// isn't evicted mid-read.
function feedLimit() {
  return pinnedToBottom ? MAX_VISIBLE_MESSAGES : MAX_VISIBLE_MESSAGES * 5;
}

function isVisible(message) {
  return state.filters[message.platform] !== false;
}

function addMessage(message) {
  state.messages.push(message);
  pendingMessages.push(message);
  if (!pinnedToBottom) unseenCount += 1;
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  // rAF paces rendering to the display; the timer covers hidden tabs and
  // inactive OBS sources, where rAF never fires.
  flushFrame = requestAnimationFrame(flushPending);
  flushTimer = setTimeout(flushPending, FLUSH_FALLBACK_MS);
}

function cancelFlush() {
  cancelAnimationFrame(flushFrame);
  clearTimeout(flushTimer);
  flushFrame = 0;
  flushTimer = 0;
}

function removeCard(card) {
  if (cardById.get(card.dataset.id) === card) cardById.delete(card.dataset.id);
  card.remove();
}

function flushPending() {
  cancelFlush();
  const limit = feedLimit();
  if (state.messages.length > limit) state.messages = state.messages.slice(-limit);

  let batch = pendingMessages.filter(isVisible);
  pendingMessages = [];
  if (batch.length > limit) batch = batch.slice(-limit);
  if (batch.length) {
    if (!feedHasCards) {
      feedEl.textContent = "";
      feedHasCards = true;
    }
    const slide = isOverlay && overlayStyle.slideNeighbours && feedEl.childElementCount <= SLIDE_MAX_CARDS;
    const cardsBefore = slide ? [...feedEl.children] : [];
    const topsBefore = cardsBefore.map((card) => card.getBoundingClientRect().top);

    cardTemplate.innerHTML = batch.map(renderCard).join("");
    for (const card of cardTemplate.content.children) cardById.set(card.dataset.id, card);
    feedEl.appendChild(cardTemplate.content);
    for (let extra = feedEl.childElementCount - limit; extra > 0; extra -= 1) {
      removeCard(feedEl.firstElementChild);
    }
    if (pinnedToBottom) feedEl.scrollTop = feedEl.scrollHeight;

    // FLIP: new cards push the others up; glide each one from where it was
    // instead of letting it jump. Added on top of the card's own transform.
    cardsBefore.forEach((card, i) => {
      if (!card.isConnected) return;
      const moved = topsBefore[i] - card.getBoundingClientRect().top;
      if (Math.abs(moved) < 1) return;
      card.animate([{ transform: `translateY(${moved}px)` }, { transform: "translateY(0)" }],
        { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", composite: "add" });
    });
  }
  if (!pinnedToBottom) updateScrollButton();
}

function markDeleted(ids) {
  const wanted = new Set(ids);
  // Messages still waiting in the pending batch are the same objects, so
  // they render as deleted when their card is built.
  for (const message of state.messages) {
    if (wanted.has(message.id)) message.deleted = true;
  }
  for (const id of wanted) cardById.get(id)?.classList.add("deleted");
}

// Small stable hash, so a message keeps the same tilt across rebuilds.
function hashOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

// Repeatable random numbers from a seed (mulberry32), so a message is torn
// the same way every time it is drawn.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A jagged clip-path for a scrap of paper: points along each side, pushed in
// by mostly shallow nicks with the odd deep bite.
function tornOutline(random) {
  const depth = () => `${(random() ** 2 * 0.5).toFixed(3)}em`;
  const far = () => `calc(100% - ${depth()})`;
  const across = 26;
  const down = 6;
  const points = [];
  for (let i = 0; i <= across; i += 1) points.push(`${((i / across) * 100).toFixed(1)}% ${depth()}`);
  for (let i = 1; i < down; i += 1) points.push(`${far()} ${((i / down) * 100).toFixed(1)}%`);
  for (let i = across; i >= 0; i -= 1) points.push(`${((i / across) * 100).toFixed(1)}% ${far()}`);
  for (let i = down - 1; i > 0; i -= 1) points.push(`${depth()} ${((i / down) * 100).toFixed(1)}%`);
  return `polygon(${points.join(", ")})`;
}

// Inline style for an overlay card. Negative delays resume an animation
// mid-life after a DOM rebuild: an old message does not pop in again, and
// its exit still starts on time.
function overlayCardStyle(message) {
  if (!isOverlay) return "";
  const age = Math.max(Date.now() - new Date(message.timestamp).getTime(), 0);
  const delays = [];
  if (overlayStyle.enterMs) delays.push(`${-age}ms`);
  if (!OVERLAY_NEVER_FADE) delays.push(`${OVERLAY_FADE_MS - OVERLAY_FADE_OUT_MS - age}ms`);
  const rules = [];
  if (delays.length) rules.push(`animation-delay: ${delays.join(", ")}`);
  if (overlayStyle.tilts) rules.push(`--tilt: ${overlayStyle.tilts[hashOf(String(message.id)) % overlayStyle.tilts.length]}`);
  if (overlayStyle.torn) {
    const random = seededRandom(hashOf(String(message.id)));
    rules.push(`--tear: ${tornOutline(random)}`);
    // Which patch of the paper texture this card shows.
    rules.push(`--shift: ${Math.round(random() * 100)}% ${Math.round(random() * 100)}%`);
    // The glowing rim is a pseudo-element, so it takes its delay from here.
    rules.push(`--enter-delay: ${-age}ms`);
  }
  return rules.length ? ` style="${rules.join("; ")}"` : "";
}

function renderCard(message) {
  let messageClass = message.deleted ? "message-card deleted" : "message-card";
  if (highlightMentions && message.kind !== "system" && mentionRegex?.test(message.text)) {
    messageClass += " mention";
  }
  const open = `<article class="${messageClass}${message.kind === "system" ? " system-notice" : ""}" data-id="${escapeHtml(message.id)}" data-platform="${message.platform}"${overlayCardStyle(message)}>`;
  const lead = `<span class="message-time">${formatTime(message.timestamp)}</span> ${showPlatform ? platformMarkup(message.platform) : ""}${sourceAvatarMarkup(message)}`;
  if (message.kind === "system") {
    const paid = message.bits > 0 || Boolean(message.notice);
    const body = message.text
      ? `<span class="message-text${paid ? "" : " system-notice-text"}">${renderMessageText(message.text, message.emotes, message.platform, message.bits)}</span>`
      : "";
    return `${open}<span class="message-topline">${lead}${paid ? `${paidNoticeMarkup(message)} ` : ""}${body}</span></article>`;
  }
  const readableColor = ensureReadableColor(message.color);
  const authorStyle = readableColor ? `style="color:${readableColor}"` : "";
  return `${open}<span class="message-topline">${lead}${badgesMarkup(message)}<span class="author-name" ${authorStyle}>${escapeHtml(message.author)}:</span> <span class="message-text">${renderMessageText(message.text, message.emotes, message.platform, message.bits)}</span></span></article>`;
}

// Full rebuild from state.messages.
function renderMessages() {
  cancelFlush();
  pendingMessages = [];
  cardById.clear();
  const visibleMessages = state.messages.filter(isVisible).slice(-feedLimit());
  feedHasCards = visibleMessages.length > 0;
  if (!feedHasCards) {
    feedEl.innerHTML = EMPTY_STATE_HTML;
    return;
  }
  feedEl.innerHTML = visibleMessages.map(renderCard).join("");
  for (const card of feedEl.children) cardById.set(card.dataset.id, card);
  if (pinnedToBottom) feedEl.scrollTop = feedEl.scrollHeight;
}

function isNearBottom() {
  return feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 100;
}

function updateScrollButton() {
  scrollBottomBtn.textContent = unseenCount ? `↓ ${unseenCount}` : "↓";
}

feedEl.addEventListener("scroll", () => {
  pinnedToBottom = isNearBottom();
  if (pinnedToBottom) {
    unseenCount = 0;
    updateScrollButton();
  }
  scrollBottomBtn.classList.toggle("hidden", pinnedToBottom);
}, { passive: true });

scrollBottomBtn.addEventListener("click", () => {
  feedEl.scrollTop = feedEl.scrollHeight;
});

let hypeTrainEndTimer = null;

function resetHypeTrainBar() {
  if (hypeTrainEndTimer) {
    clearTimeout(hypeTrainEndTimer);
    hypeTrainEndTimer = null;
  }
  const bar = document.getElementById("hype-train-bar");
  if (!bar) return;
  bar.classList.add("hidden");
  bar.setAttribute("aria-hidden", "true");
}

function handleHypeTrain(data) {
  if (isOverlay) return;
  if (!data) {
    resetHypeTrainBar();
    return;
  }
  if (hypeTrainEndTimer) {
    clearTimeout(hypeTrainEndTimer);
    hypeTrainEndTimer = null;
  }
  renderHypeTrain(data);
  if (data.phase === "end") {
    hypeTrainEndTimer = window.setTimeout(resetHypeTrainBar, data.hide_after_ms ?? 5000);
  }
}

function renderHypeTrain(data) {
  const bar = document.getElementById("hype-train-bar");
  if (!bar) return;
  bar.classList.remove("hidden");
  bar.setAttribute("aria-hidden", "false");
  bar.dataset.phase = data.phase || "progress";
  document.getElementById("ht-level").textContent = data.level || 1;
  const goal = data.goal > 0 ? data.goal : 1;
  const pct = Math.min(Math.round(((data.progress || 0) / goal) * 100), 100);
  document.getElementById("ht-progress-text").textContent = data.phase === "end" ? `Ended (${pct}%)` : `${pct}%`;
  document.getElementById("ht-fill").style.width = `${pct}%`;
}

function setStatus(status) {
  state.statuses.set(status.platform, status);
  renderStatuses();
  if (status.platform === "youtube") renderPlayer();
}

const VIEWER_SVG = `<svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M224 256a128 128 0 1 0 0-256 128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3 0 498.7 13.3 512 29.7 512h388.6c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304h-91.4z"/></svg>`;
const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function viewerCountMarkup(count) {
  return `${VIEWER_SVG}${count < 10000 ? count.toLocaleString() : compactNumber.format(count)}`;
}

function renderViewerBadges() {
  const live = PLATFORMS
    .map((platform) => state.statuses.get(platform))
    .filter((status) => typeof status?.viewers === "number");
  const total = live.reduce((sum, status) => sum + status.viewers, 0);
  const split = live.map((status) => `${PLATFORM_NAMES[status.platform]} ${status.viewers.toLocaleString()}`).join(" · ");
  for (const badge of document.querySelectorAll(".viewer-badge")) {
    badge.classList.toggle("hidden", !live.length);
    badge.innerHTML = live.length ? viewerCountMarkup(total) : "";
    badge.title = `Watching now: ${split}`;
  }
}

function renderStatuses() {
  renderViewerBadges();
  if (!statusGridEl) return;
  const statuses = PLATFORMS.map((platform) =>
    state.statuses.get(platform) || { platform, dot: "idle", state: "idle", detail: "Not connected" }
  );
  statusGridEl.innerHTML = statuses.map((status) => `
    <article class="status-card">
      ${platformMarkup(status.platform)}
      <span class="status-detail" title="${escapeHtml(status.detail || "")}">${escapeHtml(status.state === "connected" && status.channel ? status.channel.replace(/^@/, "") : status.detail || status.state || "")}</span>
      ${typeof status.viewers === "number" ? `<span class="status-viewers">${viewerCountMarkup(status.viewers)}</span>` : ""}
      <span class="status-dot ${status.dot}" aria-hidden="true"></span>
    </article>
  `).join("");
}

// Hub connection: subscribe and render; the server fans out per-channel events.
// The server sends a ping every 10 s, so a socket that stays silent for
// WATCHDOG_SILENCE_MS is dead even if the browser still reports it open
// (sleep, Wi-Fi change, a proxy dropping the route). The watchdog replaces it
// and the bootstrap that follows restores the visible feed.
const WATCHDOG_SILENCE_MS = 25000;
const WATCHDOG_INTERVAL_MS = 5000;
const ONLINE_SILENCE_MS = 12000;

class HubConnection {
  constructor() {
    this.socket = null;
    this.desired = null;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.lastFrameAt = 0; // wall clock, so time spent asleep counts as silence
    setInterval(() => this.checkAlive(WATCHDOG_SILENCE_MS), WATCHDOG_INTERVAL_MS);
    window.addEventListener("online", () => this.checkAlive(ONLINE_SILENCE_MS));
  }

  checkAlive(maxSilenceMs) {
    const socket = this.socket;
    if (!socket || Date.now() - this.lastFrameAt < maxSilenceMs) return;
    socket.close(); // may never complete on a dead link, so don't wait for it
    this.handleClosed(socket, { retryNow: true });
  }

  handleClosed(socket, { retryNow = false } = {}) {
    if (this.socket !== socket) return;
    this.socket = null;
    clearTimeout(this.reconnectTimer);
    const delay = retryNow ? 0 : this.reconnectDelay;
    for (const [platform, channel] of Object.entries(this.desired || {})) {
      if (channel) {
        setStatus({ platform, dot: "error", state: "disconnected", detail: `Hub connection lost, retrying in ${Math.round(delay / 1000)}s…` });
      }
    }
    this.reconnectTimer = setTimeout(() => this.open(), delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  setChannels(channels) {
    this.desired = channels;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscribe();
    } else if (!this.socket) {
      this.open();
    }
  }

  sendSubscribe() {
    this.socket.send(JSON.stringify({ type: "subscribe", channels: this.desired }));
  }

  open() {
    clearTimeout(this.reconnectTimer);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.socket = socket;
    this.lastFrameAt = Date.now();

    socket.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      if (this.desired) this.sendSubscribe();
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return; // late frame from a replaced socket
      this.lastFrameAt = Date.now();
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      this.handlePayload(payload);
    });

    socket.addEventListener("close", () => this.handleClosed(socket));
  }

  handlePayload(payload) {
    if (!payload || typeof payload !== "object") return;
    switch (payload.type) {
      case "bootstrap": {
        const subscribed = new Set();
        for (const [platform, channel] of Object.entries(this.desired || {})) {
          if (channel) subscribed.add(`${platform}:${channel.trim().replace(/^#+/, "").toLowerCase()}`);
        }
        const incoming = new Set(payload.messages.map((m) => m.id));
        const kept = state.messages.filter(
          (m) => subscribed.has(`${m.platform}:${m.channel}`) && !incoming.has(m.id)
        );
        const merged = kept.concat(payload.messages);
        merged.sort((a, b) => a.timestamp - b.timestamp);
        state.messages = merged.slice(-MAX_VISIBLE_MESSAGES);
        state.statuses.clear();
        for (const status of payload.statuses) {
          setStatus(status);
        }
        renderStatuses(); // even when statuses is empty (everything disconnected)
        renderMessages();
        break;
      }
      case "batch":
        for (const event of payload.events) this.handlePayload(event);
        break;
      case "ping":
        break; // liveness only; receiving it already reset the watchdog
      case "message":
        addMessage(payload.message);
        break;
      case "deleted":
        markDeleted(payload.ids);
        break;
      case "status":
        setStatus(payload.status);
        break;
      case "emotes":
        thirdPartyEmotes.set(payload.platform || "twitch", new Map(Object.entries(payload.emotes || {})));
        renderMessages();
        break;
      case "hype_train":
        handleHypeTrain(payload);
        break;
      case "announce":
        showAnnouncement(String(payload.text || ""));
        break;
    }
  }
}

// Server-pushed banner; also fetched on load since pages without a
// connected channel hold no websocket. Never shown on the OBS overlay.
let dismissedAnnouncement = "";

if (!isOverlay) {
  fetch("/announcement")
    .then((response) => response.json())
    .then((data) => showAnnouncement(String(data.text || "")))
    .catch(() => {});
}

function showAnnouncement(text) {
  const existing = document.getElementById("announce-banner");
  if (isOverlay || !text || text === dismissedAnnouncement) {
    existing?.remove();
    document.body.classList.remove("has-announcement");
    return;
  }
  const banner = existing || document.createElement("div");
  if (!existing) {
    banner.id = "announce-banner";
    banner.innerHTML = `<span></span><button type="button" title="Dismiss">&#x2715;</button>`;
    banner.querySelector("button").addEventListener("click", () => {
      dismissedAnnouncement = banner.querySelector("span").textContent;
      banner.remove();
      document.body.classList.remove("has-announcement");
    });
    document.body.prepend(banner);
  }
  document.body.classList.add("has-announcement");
  banner.querySelector("span").textContent = text;
}

// Wiring — elements that only exist on index.html are guarded.
const togglePlatform = document.getElementById("toggle-platform");
const hubConnection = new HubConnection();

function connectFromInputs({ updateUrl = true } = {}) {
  const channels = {};
  for (const platform of PLATFORMS) {
    channels[platform] = channelInputs[platform].value.trim();
  }
  const hasAny = Object.values(channels).some(Boolean);
  if (!hasAny && !hubConnection.socket) return;
  hubConnection.setChannels(channels);
  updateClearButtons(channels);
  updateObsLink();
  updateMentionRegex(channels);
  resetHypeTrainBar();
  playerState.channels = channels;
  renderPlayer();
  broadcast({ type: "channels", channels });
  try {
    window.localStorage.setItem("channels", JSON.stringify(channels));
  } catch (_) {}
  if (updateUrl) {
    const params = new URLSearchParams(window.location.search);
    for (const [platform, channel] of Object.entries(channels)) {
      if (channel) {
        params.set(platform, channel);
      } else {
        params.delete(platform);
      }
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }
}

// OBS overlay link: the full browser-source URL for whatever is typed in the
// channel fields, so it can be pasted into OBS as is.
const obsLinkEl = document.getElementById("obs-link");
const obsLinkCopyEl = document.getElementById("obs-link-copy");
const obsStyleEl = document.getElementById("obs-style");
const obsSizeEl = document.getElementById("obs-size");
const OBS_STYLE_STORAGE_KEY = "overlayStyle";
const OBS_SIZE_STORAGE_KEY = "overlaySize";
let obsCopiedTimer = 0;

function updateObsLink() {
  if (!obsLinkEl) return;
  const url = new URL("/overlay", window.location.origin);
  for (const platform of PLATFORMS) {
    const channel = channelInputs[platform].value.trim();
    if (channel) url.searchParams.set(platform, channel);
  }
  const hasChannel = url.searchParams.size > 0;
  const style = obsStyleEl?.value || "classic";
  if (style !== "classic") url.searchParams.set("style", style);
  const size = Math.round(Number(obsSizeEl?.value));
  if (size >= 12 && size <= 64) url.searchParams.set("size", String(size));
  obsLinkEl.value = hasChannel ? url.href : "";
  obsLinkCopyEl.disabled = !hasChannel;
}

async function copyObsLink() {
  const link = obsLinkEl.value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
  } catch (_) {
    // No Clipboard API outside secure contexts (e.g. opened by LAN IP over http).
    obsLinkEl.select();
    document.execCommand("copy");
  }
  obsLinkCopyEl.textContent = "Copied";
  obsLinkCopyEl.classList.add("copied");
  clearTimeout(obsCopiedTimer);
  obsCopiedTimer = setTimeout(() => {
    obsLinkCopyEl.textContent = "Copy";
    obsLinkCopyEl.classList.remove("copied");
  }, 1500);
}

if (obsLinkEl) {
  obsLinkCopyEl.addEventListener("click", copyObsLink);
  obsLinkEl.addEventListener("focus", () => obsLinkEl.select());
  for (const input of Object.values(channelInputs)) input.addEventListener("input", updateObsLink);
  try {
    const saved = window.localStorage.getItem(OBS_STYLE_STORAGE_KEY);
    if (saved && Object.hasOwn(OVERLAY_STYLES, saved)) obsStyleEl.value = saved;
  } catch (_) {}
  try {
    obsSizeEl.value = window.localStorage.getItem(OBS_SIZE_STORAGE_KEY) || "";
  } catch (_) {}
  obsSizeEl.addEventListener("input", () => {
    try {
      window.localStorage.setItem(OBS_SIZE_STORAGE_KEY, obsSizeEl.value);
    } catch (_) {}
    updateObsLink();
  });
  obsStyleEl.addEventListener("change", () => {
    try {
      window.localStorage.setItem(OBS_STYLE_STORAGE_KEY, obsStyleEl.value);
    } catch (_) {}
    updateObsLink();
  });
}

function updateClearButtons(channels) {
  for (const platform of PLATFORMS) {
    channelClears[platform]?.classList.toggle("hidden", !channels[platform]);
  }
}

if (channelsFormEl) {
  channelsFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    connectFromInputs();
  });
  for (const [platform, button] of Object.entries(channelClears)) {
    button?.addEventListener("click", () => {
      channelInputs[platform].value = "";
      connectFromInputs();
    });
  }

  for (const input of Object.values(channelInputs)) {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectFromInputs();
      }
    });
  }
}

document.querySelectorAll(".filter-button[data-platform]").forEach((button) => {
  button.addEventListener("click", () => {
    const platform = button.dataset.platform;
    state.filters[platform] = !state.filters[platform];
    button.classList.toggle("active", state.filters[platform]);
    renderMessages();
  });
});

const clearBtn = document.getElementById("clear-messages");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    state.messages = [];
    renderMessages();
    broadcast({ type: "clear" });
  });
}

const expandToggleBtn = document.getElementById("expand-toggle");
const feedPanelEl = document.querySelector(".feed-panel");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let expandAnimCleanup = null;

// URL params win over saved URLs, same precedence as the popout.
function mainAlertUrls() {
  const fromUrl = new URLSearchParams(window.location.search).getAll("alerts").filter(isValidAlertUrl);
  return fromUrl.length ? fromUrl : storedAlertUrls();
}

function setExpanded(on, { animate = true } = {}) {
  if (isPopout || on === isExpanded) return;
  const firstRect = feedPanelEl.getBoundingClientRect();
  const wasNearBottom = isNearBottom();
  isExpanded = on;
  document.documentElement.classList.toggle("expand-mode", on);

  const params = new URLSearchParams(window.location.search);
  if (on) {
    params.set("expand", "1");
  } else {
    params.delete("expand");
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);

  alertUrls = on ? mainAlertUrls() : [];
  renderAlertFrames();
  renderPlayer();

  if (animate && !prefersReducedMotion) playExpandTransition(firstRect);
  if (wasNearBottom) {
    requestAnimationFrame(() => {
      feedEl.scrollTop = feedEl.scrollHeight;
    });
  }
}

// FLIP: slide the feed panel from its old rect to where the class flip put it.
function playExpandTransition(firstRect) {
  expandAnimCleanup?.();
  const lastRect = feedPanelEl.getBoundingClientRect();
  if (!lastRect.width || !lastRect.height) return;
  feedPanelEl.classList.add("expand-anim");
  feedPanelEl.style.transition = "none";
  feedPanelEl.style.transformOrigin = "top left";
  feedPanelEl.style.transform = `translate(${firstRect.left - lastRect.left}px, ${firstRect.top - lastRect.top}px) `
    + `scale(${firstRect.width / lastRect.width}, ${firstRect.height / lastRect.height})`;
  feedPanelEl.getBoundingClientRect(); // flush, so the transition has a start frame
  feedPanelEl.style.transition = "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)";
  feedPanelEl.style.transform = "";
  const finish = () => {
    feedPanelEl.classList.remove("expand-anim");
    feedPanelEl.style.transition = "";
    feedPanelEl.style.transformOrigin = "";
    feedPanelEl.style.transform = "";
    feedPanelEl.removeEventListener("transitionend", finish);
    clearTimeout(timer);
    expandAnimCleanup = null;
  };
  const timer = setTimeout(finish, 400);
  feedPanelEl.addEventListener("transitionend", finish);
  expandAnimCleanup = finish;
}

if (expandToggleBtn) {
  expandToggleBtn.addEventListener("click", () => setExpanded(true));
  document.getElementById("expand-exit").addEventListener("click", () => setExpanded(false));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isExpanded) return;
    if (infoOverlayEl && !infoOverlayEl.classList.contains("hidden")) return;
    setExpanded(false);
  });
}

const infoOverlayEl = document.getElementById("info-overlay");
const openInfoBtn = document.getElementById("open-info");
if (infoOverlayEl && openInfoBtn) {
  const closeInfo = () => infoOverlayEl.classList.add("hidden");
  openInfoBtn.addEventListener("click", () => infoOverlayEl.classList.remove("hidden"));
  document.getElementById("close-info").addEventListener("click", closeInfo);
  infoOverlayEl.addEventListener("click", (event) => {
    if (event.target === infoOverlayEl) closeInfo();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !infoOverlayEl.classList.contains("hidden")) closeInfo();
  });
}

const toggleMentions = document.getElementById("toggle-mentions");
if (toggleMentions) {
  toggleMentions.classList.toggle("active", highlightMentions);
  toggleMentions.addEventListener("click", () => {
    highlightMentions = !highlightMentions;
    toggleMentions.classList.toggle("active", highlightMentions);
    try {
      window.localStorage.setItem(MENTIONS_STORAGE_KEY, String(highlightMentions));
    } catch (_) {}
    renderMessages();
    broadcast({ type: "highlightMentions", value: highlightMentions });
  });
}

const fontSlider = document.getElementById("font-size");
if (fontSlider) {
  const valueEl = document.getElementById("font-size-value");
  const syncValue = () => {
    valueEl.textContent = `${fontSlider.value}px`;
  };
  fontSlider.value = chatFontPx || 16;
  syncValue();
  fontSlider.addEventListener("input", () => {
    applyChatFont(Number(fontSlider.value));
    syncValue();
    try {
      window.localStorage.setItem(CHAT_FONT_STORAGE_KEY, String(chatFontPx));
    } catch (_) {}
    broadcast({ type: "chatFont", value: chatFontPx });
  });
}

const toggleClock = document.getElementById("toggle-clock");
if (toggleClock) {
  toggleClock.classList.toggle("active", use24hClock);
  toggleClock.addEventListener("click", () => {
    use24hClock = !use24hClock;
    toggleClock.classList.toggle("active", use24hClock);
    try {
      window.localStorage.setItem(CLOCK_STORAGE_KEY, String(use24hClock));
    } catch (_) {}
    renderMessages();
    broadcast({ type: "use24hClock", value: use24hClock });
  });
}

const toggleBadges = document.getElementById("toggle-badges");
if (toggleBadges) {
  toggleBadges.classList.toggle("active", showBadges);
  toggleBadges.addEventListener("click", () => {
    showBadges = !showBadges;
    toggleBadges.classList.toggle("active", showBadges);
    try {
      window.localStorage.setItem(BADGES_STORAGE_KEY, String(showBadges));
    } catch (_) {}
    renderMessages();
    broadcast({ type: "showBadges", value: showBadges });
  });
}

const toggleEmotes = document.getElementById("toggle-emotes");
if (toggleEmotes) {
  toggleEmotes.classList.toggle("active", showThirdPartyEmotes);
  toggleEmotes.addEventListener("click", () => {
    showThirdPartyEmotes = !showThirdPartyEmotes;
    toggleEmotes.classList.toggle("active", showThirdPartyEmotes);
    try {
      window.localStorage.setItem(THIRD_PARTY_EMOTES_STORAGE_KEY, String(showThirdPartyEmotes));
    } catch (_) {}
    renderMessages();
    broadcast({ type: "showThirdPartyEmotes", value: showThirdPartyEmotes });
  });
}

if (togglePlatform) {
  togglePlatform.classList.toggle("active", showPlatform);
  togglePlatform.addEventListener("click", () => {
    showPlatform = !showPlatform;
    togglePlatform.classList.toggle("active", showPlatform);
    try {
      window.localStorage.setItem(PLATFORM_STORAGE_KEY, String(showPlatform));
    } catch (_) {}
    renderMessages();
    broadcast({ type: "showPlatform", value: showPlatform });
  });
}

// Stream player (popout + expanded chat). Twitch embeds require HTTPS (localhost excepted).
const PLAYER_STORAGE_KEY = "popoutPlayer";
const PLAYER_PLATFORMS = ["twitch", "youtube"];

// Embed URL for a platform, or null when it can't be played right now.
function playerEmbedSrc(platform) {
  const channel = playerState.channels[platform];
  if (!channel) return null;
  switch (platform) {
    case "twitch":
      return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(window.location.hostname)}&muted=true&autoplay=true`;
    case "youtube": {
      const videoId = state.statuses.get("youtube")?.video_id;
      return videoId
        ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1`
        : null;
    }
  }
  return null;
}

const playerPaneEl = document.getElementById("player-pane");
const playerFrameEl = document.getElementById("player-frame");
const playerToggleEl = document.getElementById("player-toggle");
const playerSourcesEl = document.getElementById("player-sources");

const playerState = { open: false, source: null, channels: {} };
try {
  const stored = JSON.parse(window.localStorage.getItem(PLAYER_STORAGE_KEY) || "{}");
  playerState.open = Boolean(stored.open);
  playerState.source = stored.source || null;
} catch (_) {}

function savePlayerState() {
  try {
    window.localStorage.setItem(
      PLAYER_STORAGE_KEY,
      JSON.stringify({ open: playerState.open, source: playerState.source })
    );
  } catch (_) {}
}

function renderPlayer() {
  if (!playerPaneEl || isOverlay) return; // no player inside an OBS overlay
  if (!isPopout && !isExpanded) {
    // Player only lives in the expanded chat on the main page; drop any playing iframe.
    playerPaneEl.classList.add("hidden");
    playerSourcesEl.classList.add("hidden");
    playerFrameEl.innerHTML = "";
    return;
  }
  const available = PLAYER_PLATFORMS.filter((platform) => playerEmbedSrc(platform) !== null);
  if (!available.includes(playerState.source)) {
    playerState.source = available[0] || null;
  }

  playerSourcesEl.classList.toggle("hidden", !playerState.open || !available.length);
  playerSourcesEl.innerHTML = available.map((platform) => `
    <button class="player-source${platform === playerState.source ? " active" : ""}" data-platform="${platform}"
      type="button" title="Watch on ${PLATFORM_NAMES[platform]}">${PLATFORM_SVGS[platform]}</button>
  `).join("");

  playerToggleEl.textContent = playerState.open ? "✕" : "▶";
  playerToggleEl.title = playerState.open ? "Close stream player" : "Show stream player";
  playerPaneEl.classList.toggle("hidden", !playerState.open);

  if (!playerState.open) {
    playerFrameEl.innerHTML = ""; // drop the iframe so playback (and audio) stops
    return;
  }
  if (!playerState.source) {
    playerFrameEl.innerHTML = `<div class="player-empty">Connect a live Twitch or YouTube channel to watch the stream here.</div>`;
    return;
  }
  const src = playerEmbedSrc(playerState.source);
  // Reloading the iframe restarts playback (and Twitch pre-rolls) — skip if unchanged.
  if (playerFrameEl.querySelector("iframe")?.src === src) return;
  playerFrameEl.innerHTML = `<iframe src="${escapeHtml(src)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
}

if (playerToggleEl) {
  playerToggleEl.addEventListener("click", () => {
    playerState.open = !playerState.open;
    savePlayerState();
    renderPlayer();
  });
  playerSourcesEl.addEventListener("click", (event) => {
    const button = event.target.closest(".player-source");
    if (!button) return;
    playerState.source = button.dataset.platform;
    savePlayerState();
    renderPlayer();
  });
}

// Alert sounds: hidden alert-overlay iframes in the popout and expanded chat; URLs stay in the browser.
const ALERTS_STORAGE_KEY = "alertUrls";

function isValidAlertUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch (_) {
    return false;
  }
}

function storedAlertUrls() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERTS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isValidAlertUrl) : [];
  } catch (_) {
    return [];
  }
}

const alertsEditBtn = document.getElementById("alerts-edit");
if (alertsEditBtn) {
  const editorEl = document.getElementById("alerts-editor");
  const rowsEl = document.getElementById("alerts-rows");
  const applyBtn = document.getElementById("alerts-apply");

  const syncEditButton = () => {
    const count = storedAlertUrls().length;
    alertsEditBtn.textContent = count ? `✎ ${count}` : "+ Add";
    alertsEditBtn.title = count ? "Edit alert sound overlays" : "Add alert sound overlays (StreamElements etc.)";
  };

  const addRow = (value = "") => {
    const row = document.createElement("div");
    row.className = "alerts-row";
    row.innerHTML = `
      <input class="input-field alerts-input" type="url" placeholder="https://streamelements.com/overlay/…" spellcheck="false">
      <button class="channel-clear alerts-remove" type="button" title="Remove">&#x2715;</button>`;
    row.querySelector("input").value = value;
    rowsEl.appendChild(row);
  };

  alertsEditBtn.addEventListener("click", () => {
    if (editorEl.classList.contains("hidden")) {
      rowsEl.innerHTML = "";
      const urls = storedAlertUrls();
      (urls.length ? urls : [""]).forEach(addRow);
      editorEl.classList.remove("hidden");
      rowsEl.querySelector("input")?.focus();
    } else {
      editorEl.classList.add("hidden"); // discard edits; reopening re-reads saved state
    }
  });

  rowsEl.addEventListener("click", (event) => {
    const remove = event.target.closest(".alerts-remove");
    if (!remove) return;
    remove.closest(".alerts-row").remove();
    // Removing the last row deletes the saved list and closes the editor.
    if (!rowsEl.children.length) {
      try {
        window.localStorage.setItem(ALERTS_STORAGE_KEY, "[]");
      } catch (_) {}
      broadcast({ type: "alertUrls", urls: [] });
      applyMainAlerts([]);
      editorEl.classList.add("hidden");
      syncEditButton();
    }
  });

  rowsEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyBtn.click();
    }
  });

  document.getElementById("alerts-add-row").addEventListener("click", () => {
    addRow();
    rowsEl.lastElementChild.querySelector("input").focus();
  });

  applyBtn.addEventListener("click", () => {
    let valid = true;
    const urls = [];
    for (const input of rowsEl.querySelectorAll(".alerts-input")) {
      const value = input.value.trim();
      input.classList.remove("invalid");
      if (!value) continue;
      if (isValidAlertUrl(value)) {
        urls.push(value);
      } else {
        input.classList.add("invalid");
        valid = false;
      }
    }
    if (!valid) return;
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(urls));
    } catch (_) {}
    broadcast({ type: "alertUrls", urls });
    applyMainAlerts(urls);
    editorEl.classList.add("hidden");
    syncEditButton();
  });

  syncEditButton();
}

// One-click sound unlock; any click on the page counts.
const alertFramesEl = document.getElementById("alert-frames");
const alertsUnlockEl = document.getElementById("alerts-unlock");
let alertUrls = [];
let alertAudioUnlocked = false;

function renderAlertFrames() {
  if (!alertFramesEl || isOverlay) return;
  for (const frame of [...alertFramesEl.children]) {
    if (!alertUrls.includes(frame.src)) frame.remove();
  }
  const existing = new Set([...alertFramesEl.children].map((frame) => frame.src));
  for (const url of alertUrls) {
    if (existing.has(url)) continue;
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.allow = "autoplay";
    frame.tabIndex = -1;
    alertFramesEl.appendChild(frame);
  }
  updateAlertUnlock();
}

function unlockAlertAudio() {
  alertAudioUnlocked = true;
  updateAlertUnlock();
  for (const frame of alertFramesEl?.children || []) {
    frame.contentWindow?.postMessage({ type: "unlock-audio" }, "*");
  }
}

function updateAlertUnlock() {
  alertsUnlockEl?.classList.toggle("hidden", alertAudioUnlocked || !alertUrls.length);
}

if (alertsUnlockEl) {
  alertsUnlockEl.addEventListener("click", unlockAlertAudio);
  const onFirstGesture = () => {
    if (!alertUrls.length) return;
    unlockAlertAudio();
    document.removeEventListener("pointerdown", onFirstGesture);
  };
  document.addEventListener("pointerdown", onFirstGesture);
}

// Saved edits replace any legacy &alerts= in the address bar and refresh the expanded chat.
function applyMainAlerts(urls) {
  if (isPopout) return;
  const params = new URLSearchParams(window.location.search);
  if (params.has("alerts")) {
    params.delete("alerts");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }
  if (!isExpanded) return;
  alertUrls = urls;
  renderAlertFrames();
}

// Mirrors alert URLs into the address bar so the link stays standalone.
function applyPopoutAlerts(urls) {
  alertUrls = (urls || []).filter(isValidAlertUrl);
  renderAlertFrames();
  const params = new URLSearchParams(window.location.search);
  params.delete("alerts");
  for (const url of alertUrls) params.append("alerts", url);
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

// OBS monitor: read-only stream health straight from OBS's built-in WebSocket
// server (obs-websocket v5). The browser talks to OBS directly, so the address
// and password never leave this machine and the chat works the same without it.
const OBS_STORAGE_KEY = "obsMonitor";
const OBS_DEFAULT_URL = "ws://localhost:4455";
const OBS_POLL_MS = 2000;
const OBS_RETRY_MS = 5000;
const OBS_DROP_ALERT_MS = 15000; // how long a fresh drop keeps the badge amber
const OBS_AUTH_FAILED = 4009;

// SHA-256 in plain JS: crypto.subtle only exists on secure origins, and this
// page is often opened as http://<lan-ip>:8100.
const SHA256_PRIMES = (() => {
  const primes = [];
  for (let n = 2; primes.length < 64; n += 1) {
    if (primes.every((p) => n % p)) primes.push(n);
  }
  return primes;
})();
const SHA256_K = SHA256_PRIMES.map((p) => Math.floor((Math.cbrt(p) % 1) * 2 ** 32));
const SHA256_H = SHA256_PRIMES.slice(0, 8).map((p) => Math.floor((Math.sqrt(p) % 1) * 2 ** 32));

function sha256Base64(text) {
  const input = new TextEncoder().encode(text);
  const padded = new Uint8Array(((input.length + 9 + 63) >> 6) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(input.length / 2 ** 29));
  view.setUint32(padded.length - 4, (input.length << 3) >>> 0);

  const h = SHA256_H.slice();
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => { h[i] = (h[i] + value) >>> 0; });
  }
  const digest = new Uint8Array(32);
  h.forEach((value, i) => new DataView(digest.buffer).setUint32(i * 4, value));
  return btoa(String.fromCharCode(...digest));
}

function storedObsConfig() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OBS_STORAGE_KEY) || "null");
    return parsed && typeof parsed.url === "string" && parsed.url ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isValidObsUrl(value) {
  try {
    return ["ws:", "wss:"].includes(new URL(value).protocol);
  } catch (_) {
    return false;
  }
}

class ObsMonitor {
  constructor() {
    this.config = null;
    this.socket = null;
    this.retryTimer = 0;
    this.pollTimer = 0;
    this.reset("off");
  }

  reset(phase) {
    this.phase = phase; // off | connecting | offline | auth | ready
    this.stream = null;
    this.stats = null;
    this.sample = null; // { bytes, at } for the bitrate delta
    this.kbps = null;
    this.lastDropAt = 0;
  }

  configure(config) {
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.config = config;
    this.reset(config ? "connecting" : "off");
    this.render();
    if (config) this.connect();
  }

  connect() {
    let socket;
    try {
      socket = new WebSocket(this.config.url);
    } catch (_) {
      this.reset("offline");
      this.render();
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      this.handleFrame(socket, frame);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pollTimer);
      const authFailed = event.code === OBS_AUTH_FAILED;
      this.reset(authFailed ? "auth" : "offline");
      this.render();
      // A wrong password will not fix itself; everything else (OBS closed,
      // server disabled) is worth retrying quietly.
      if (!authFailed) this.retryTimer = setTimeout(() => this.connect(), OBS_RETRY_MS);
    });
  }

  handleFrame(socket, frame) {
    const data = frame.d || {};
    if (frame.op === 0) { // Hello
      const identify = { rpcVersion: 1, eventSubscriptions: 0 };
      if (data.authentication) {
        const secret = sha256Base64((this.config.password || "") + data.authentication.salt);
        identify.authentication = sha256Base64(secret + data.authentication.challenge);
      }
      socket.send(JSON.stringify({ op: 1, d: identify }));
    } else if (frame.op === 2) { // Identified
      this.phase = "ready";
      this.poll();
      this.pollTimer = setInterval(() => this.poll(), OBS_POLL_MS);
    } else if (frame.op === 7 && data.requestStatus?.result) { // RequestResponse
      if (data.requestType === "GetStreamStatus") this.onStreamStatus(data.responseData || {});
      if (data.requestType === "GetStats") this.stats = data.responseData || {};
      this.render();
    }
  }

  poll() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    for (const requestType of ["GetStats", "GetStreamStatus"]) {
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId: requestType } }));
    }
  }

  onStreamStatus(status) {
    const now = performance.now();
    const previous = this.stream;
    if (status.outputActive) {
      const bytes = Number(status.outputBytes) || 0;
      // The byte counter restarts with every stream; skip the sample that spans a restart.
      if (this.sample && bytes >= this.sample.bytes && now > this.sample.at) {
        this.kbps = ((bytes - this.sample.bytes) * 8) / (now - this.sample.at);
      }
      this.sample = { bytes, at: now };
      if (previous?.outputActive && status.outputSkippedFrames > previous.outputSkippedFrames) {
        this.lastDropAt = now;
      }
    } else {
      this.sample = null;
      this.kbps = null;
      this.lastDropAt = 0;
    }
    this.stream = status;
  }

  // -> { text, level, title }, or null when the monitor is switched off.
  view() {
    switch (this.phase) {
      case "off":
        return null;
      case "connecting":
        return { text: "OBS…", level: "idle", title: `Connecting to OBS at ${this.config.url}` };
      case "offline":
        return {
          text: "OBS offline", level: "idle",
          title: `No answer from ${this.config.url}. Is OBS running with Tools → WebSocket Server Settings → Enable?`,
        };
      case "auth":
        return { text: "OBS: wrong password", level: "error", title: "OBS rejected the password. Fix it under Settings → OBS monitor." };
    }
    const stream = this.stream;
    if (!stream) return { text: "OBS…", level: "idle", title: "Connected to OBS, waiting for data" };
    if (!stream.outputActive) return { text: "OBS: not live", level: "idle", title: "Connected to OBS. The stream is not running." };

    const dropped = stream.outputSkippedFrames || 0;
    const total = stream.outputTotalFrames || 0;
    const percent = total ? (dropped / total) * 100 : 0;
    const bitrate = this.kbps === null ? "…" : Math.round(this.kbps).toLocaleString();
    let level = "ok";
    if (this.lastDropAt && performance.now() - this.lastDropAt < OBS_DROP_ALERT_MS) level = "warn";
    if (stream.outputReconnecting) level = "error";

    const stats = this.stats || {};
    const title = [
      stream.outputReconnecting ? "OBS is reconnecting to the streaming server!" : `Live for ${stream.outputTimecode?.split(".")[0] || "?"}`,
      `Dropped frames (network): ${dropped.toLocaleString()} of ${total.toLocaleString()} (${percent.toFixed(1)}%)`,
      `Skipped frames (encoder lag, since OBS started): ${(stats.outputSkippedFrames ?? 0).toLocaleString()}`,
      `Missed frames (render lag, since OBS started): ${(stats.renderSkippedFrames ?? 0).toLocaleString()}`,
      `Congestion: ${Math.round((stream.outputCongestion || 0) * 100)}%`,
      typeof stats.cpuUsage === "number" ? `OBS CPU: ${stats.cpuUsage.toFixed(1)}%   FPS: ${(stats.activeFps || 0).toFixed(0)}` : "",
    ].filter(Boolean).join("\n");
    return {
      text: stream.outputReconnecting
        ? "OBS reconnecting…"
        : `${bitrate} kbps · ${dropped.toLocaleString()} dropped (${percent.toFixed(1)}%)`,
      level,
      title,
    };
  }

  render() {
    const view = this.view();
    for (const badge of document.querySelectorAll(".obs-badge")) {
      badge.classList.toggle("hidden", !view);
      if (!view) continue;
      badge.dataset.level = view.level;
      badge.title = view.title;
      badge.innerHTML = `<span class="status-dot ${view.level}" aria-hidden="true"></span>${escapeHtml(view.text)}`;
    }
  }
}

const obsMonitor = new ObsMonitor();

function applyObsConfig(config) {
  if (isOverlay) return; // nothing to monitor inside the OBS browser source itself
  obsMonitor.configure(config && isValidObsUrl(config.url) ? config : null);
}

const obsEditBtn = document.getElementById("obs-edit");
if (obsEditBtn) {
  const editorEl = document.getElementById("obs-editor");
  const urlEl = document.getElementById("obs-url");
  const passwordEl = document.getElementById("obs-password");

  const syncEditButton = () => {
    obsEditBtn.textContent = storedObsConfig() ? "✎ On" : "+ Add";
  };
  const save = (config) => {
    try {
      if (config) {
        window.localStorage.setItem(OBS_STORAGE_KEY, JSON.stringify(config));
      } else {
        window.localStorage.removeItem(OBS_STORAGE_KEY);
      }
    } catch (_) {}
    broadcast({ type: "obsMonitor", config });
    applyObsConfig(config);
    editorEl.classList.add("hidden");
    syncEditButton();
  };

  obsEditBtn.addEventListener("click", () => {
    if (!editorEl.classList.toggle("hidden")) {
      const config = storedObsConfig();
      urlEl.value = config?.url || OBS_DEFAULT_URL;
      passwordEl.value = config?.password || "";
      urlEl.classList.remove("invalid");
      (config ? urlEl : passwordEl).focus();
    }
  });
  document.getElementById("obs-apply").addEventListener("click", () => {
    const url = urlEl.value.trim() || OBS_DEFAULT_URL;
    urlEl.classList.toggle("invalid", !isValidObsUrl(url));
    if (isValidObsUrl(url)) save({ url, password: passwordEl.value });
  });
  document.getElementById("obs-remove").addEventListener("click", () => save(null));
  editorEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("obs-apply").click();
    }
  });
  syncEditButton();
}

applyObsConfig(storedObsConfig());

function channelsFromLocation() {
  const params = new URLSearchParams(window.location.search);
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem("channels") || "{}");
  } catch (_) {}
  // A shared link (URL params) wins over what this browser last watched.
  const fromUrl = PLATFORMS.some((platform) => params.has(platform));
  return Object.fromEntries(
    PLATFORMS.map((platform) => [platform, ((fromUrl ? params.get(platform) : stored[platform]) || "").trim()])
  );
}

function restoreChannels() {
  const channels = channelsFromLocation();
  for (const platform of PLATFORMS) {
    channelInputs[platform].value = channels[platform];
  }
  if (PLATFORMS.some((platform) => channelInputs[platform].value)) {
    connectFromInputs({ updateUrl: false });
  }
}

// Subscribes the popout's own hub connection and mirrors channels into the URL.
function applyPopoutChannels(channels) {
  hubConnection.setChannels(channels);
  playerState.channels = channels;
  updateMentionRegex(channels);
  resetHypeTrainBar();
  renderPlayer();
  // Start from the current query so non-channel params (overlay, fade) survive.
  const params = new URLSearchParams(window.location.search);
  for (const platform of PLATFORMS) {
    if (channels[platform]) {
      params.set(platform, channels[platform]);
    } else {
      params.delete(platform);
    }
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

renderMessages();

if (isPopout) {
  const channels = channelsFromLocation();
  if (Object.values(channels).some(Boolean)) {
    applyPopoutChannels(channels);
  } else {
    renderPlayer(); // restore the toggle/open state even with nothing to watch
  }
  if (!isOverlay) {
    const fromUrl = pageParams.getAll("alerts").filter(isValidAlertUrl);
    alertUrls = fromUrl.length ? fromUrl : storedAlertUrls();
    renderAlertFrames();
  }
  if (isOverlay && !OVERLAY_NEVER_FADE) {
    // A card that has finished fading is gone for good: drop its node and its
    // message, so nothing has to sweep the feed on a timer.
    feedEl.addEventListener("animationend", (event) => {
      const card = event.target;
      if (event.animationName !== overlayStyle.exitAnimation || !card.classList?.contains("message-card")) return;
      const id = card.dataset.id;
      removeCard(card);
      state.messages = state.messages.filter((message) => message.id !== id);
    });
  }
} else {
  renderStatuses();
  restoreChannels();
  updateObsLink();
  if (isExpanded) {
    alertUrls = mainAlertUrls();
    renderAlertFrames();
  }
  renderPlayer(); // restore the toggle/open state even with nothing to watch
}
