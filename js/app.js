/* Azure Echo — page, game flow, saving, and the optional C# leaderboard. */

const SAVE_KEY = "azure-echo-save-v2";
const BACKGROUNDS = ["shallow_reef", "twilight_zone", "midnight_trench", "abyssal_current"];
const SFX = { signal: "signal_chime.mp3", success: "success_chime.mp3", mistake: "mistake_cue.mp3" };
const $ = (id) => document.getElementById(id);

/* ---------- saved data ---------- */
function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    return {
      progress: normalizeProgress(raw.progress),
      scores: Array.isArray(raw.scores) ? raw.scores.slice(0, 10) : [],
      name: typeof raw.name === "string" ? raw.name.slice(0, 20) : "",
      sound: raw.sound !== false,
      token: typeof raw.token === "string" ? raw.token : "",
      user: typeof raw.user === "string" ? raw.user : "",
    };
  } catch { return { progress: emptyProgress(), scores: [], name: "", sound: true, token: "", user: "" }; }
}
const save = loadSave();
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode: ignore */ }
}

/* ---------- optional C# server (accounts + global leaderboard) ---------- */
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const apiBase = (API_URL || (isLocal ? "http://localhost:8080" : "")).replace(/\/$/, "");

/** Talk to the server. Never throws: returns { ok, status, data }. */
async function apiFetch(path, method = "GET", body) {
  if (!apiBase) return { ok: false, status: 0, data: null };
  try {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (save.token) headers.Authorization = `Bearer ${save.token}`;
    const res = await fetch(`${apiBase}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

async function apiGetScores() {
  const r = await apiFetch("/api/scores");
  return r.ok && Array.isArray(r.data) ? r.data : null;
}

/** Push this device's progress to the account and take back the merged result. */
async function syncProgress() {
  if (!save.token) return;
  const r = await apiFetch("/api/progress", "PUT", { progress: save.progress });
  if (r.ok && r.data) {
    save.progress = mergeProgress(save.progress, r.data);
    persist();
    if (location.hash === "#zones") renderZones();
  } else if (r.status === 401) signOutLocal();
}

/* ---------- small helpers ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString("en-US");
const pad2 = (n) => String(n).padStart(2, "0");

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function setBackground(i) {
  $("bg").style.backgroundImage = `url('assets/${BACKGROUNDS[Math.min(3, Math.max(0, i))]}.webp')`;
}

function playSound(type, padIndex = 0) {
  if (!save.sound || !SFX[type]) return;
  const audio = new Audio(`assets/${SFX[type]}`);
  audio.volume = type === "signal" ? 0.42 : 0.56;
  audio.playbackRate = type === "signal" ? 2 + padIndex * 0.14 : type === "success" ? 1.65 : 1.9;
  audio.play().catch(() => {});
}

/* ---------- game state ---------- */
const game = {
  zone: 0, endless: false, round: 0, score: 0,
  sequence: [], expected: [], inputIndex: 0, playback: null,
  phase: "idle",            // idle | playback | input | done
  replays: 0, skips: 0,
  token: 0, timerId: 0, nextId: 0, timeTotal: null, started: false,
};

function stopRun() {
  game.token += 1;
  clearInterval(game.timerId);
  clearTimeout(game.nextId);
  game.phase = "idle";
}

/* ---------- views / routing ---------- */
const VIEWS = ["home", "zones", "play", "story", "leaderboard"];

function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  if (name !== "play") stopRun();
  if (name === "play" && (!game.started || (game.phase === "idle" && !$("play-board").hidden))) {
    location.hash = "#zones"; // nothing running: send the player to pick a zone
    return;
  }
  VIEWS.forEach((v) => { $(v).hidden = v !== name; });
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name || (name === "play" && a.dataset.nav === "zones")));
  if (name === "home") setBackground(0);
  if (name === "zones") { renderZones(); setBackground(save.progress.unlockedZone); }
  if (name === "story") setBackground(1);
  if (name === "leaderboard") { renderLeaderboard(); setBackground(save.progress.unlockedZone); }
  window.scrollTo({ top: 0 });
}

/* ---------- zones page ---------- */
function renderZones() {
  const p = save.progress;
  $("zone-grid").innerHTML = ZONES.map((z, i) => {
    const locked = i > p.unlockedZone;
    const best = p.bestRounds[i];
    const status = locked ? "LOCKED" : best >= z.roundsToClear ? "CLEARED ✦" : best ? `BEST ROUND ${pad2(best)}` : "OPEN";
    return `<article class="zone ${locked ? "locked" : ""}" style="background-image: linear-gradient(180deg, rgba(4,19,30,.2), rgba(4,19,30,.92)), url('assets/${BACKGROUNDS[i]}.webp')">
      <div class="zone-top"><span>${z.depth}</span><span>${status}</span></div>
      <div class="zone-body"><h2>${z.name}</h2><p>${z.note}</p>
        <button class="btn ${locked ? "" : "primary"}" type="button" data-zone="${i}" ${locked ? "disabled" : ""}>${locked ? "Reach the zone above" : best >= z.roundsToClear ? "Return to this zone" : "Enter this zone →"}</button>
      </div></article>`;
  }).join("");
  $("endless-box").hidden = !p.endlessUnlocked;
}

$("zone-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-zone]");
  if (btn && !btn.disabled) openZone(Number(btn.dataset.zone), false);
});
$("endless-btn").addEventListener("click", () => openZone(3, true));

/* ---------- opening a zone ---------- */
function showPanel(name) {
  $("play-intro").hidden = name !== "intro";
  $("play-board").hidden = name !== "board";
  $("play-result").hidden = name !== "result";
}

function openZone(index, endless) {
  stopRun();
  const z = ZONES[index];
  Object.assign(game, { zone: index, endless, round: 0, score: 0, sequence: [], expected: [], inputIndex: 0, playback: null,
    replays: POWER_REPLAYS, skips: POWER_SKIPS, started: true });
  $("intro-depth").textContent = z.depth + (endless ? " · ENDLESS" : "");
  $("intro-title").innerHTML = `${z.name}<br /><em>listens.</em>`;
  $("intro-text").textContent = z.intro;
  $("intro-twist").textContent = endless ? "Endless: every twist returns and never stops." : z.twist;
  showPanel("intro");
  setBackground(index);
  if (location.hash !== "#play") location.hash = "#play"; else route();
}

$("start-btn").addEventListener("click", () => {
  showPanel("board");
  startRound();
});

/* ---------- a round ---------- */
function setPhase(phase, title, text) {
  game.phase = phase;
  $("phase-title").textContent = title;
  $("phase-text").textContent = text;
  document.querySelectorAll(".pad").forEach((p) => { p.disabled = phase !== "input"; });
  $("replay-btn").disabled = phase !== "input" || game.replays <= 0;
  $("skip-btn").disabled = phase !== "input" || game.skips <= 0;
  $("input-count").textContent = phase === "input" ? `${game.inputIndex} / ${game.expected.length}` : `${game.sequence.length} signals`;
}

function updateHud() {
  const z = ZONES[game.zone];
  $("hud-zone").textContent = z.name;
  $("hud-round").textContent = game.endless ? `${game.round} ∞` : `${game.round} / ${z.roundsToClear}`;
  $("hud-score").textContent = fmt(game.score);
  $("replay-left").textContent = game.replays;
  $("skip-left").textContent = game.skips;
}

function startRound() {
  const z = ZONES[game.zone];
  if (!game.endless && game.round >= z.roundsToClear) return clearZone();
  game.round += 1;
  game.sequence = appendSignal(game.sequence);
  game.playback = buildPlayback(game.sequence, { zoneIndex: game.zone, round: game.round, endless: game.endless });
  game.expected = [...game.playback.expected];
  game.timeTotal = secondsForInput(game.round, game.zone);
  updateHud();
  playSequence(game.playback, game.token);
}

function flashPad(index, kind) {
  const pad = document.querySelector(`[data-pad="${index}"]`);
  if (!pad) return;
  playSound("signal", index);
  if (kind === "mimic") {
    // a Glint Eel light: a quick double stutter
    pad.classList.add("lit", "mimic");
    setTimeout(() => pad.classList.remove("lit"), 110);
    setTimeout(() => pad.classList.add("lit"), 200);
    setTimeout(() => pad.classList.remove("lit", "mimic"), 330);
    return;
  }
  pad.classList.add("lit");
  setTimeout(() => pad.classList.remove("lit"), 280);
}

async function playSequence(playback, token) {
  game.inputIndex = 0;
  $("ring").classList.toggle("dark", playback.dark);
  $("timer").hidden = !game.timeTotal;
  if (game.timeTotal) $("timer-fill").style.width = "100%";
  setPhase("playback", playback.dark ? "Listen closely" : "Watch the light",
    playback.dark ? "The water is dark. Listen, remember, then answer." : "Let the whole signal reach you before you answer.");
  const tempo = game.zone === 0 ? 660 : game.zone === 1 ? 500 : 540;
  await wait(500);
  for (const ev of playback.events) {
    if (token !== game.token) return;
    if (playback.dark) playSound("signal", ev.padIndex); else flashPad(ev.padIndex, ev.kind);
    await wait(tempo + (ev.kind === "mimic" ? 100 : 0));
  }
  if (token !== game.token) return;
  setPhase("input", "Your turn",
    playback.dark ? "The lights are hidden. Follow the tones."
      : game.playback.reversed ? "Repeat the true lights in REVERSE. Let any stuttering light pass."
      : "Repeat the lights in order.");
  if (game.timeTotal) startTimer();
}

function startTimer() {
  clearInterval(game.timerId);
  const t0 = performance.now(), limit = game.timeTotal * 1000;
  game.timerId = setInterval(() => {
    const left = Math.max(0, limit - (performance.now() - t0));
    $("timer-fill").style.width = `${(left / limit) * 100}%`;
    if (left <= 0) failRun("The current moved on before Echo could answer.");
  }, 100);
}

function answer(padIndex) {
  if (game.phase !== "input") return;
  if (padIndex !== game.expected[game.inputIndex]) {
    playSound("mistake");
    if (navigator.vibrate) navigator.vibrate(35);
    return failRun(game.playback.hasMimic
      ? "A borrowed light slipped into the signal. Listen for the true pulse next time."
      : "The pulse drifted. Your zone stays open. Take a breath and follow it again.");
  }
  const pad = document.querySelector(`[data-pad="${padIndex}"]`);
  pad.classList.add("lit");
  setTimeout(() => pad.classList.remove("lit"), 220);
  playSound("signal", padIndex);
  game.inputIndex += 1;
  $("input-count").textContent = `${game.inputIndex} / ${game.expected.length}`;
  if (game.inputIndex === game.expected.length) {
    clearInterval(game.timerId);
    playSound("success");
    roundDone(false);
  }
}

function roundDone(skipped) {
  const pts = correctRoundPoints(game.sequence.length, game.round, skipped);
  game.score += pts;
  const p = save.progress;
  p.bestRounds[game.zone] = Math.max(p.bestRounds[game.zone], skipped ? game.round - 1 : game.round);
  p.bestScore = Math.max(p.bestScore, game.score);
  persist();
  syncProgress();
  updateHud();
  setPhase("done", skipped ? "A little further" : "The signal holds",
    skipped ? "Lumen carries this round forward." : "The ocean remembers. The signal grows by one light.");
  toast(skipped ? "Skipped · no points" : `+${fmt(pts)} points`);
  const next = !game.endless && game.round >= ZONES[game.zone].roundsToClear ? clearZone : startRound;
  game.nextId = setTimeout(next, 1100);
}

/* power-ups */
$("replay-btn").addEventListener("click", () => {
  if (game.phase !== "input" || game.replays <= 0) return;
  game.replays -= 1;
  clearInterval(game.timerId);
  updateHud();
  playSequence(game.playback, game.token);
  toast("Lumen replays the signal.");
});
$("skip-btn").addEventListener("click", () => {
  if (game.phase !== "input" || game.skips <= 0) return;
  game.skips -= 1;
  clearInterval(game.timerId);
  roundDone(true);
});
$("leave-btn").addEventListener("click", () => { stopRun(); location.hash = "#zones"; });

/* input */
$("ring").addEventListener("click", (e) => {
  const pad = e.target.closest(".pad");
  if (pad) answer(Number(pad.dataset.pad));
});
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (location.hash === "#play" && /^[1-6]$/.test(e.key)) answer(Number(e.key) - 1);
});

/* ---------- ending a run ---------- */
function resultButtons(buttons) {
  $("result-actions").innerHTML = buttons.map((b) =>
    b.href ? `<a class="btn ${b.primary ? "primary" : ""}" href="${b.href}">${b.label}</a>`
           : `<button class="btn ${b.primary ? "primary" : ""}" type="button" data-do="${b.id}">${b.label}</button>`).join("");
}

function showResult({ eyebrow, title, text, buttons }) {
  $("result-eyebrow").textContent = eyebrow;
  $("result-title").innerHTML = title;
  $("result-text").textContent = text;
  $("result-score").textContent = fmt(game.score);
  resultButtons(buttons);
  showPanel("result");
}

$("result-actions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-do]");
  if (!b) return;
  if (b.dataset.do === "retry") openZone(game.zone, game.endless);
  if (b.dataset.do === "next") openZone(game.zone + 1, false);
  if (b.dataset.do === "endless") openZone(3, true);
});

function recordScore(roundsDone) {
  const zoneName = game.endless ? "Endless Current" : ZONES[game.zone].name;
  const entry = { name: save.name || "Guest diver", score: game.score, zone: zoneName, round: Math.max(0, roundsDone) };
  if (entry.score > 0) {
    save.scores = [...save.scores, { ...entry, createdAt: new Date().toISOString() }]
      .sort((a, b) => b.score - a.score).slice(0, 10);
    if (save.token) apiFetch("/api/scores", "POST", { score: entry.score, zone: entry.zone, round: entry.round });
  }
  persist();
}

function failRun(message) {
  if (game.phase === "idle" || game.phase === "result") return;
  stopRun();
  game.phase = "result";
  recordScore(game.round - 1);
  setBackground(game.zone);
  showResult({
    eyebrow: `THE CURRENT TURNS · ${ZONES[game.zone].depth}`,
    title: "Hold onto<br /><em>the signal.</em>",
    text: message + (game.endless ? "" : " You restart from this zone's first round."),
    buttons: [{ id: "retry", label: `Return to ${ZONES[game.zone].name} ↻`, primary: true }, { href: "#zones", label: "Choose another zone" }, { href: "#leaderboard", label: "Top 10" }],
  });
}

function clearZone() {
  stopRun();
  game.phase = "result";
  const p = save.progress;
  p.bestRounds[game.zone] = Math.max(p.bestRounds[game.zone], ZONES[game.zone].roundsToClear);
  if (game.zone < 3) p.unlockedZone = Math.max(p.unlockedZone, game.zone + 1);
  const finished = game.zone === 3 && !game.endless;
  if (finished) p.endlessUnlocked = true;
  recordScore(game.round);
  persist();
  syncProgress();
  if (finished) {
    setBackground(3);
    showResult({
      eyebrow: "THE OCEAN FLOOR · THE SIGNAL SOURCE",
      title: "It was<br /><em>always home.</em>",
      text: "A slow, steady pulse answers Echo with the same rhythm it has carried since the first pattern. The water welcomes Echo into the deep. Endless Mode is now open.",
      buttons: [{ id: "endless", label: "Open the Endless Current ∞", primary: true }, { href: "#zones", label: "Back to the zones" }, { href: "#leaderboard", label: "Top 10" }],
    });
  } else {
    setBackground(game.zone + 1);
    showResult({
      eyebrow: `A PATH OPENS · ${ZONES[game.zone].depth}`,
      title: "The ocean<br /><em>answered.</em>",
      text: "Echo's light holds steady. A new current opens below, and the path you found stays yours.",
      buttons: [{ id: "next", label: `Continue to ${ZONES[game.zone + 1].name} →`, primary: true }, { href: "#zones", label: "Zone map" }, { href: "#leaderboard", label: "Top 10" }],
    });
  }
}

/* ---------- story + leaderboard pages ---------- */
$("twist-list").innerHTML = ZONES.map((z) =>
  `<li><b>${z.name}</b><span>${z.twist}</span></li>`).join("");

async function renderLeaderboard() {
  $("name-input").value = save.name;
  $("name-field").hidden = Boolean(save.user);
  const render = (rows) => {
    $("score-list").innerHTML = rows.length
      ? rows.map((r, i) => `<li><b>${pad2(i + 1)}</b><span class="who">${escapeHtml(r.name)}</span><span class="zn">${escapeHtml(r.zone)}</span><em>${fmt(r.score)}</em></li>`).join("")
      : `<li class="empty">No dives yet. Clear a round to put your name here.</li>`;
  };
  render(save.scores);
  $("board-source").textContent = save.user
    ? `Signed in as ${save.user}. Showing this device while the server loads…`
    : "Best scores on this device. Sign in to join the global board.";
  const global = await apiGetScores();
  if (global && location.hash === "#leaderboard") {
    render(global);
    $("board-source").textContent = "Best score of every signed-in diver.";
  } else if (save.user) {
    $("board-source").textContent = "Server unreachable. Showing scores on this device.";
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
$("name-input").addEventListener("input", (e) => { save.name = e.target.value.trim().slice(0, 20); persist(); });

/* ---------- sound button + start ---------- */
function paintSound() {
  $("sound-btn").textContent = save.sound ? "Sound on" : "Sound off";
  $("sound-btn").setAttribute("aria-pressed", String(save.sound));
}
$("sound-btn").addEventListener("click", () => { save.sound = !save.sound; persist(); paintSound(); });

/* ---------- account (sign in / create account) ---------- */
let authMode = "login";

function paintAccount() {
  $("account-btn").textContent = save.user ? `${save.user} · Sign out` : "Sign in";
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === "login";
  $("auth-title").textContent = login ? "Sign in" : "Create account";
  $("auth-submit").textContent = login ? "Sign in" : "Create account";
  $("auth-switch").textContent = login ? "New here? Create an account" : "Have an account? Sign in";
  $("auth-pass").autocomplete = login ? "current-password" : "new-password";
  $("auth-error").textContent = "";
}

function signOutLocal() {
  save.token = ""; save.user = "";
  persist(); paintAccount();
  if (location.hash === "#leaderboard") renderLeaderboard();
}

$("account-btn").addEventListener("click", async () => {
  if (save.user) {
    await apiFetch("/api/logout", "POST");
    signOutLocal();
    toast("Signed out. Your progress stays on this device.");
    return;
  }
  if (!apiBase) { toast("Accounts need the online server. You can still play as a guest."); return; }
  setAuthMode("login");
  $("auth-dialog").showModal();
  $("auth-user").focus();
});
$("auth-switch").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("auth-cancel").addEventListener("click", () => $("auth-dialog").close());

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("auth-user").value.trim(), password = $("auth-pass").value;
  $("auth-submit").disabled = true;
  $("auth-error").textContent = "";
  const r = await apiFetch(authMode === "login" ? "/api/login" : "/api/register", "POST", { username, password });
  $("auth-submit").disabled = false;
  if (!r.ok) {
    $("auth-error").textContent = r.data?.error || (r.status === 0 ? "Can't reach the server. Try again in a moment." : "Something went wrong.");
    return;
  }
  save.token = r.data.token;
  save.user = r.data.username;
  save.progress = mergeProgress(save.progress, r.data.progress);
  persist(); paintAccount();
  $("auth-pass").value = "";
  $("auth-dialog").close();
  toast(`Welcome, ${save.user}!`);
  await syncProgress();
  route();
});

async function restoreAccount() {
  if (!save.token) return;
  const r = await apiFetch("/api/me");
  if (r.ok && r.data) {
    save.user = r.data.username;
    save.progress = mergeProgress(save.progress, r.data.progress);
    persist(); paintAccount();
    syncProgress();
  } else if (r.status === 401) signOutLocal();
}

/* ---------- install as an app (PWA) ---------- */
let installEvent = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;

function showInstall(show) {
  document.querySelectorAll(".install-trigger").forEach((b) => { b.hidden = !show; });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; showInstall(true); });
window.addEventListener("appinstalled", () => { installEvent = null; showInstall(false); toast("Azure Echo is installed."); });
document.querySelectorAll(".install-trigger").forEach((b) => b.addEventListener("click", async () => {
  if (installEvent) { installEvent.prompt(); await installEvent.userChoice; installEvent = null; showInstall(false); }
  else if (isIos) toast("On iPhone/iPad: tap Share, then “Add to Home Screen”.");
}));
showInstall(isIos);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

paintSound();
paintAccount();
window.addEventListener("hashchange", route);
route();
restoreAccount();
