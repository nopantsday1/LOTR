// Admin overrides for individual matches, keyed by the AoE2 match id.
//
//   mode: "exclude"  a match present in history must NOT count towards Elo
//   mode: "include"  a feed match rejected by the import gates must be imported
//                    anyway (too short, wrong player count, non-matching lobby
//                    name, ...)
//
// Ratings are derived by replaying history, so an exclusion cannot be a
// destructive edit: the match stays in Firestore and stays visible on the
// History page, it simply drops out of the replay. That keeps the decision
// reversible.

import {
  applyOverridesToHistory as applyOverrides,
  OVERRIDE_EXCLUDE,
  OVERRIDE_INCLUDE,
  overrideKey
} from "../core/matchRules.js";
import { state } from "../core/state.js";
import { firestoreApi as fb } from "./firebase.js";
import { safeSetDoc, safeDeleteDoc } from "./writes.js";

// The pure helpers live in core/matchRules.js so Node tooling can use them
// without importing the Firebase SDK. Re-exported here for existing call sites.
export { overrideKey } from "../core/matchRules.js";

export const OVERRIDE_COLLECTION = "matchOverrides";
export const EXCLUDE = OVERRIDE_EXCLUDE;
export const INCLUDE = OVERRIDE_INCLUDE;

export function getOverride(gameId) {
  return state.matchOverrides?.get(String(gameId)) || null;
}

export function isForceIncluded(gameId) {
  return getOverride(gameId)?.mode === INCLUDE;
}

export function isForceExcluded(gameId) {
  return getOverride(gameId)?.mode === EXCLUDE;
}

// Browser-side wrapper: defaults to the live override map in state. The actual
// stamping lives in core/matchRules.js.
export function applyOverridesToHistory(history, overrides) {
  return applyOverrides(history, overrides || state.matchOverrides || new Map());
}

export function subscribeMatchOverrides(onChange, onError) {
  return fb.onSnapshot(
    fb.collection(state.db, OVERRIDE_COLLECTION),
    snap => {
      state.matchOverrides = new Map(
        snap.docs.map(d => [d.id, { id: d.id, ...d.data() }])
      );
      onChange?.();
    },
    error => {
      // Overrides are optional; without them the app behaves exactly as before.
      state.matchOverrides = new Map();
      console.warn("Match overrides are unavailable:", error.code);
      onError?.(error);
      onChange?.();
    }
  );
}

function requireDb() {
  if (!state.db) {
    throw new Error("Firebase is not ready yet, or this is the read-only sandbox.");
  }
  return state.db;
}

export async function setMatchOverride(gameId, mode, reason = "") {
  const id = String(gameId);
  if (!id) throw new Error("A match id is required");
  if (mode !== EXCLUDE && mode !== INCLUDE) {
    throw new Error(`Unknown override mode: ${mode}`);
  }

  return safeSetDoc(fb.doc(requireDb(), OVERRIDE_COLLECTION, id), {
    mode,
    reason: String(reason || ""),
    updatedAt: Date.now()
  });
}

export async function clearMatchOverride(gameId) {
  const id = String(gameId);
  if (!id) throw new Error("A match id is required");
  return safeDeleteDoc(fb.doc(requireDb(), OVERRIDE_COLLECTION, id));
}
