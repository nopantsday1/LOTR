// Firestore writes performed from the admin panel.
//
// These run as the signed-in admin (js/data/auth.js), so Firestore rules can
// require request.auth != null for writes.
//
// That only holds if the rules actually say so. With the permissive rules this
// project started from, any visitor can still write these collections directly
// without signing in -- the sign-in gates the UI, the rules gate the data. See
// DEPLOYMENT.md for the ruleset that closes that gap.

import { LOCAL_SANDBOX } from "../core/config.js";
import { CIVS, DEFAULT_ELO } from "../core/constants.js";
import {
  findDuplicatePlayer,
  parseAltProfileIds,
  parseEloAdjustment,
  parsePlayerName,
  parseProfileId,
  parseSeedElo
} from "../core/playerInput.js";
import { state } from "../core/state.js";
import { firestoreApi as fb } from "../data/firebase.js";
import { safeAddDoc, safeUpdateDoc } from "../data/writes.js";

export { MIN_ELO, MAX_ELO, MAX_ADJUSTMENT } from "../core/playerInput.js";

// In local-sandbox mode initFirebase() is never called, so state.db is null.
// Fail with a clear message rather than a Firebase internal error.
function requireDb() {
  if (!state.db) {
    throw new Error(
      LOCAL_SANDBOX
        ? "Local sandbox is read-only; writes are disabled."
        : "Firebase is not ready yet. Wait for data to load and try again."
    );
  }
  return state.db;
}

function playerDoc(playerId) {
  const id = String(playerId || "");
  if (!id) throw new Error("A player id is required");
  return fb.doc(requireDb(), "players", id);
}

// Identity lives on the original dataset: the replayed datasets are derived.
function identityPlayers() {
  return state.playerDatasets.original?.length
    ? state.playerDatasets.original
    : state.players || [];
}

// --- 1. Manual Elo adjustments --------------------------------------------

// Sets where the player's replay starts. Ratings are derived by replaying
// history, so writing mainElo directly would be discarded on the next load;
// the seed is the value that survives.
export async function setSeedElo(playerId, elo) {
  const value = parseSeedElo(elo);
  await safeUpdateDoc(playerDoc(playerId), { ratingSeedOverride: value });
  return value;
}

export async function clearSeedElo(playerId) {
  await safeUpdateDoc(playerDoc(playerId), { ratingSeedOverride: null });
}

// A signed nudge applied after the replay finishes, for correcting a current
// rating without moving the starting point.
export async function setEloAdjustment(playerId, delta) {
  const value = parseEloAdjustment(delta);
  await safeUpdateDoc(playerDoc(playerId), { eloAdjustment: value });
  return value;
}

export async function clearEloAdjustment(playerId) {
  await safeUpdateDoc(playerDoc(playerId), { eloAdjustment: null });
}

// --- 2. Adding new players -------------------------------------------------

export async function addPlayer({ name, profileId, altProfileIds, seedElo }) {
  const cleanName = parsePlayerName(name);
  const pid = parseProfileId(profileId);
  const alts = parseAltProfileIds(altProfileIds);

  const duplicate = findDuplicatePlayer(identityPlayers(), cleanName, pid);
  if (duplicate) {
    throw new Error(
      `"${duplicate.name}" already exists with that name or profile id`
    );
  }

  let startingElo = DEFAULT_ELO;
  if (String(seedElo ?? "").trim()) startingElo = parseSeedElo(seedElo);

  // civStats starts empty; the replay fills it from match history.
  const civStats = Object.fromEntries(
    CIVS.map(civ => [civ.id, { games: 0, wins: 0 }])
  );

  const doc = {
    name: cleanName,
    profileId: pid,
    altProfileIds: alts,
    mainElo: startingElo,
    ratingSeedOverride: startingElo,
    eloAdjustment: 0,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    civStats,
    favCivs: [],
    avoidCivs: [],
    createdAt: Date.now()
  };

  const ref = await safeAddDoc(fb.collection(requireDb(), "players"), doc);
  return { id: ref?.id, ...doc };
}

export async function updatePlayerProfileIds(playerId, { profileId, altProfileIds }) {
  await safeUpdateDoc(playerDoc(playerId), {
    profileId: parseProfileId(profileId),
    altProfileIds: parseAltProfileIds(altProfileIds)
  });
}
