// Render regression check. Run in the page context of /popout (DevTools
// console, or any browser automation) and read the returned object.
// Budget: perMessageMs <= 0.3 with a 200-message feed. Measures script +
// style + layout; a hidden tab is fine, but give the window a real size.
(() => {
  const EMOTE = "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0";
  const words = "hello chat this is message number with some more words LUL Kappa PogChamp really long text to wrap around the line a few times".split(" ");
  const make = (i) => ({
    platform: ["twitch", "youtube"][i % 2], id: `bench${i}`, channel: "bench", author: `user${i}`,
    color: "#3366ff", badges: ["subscriber/12", "moderator/1"], text: `Kappa ${words.slice(i % 7, 8 + (i % 14)).join(" ")}`,
    emotes: [{ id: "25", begin: 0, end: 5, text: "Kappa" }], timestamp: Date.now(), deleted: false, kind: "chat",
    avatar_url: "", source_name: "", bits: 0, notice: "",
  });
  thirdPartyEmotes.set("twitch", new Map([["LUL", EMOTE], ["PogChamp", EMOTE]]));
  const ids = () => [...feedEl.children].map((card) => card.dataset.id);
  const checks = {};

  state.messages = Array.from({ length: 200 }, (_, i) => make(i));
  pinnedToBottom = true;
  renderMessages();

  // Steady stream: 300 messages, flushed 10 at a time (what one frame sees at 600 msg/s).
  const N = 300;
  const start = performance.now();
  for (let i = 0; i < N; i += 1) {
    addMessage(make(1000 + i));
    if (i % 10 === 9) flushPending();
  }
  void feedEl.scrollHeight;
  const perMessageMs = (performance.now() - start) / N;

  checks.windowHolds200 = feedEl.childElementCount === 200 && cardById.size === 200;
  checks.newestIsLast = ids().at(-1) === "bench1299" && ids()[0] === "bench1100";

  // A burst far larger than the window lands in one flush.
  for (let i = 0; i < 1000; i += 1) addMessage(make(5000 + i));
  flushPending();
  checks.burstKeepsNewestWindow = feedEl.childElementCount === 200 && ids().at(-1) === "bench5999" && ids()[0] === "bench5800";

  // Deleting a rendered card and one still waiting in the pending batch.
  addMessage(make(7000));
  markDeleted(["bench5999", "bench7000"]);
  flushPending();
  checks.deleteRendered = cardById.get("bench5999").classList.contains("deleted");
  checks.deletePending = cardById.get("bench7000").classList.contains("deleted");

  // Filtered platforms stay out of the feed but in state.
  state.filters.youtube = false;
  addMessage(make(8001)); // odd -> youtube
  flushPending();
  checks.filteredSkipped = !cardById.has("bench8001") && state.messages.some((m) => m.id === "bench8001");
  state.filters.youtube = true;

  // Scrolled-up readers keep a longer backlog and get a counter instead of a jump.
  pinnedToBottom = false;
  unseenCount = 0;
  for (let i = 0; i < 300; i += 1) addMessage(make(9000 + i));
  flushPending();
  checks.scrolledUpKeepsBacklog = feedEl.childElementCount === 500 && unseenCount === 300;
  pinnedToBottom = true;
  addMessage(make(9999));
  flushPending();
  checks.pinnedTrimsBack = feedEl.childElementCount === 200;

  state.messages = [];
  renderMessages();
  checks.emptyState = feedEl.querySelector(".empty-state") !== null && cardById.size === 0;

  return {
    perMessageMs: Number(perMessageMs.toFixed(3)),
    withinBudget: perMessageMs <= 0.3,
    checks,
    allChecksPass: Object.values(checks).every(Boolean),
    viewport: [innerWidth, innerHeight],
  };
})();
