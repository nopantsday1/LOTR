// Client side of the precomputed ratings pipeline.
//
// scripts/build-ratings.mjs replays the whole match history in CI and commits
// ratings.json. This module puts that file to two uses:
//
//   1. First paint. The file is a single small fetch, so the ladder renders
//      long before Firestore has finished streaming ~1,000 documents.
//   2. Skipping the replay. When live Firestore data fingerprints identically
//      to what the file was built from, the precomputed datasets are adopted
//      as-is and no replay runs at all.
//
// A stale or missing file is never a correctness problem: the fingerprint will
// not match, and the client replays exactly as it did before.

import { RATING_MODEL_VERSION } from "../elo/elo.js";
import { fingerprintsMatch } from "../core/ratingsFingerprint.js";
import { setRatingMode } from "../elo/ratingModes.js";
import { state } from "../core/state.js";

let cachedPayload = null;
let fetchPromise = null;

export function getPrecomputedPayload() {
  return cachedPayload;
}

export async function fetchPrecomputedRatings() {
  if (fetchPromise) return fetchPromise;

  const url = new URL("../../ratings.json", import.meta.url);
  fetchPromise = fetch(url, { cache: "no-cache" })
    .then(res => (res.ok ? res.json() : null))
    .then(payload => {
      if (!isUsable(payload)) return null;
      cachedPayload = payload;
      return payload;
    })
    .catch(error => {
      // Absent or unreadable is fine; the app replays instead.
      console.warn("Precomputed ratings unavailable:", error?.message || error);
      return null;
    });

  return fetchPromise;
}

function isUsable(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.modes || !payload.fingerprint) return false;

  // Only a file built from live Firestore is trustworthy. `--local` builds it
  // from the committed snapshot, which holds a partial history -- and the
  // ratings-only pages cannot fingerprint-check it, so they would serve that
  // stale ladder with no way to notice.
  if (payload.source !== "firestore") {
    console.warn(
      `Ignoring ratings.json: built from "${payload.source || "unknown"}", ` +
      "not live Firestore. Run the Build Ratings workflow."
    );
    return false;
  }
  // A model change invalidates every precomputed number.
  if (payload.ratingModelVersion !== RATING_MODEL_VERSION) {
    console.warn(
      `Ignoring ratings.json built for rating model v${payload.ratingModelVersion}; ` +
      `this client is v${RATING_MODEL_VERSION}`
    );
    return false;
  }
  return Boolean(payload.modes.original?.length);
}

// Returns the precomputed datasets when they describe exactly this data, or
// null when a replay is required.
export function precomputedDatasetsFor(liveFingerprint) {
  if (!cachedPayload) return null;
  if (!fingerprintsMatch(cachedPayload.fingerprint, liveFingerprint)) return null;
  return cachedPayload.modes;
}

// How stale the file may be and still be shown before live data arrives. The
// workflow regenerates every 3 hours, so this only bites when it has been
// failing for a day -- at which point showing a badly outdated ladder for a
// second is worse than showing nothing until Firestore answers. Adoption after
// Firestore replies is governed by the fingerprint, not by this.
const MAX_PRIME_AGE_MS = 24 * 60 * 60 * 1000;

// Renders the ladder before Firestore has answered. Deliberately gives up if
// live data already arrived, so this can never overwrite fresher ratings.
export function primeFromPrecomputed(payload) {
  if (!payload || state.players.length) return false;

  const age = Date.now() - Number(payload.generatedAt || 0);
  if (!(age >= 0) || age > MAX_PRIME_AGE_MS) {
    console.warn(
      `Skipping first paint from ratings.json: it is ${Math.round(age / 3600000)}h old`
    );
    return false;
  }

  state.playerDatasets = { ...payload.modes };
  const applied = setRatingMode(readStoredMode(), false);
  if (!applied) {
    state.playerDatasets = {};
    return false;
  }

  state.ratingsArePrecomputed = true;
  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));
  return true;
}

function readStoredMode() {
  try {
    return localStorage.getItem("lotr-rating-mode") || "original";
  } catch {
    return "original";
  }
}
