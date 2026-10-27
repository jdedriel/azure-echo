/* Azure Echo — pure game rules (no DOM here, so it is easy to test). */

const ZONES = [
  { id: "reef", name: "Shallow Reef", depth: "01 · THE SURFACE", note: "A first answer to the pulse.",
    intro: "A clear signal threads through the reef. Watch its lights, then answer in the same order.",
    twist: "Calm and untimed. Take all the time you need.", roundsToClear: 6 },
  { id: "twilight", name: "Twilight Zone", depth: "02 · THE BLUE HOUR", note: "The current is quickening.",
    intro: "The deep signal moves faster here. Keep your eye on the lights, and on the timer.",
    twist: "Faster lights and a countdown to answer.", roundsToClear: 6 },
  { id: "trench", name: "Midnight Trench", depth: "03 · BELOW THE SUN", note: "A reflection has learned to lie.",
    intro: "The sequence now travels backward. Glint Eels may borrow a signal; their lure stutters. Let the false light pass.",
    twist: "Repeat the pattern in reverse. Ignore stuttering Glint Eel lights.", roundsToClear: 6 },
  { id: "abyss", name: "Abyssal Current", depth: "04 · THE DEEP", note: "Listen for the way home.",
    intro: "Everything you have learned returns. Some rounds go dark; listen, hold the pattern, and let the eel-light pass.",
    twist: "Reverse order, trick lights and dark rounds with sound only.", roundsToClear: 6 },
];

const PAD_COUNT = 6;
const POWER_REPLAYS = 2;
const POWER_SKIPS = 1;

function emptyProgress() {
  return { unlockedZone: 0, endlessUnlocked: false, bestRounds: [0, 0, 0, 0], bestScore: 0 };
}

/** Add one more random light to the real sequence. */
function appendSignal(sequence, random = Math.random) {
  return [...sequence, Math.min(PAD_COUNT - 1, Math.floor(random() * PAD_COUNT))];
}

/**
 * Turn the real sequence into what the player sees/hears.
 * - zone 3+ (Midnight Trench, Abyssal Current) must be answered in reverse
 * - a Glint Eel can slip ONE false light into what is shown (never into the answer)
 * - zone 4 has "dark" rounds: sound only, no lights
 */
function buildPlayback(sequence, options = {}) {
  const { zoneIndex = 0, round = 1, endless = false, random = Math.random } = options;
  const reversed = zoneIndex >= 2;
  const expected = reversed ? [...sequence].reverse() : [...sequence];
  const events = expected.map((padIndex) => ({ padIndex, kind: "real" }));
  const dark = zoneIndex === 3 && (endless ? round % 2 === 0 : round % 3 === 0);
  const baseChance = zoneIndex === 2 ? 0.24 : zoneIndex === 3 ? 0.46 : 0;
  const chance = baseChance + (endless ? Math.min(0.15, Math.floor(round / 10) * 0.03) : 0);
  const hasMimic = !dark && sequence.length >= 2 && random() < chance;

  if (hasMimic) {
    const slot = Math.min(events.length - 1, Math.floor(random() * Math.max(1, events.length - 1)));
    const before = slot > 0 ? events[slot - 1].padIndex : -1;
    const after = events[slot] ? events[slot].padIndex : -1;
    const choices = [0, 1, 2, 3, 4, 5].filter((i) => i !== before && i !== after);
    const pick = Math.min(choices.length - 1, Math.floor(random() * choices.length));
    events.splice(slot, 0, { padIndex: choices[pick], kind: "mimic" });
  }
  return { expected, events, dark, reversed, hasMimic };
}

function correctRoundPoints(sequenceLength, round, skipped = false) {
  if (skipped) return 0;
  return 100 + Math.max(0, sequenceLength - 1) * 25 + Math.max(1, round) * 10;
}

/** Seconds the player gets to answer. null = no timer (Shallow Reef). */
function secondsForInput(round, zoneIndex) {
  if (zoneIndex === 0) return null;
  const first = zoneIndex === 1 ? 14 : zoneIndex === 2 ? 12 : 11;
  return Math.max(6, first - Math.max(0, round - 1) * 0.55);
}

function clampInt(value, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : min;
  return Math.min(max, Math.max(min, n));
}

/** Make sure saved data from the browser is always safe to use. */
function normalizeProgress(value = {}) {
  const rounds = Array.isArray(value.bestRounds) ? value.bestRounds : [];
  return {
    unlockedZone: clampInt(value.unlockedZone, 0, 3),
    endlessUnlocked: value.endlessUnlocked === true,
    bestRounds: [0, 1, 2, 3].map((i) => clampInt(rounds[i], 0, 999)),
    bestScore: clampInt(value.bestScore, 0, 1000000),
  };
}

/** Keep the best of two saves (this device + the account). */
function mergeProgress(a, b) {
  const x = normalizeProgress(a), y = normalizeProgress(b);
  return {
    unlockedZone: Math.max(x.unlockedZone, y.unlockedZone),
    endlessUnlocked: x.endlessUnlocked || y.endlessUnlocked,
    bestRounds: x.bestRounds.map((v, i) => Math.max(v, y.bestRounds[i])),
    bestScore: Math.max(x.bestScore, y.bestScore),
  };
}

if (typeof module !== "undefined") {
  module.exports = { ZONES, PAD_COUNT, appendSignal, buildPlayback, correctRoundPoints, secondsForInput, normalizeProgress, emptyProgress, mergeProgress };
}
