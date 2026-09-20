import { ratingsFingerprint } from "../core/ratingsFingerprint.js";
import { state } from "../core/state.js";
import { firestoreApi as fb } from "./firebase.js";
import { initializeRatingModes, setRatingMode } from "../elo/ratingModes.js";
import { normalizePlayerRatings } from "../elo/elo.js";
import {
  applyOverridesToHistory,
  subscribeMatchOverrides
} from "./matchOverrides.js";
import { precomputedDatasetsFor } from "./precomputedRatings.js";

// Re-exported so existing call sites keep importing writes from here.
export {
  safeSetDoc,
  safeUpdateDoc,
  safeAddDoc,
  safeDeleteDoc
} from "./writes.js";

// The rating replay needs every match, so `history` cannot be capped. What it
// does not need is a second listener on the same collection: `state.history` is
// now derived from the full snapshot instead of being fetched again.
export const RECENT_HISTORY_SIZE = 100;

// Prediction responses are immutable and append-only, so an uncapped listener
// grows without bound. The Stats page labels its accuracy figure as covering
// this most-recent window.
export const PREDICTION_WINDOW = 2000;

// `onChange` fires when players/history/overrides change, which is what every
// page rebuilds from. `onPredictionsChange` is separate on purpose: prediction
// responses are only used by the Stats page, and routing them through the main
// callback made every page redo its rating replay for data it never reads.
// `options.includeHistory: false` skips the `history` subscription entirely and
// serves ratings from ratings.json instead.
//
// This is a quota decision, not just a speed one. The free Firestore tier allows
// 50,000 document reads a day, and a full page load costs ~1,275 of them (966
// history + 89 players + 220 predictions) -- about 39 page loads a day for the
// whole community before reads start failing. Pages that only need the ladder
// therefore read 89 documents instead of ~1,275.
export function subscribeCoreData(onChange, onPredictionsChange, options = {}) {
  const { includeHistory = true, precomputedModes = null } = options;

  return includeHistory
    ? subscribeFullData(onChange, onPredictionsChange)
    : subscribeRatingsOnly(onChange, precomputedModes);
}

// Players only. Ratings come from the precomputed file, so match history -- by
// far the largest collection -- is never read.
function subscribeRatingsOnly(onChange, precomputedModes) {
  const playersRef = fb.collection(state.db, "players");

  const unsubPlayers = fb.onSnapshot(playersRef, snap => {
    const sourcePlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // No history means no replay is possible here, so the precomputed datasets
    // are used as-is. app.js only selects this mode when ratings.json is
    // present and built for this rating model.
    state.playerDatasets = { ...precomputedModes };
    state.ratingsArePrecomputed = true;
    state.knownPlayers = sourcePlayers;
    adoptPrecomputedForRoster(sourcePlayers, precomputedModes);
    setRatingMode(state.ratingMode, false);
    onChange?.();
  });

  return () => unsubPlayers();
}

// Keeps the live roster authoritative for identity while ratings come from the
// file: a player added since the last CI run still appears, with default
// ratings, instead of vanishing until the next build.
function adoptPrecomputedForRoster(sourcePlayers, precomputedModes) {
  const rated = new Map(
    (precomputedModes?.original || []).map(player => [String(player.id), player])
  );
  const missing = sourcePlayers.filter(player => !rated.has(String(player.id)));
  if (!missing.length) return;

  for (const modeId of Object.keys(state.playerDatasets)) {
    state.playerDatasets[modeId] = [
      ...state.playerDatasets[modeId],
      ...normalizePlayerRatings(structuredClone(missing))
    ];
  }
}

function subscribeFullData(onChange, onPredictionsChange) {
  const playersRef = fb.collection(state.db, "players");
  const historyRef = fb.collection(state.db, "history");
  const predictionsRef = fb.collection(state.db, "predictionResponses");

  let sourcePlayers = [];
  let rawHistory = [];
  let playersLoaded = false;
  let historyLoaded = false;
  let overridesLoaded = false;

  // Ratings depend on players, history and the exclusion overrides together,
  // so the replay only runs once all three have arrived at least once.
  function publishRatingDatasets() {
    if (!playersLoaded || !historyLoaded || !overridesLoaded) return;

    state.fullHistory = applyOverridesToHistory(rawHistory);
    state.history = state.fullHistory.slice(0, RECENT_HISTORY_SIZE);

    // When ratings.json was built from exactly this data, adopt it and skip the
    // replay. Any difference -- a new match, an admin Elo change, an override --
    // fails the fingerprint and falls back to replaying, so a stale file costs
    // nothing but the work we would have done anyway.
    const fingerprint = ratingsFingerprint(
      sourcePlayers,
      state.fullHistory,
      state.matchOverrides
    );
    initializeRatingModes(
      sourcePlayers,
      state.fullHistory,
      precomputedDatasetsFor(fingerprint)
    );
    onChange?.();
  }

  const unsubPlayers = fb.onSnapshot(playersRef, snap => {
    sourcePlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    playersLoaded = true;
    publishRatingDatasets();
  });

  const unsubHistory = fb.onSnapshot(
    fb.query(historyRef, fb.orderBy("timestamp", "desc")),
    snap => {
      rawHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      historyLoaded = true;
      publishRatingDatasets();
    }
  );

  const unsubOverrides = subscribeMatchOverrides(() => {
    overridesLoaded = true;
    publishRatingDatasets();
  });

  const unsubPredictions = fb.onSnapshot(
    fb.query(
      predictionsRef,
      fb.orderBy("createdAt", "desc"),
      fb.limit(PREDICTION_WINDOW)
    ),
    snap => {
      state.communityPredictions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      onPredictionsChange?.();
    },
    error => {
      // The rest of the app can still use players and match history if the
      // optional community-prediction collection has not been allowed yet.
      console.warn("Community predictions are unavailable:", error.code);
    }
  );

  return () => {
    unsubPlayers();
    unsubHistory();
    unsubOverrides();
    unsubPredictions();
  };
}
