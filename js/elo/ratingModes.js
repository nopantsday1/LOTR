import { CIVS } from "../core/constants.js";
import { ratingEligibleHistory } from "../core/matchRules.js";
import { state } from "../core/state.js";
import { communityEloSeed } from "../data/communityEloSeeds.js";
import {
  applyCommunityRatingContext,
  normalizePlayerRatings,
  rebuildInactivityState,
  RATING_MODEL_VERSION
} from "./elo.js";
import { applyReplayMatchRatings } from "./progress.js";

export const BASE_RATING_MODE = {
  label: "Base",
  description: "Community-assigned Main Elo stays fixed",
  startingElo: communityEloSeed,
  mainEloChangeMultiplier: 1
};

// Dormant registration: a flat starting point for every player, useful for
// asking "what would the ladder look like with no seeding?". Not enabled by
// default; add it to RATING_MODES below to switch it on.
export const RATING_1000_MODE = {
  label: "1000 Rating",
  description: "Every player starts at 1000 before results are replayed",
  startingElo: () => 1000,
  mainEloChangeMultiplier: 1
};

// The modes offered in the UI, in cycle order. "original" must stay first: it is
// the fallback used whenever a stored mode is unknown.
export const RATING_MODES = {
  original: {
    label: "Original",
    description: "Community starting ratings updated after every result",
    startingElo: communityEloSeed,
    mainEloChangeMultiplier: 1
  },
  base: BASE_RATING_MODE
};

const STORAGE_KEY = "lotr-rating-mode";

// The source data for replays, kept so a mode's dataset can be built later
// rather than all of them upfront.
let replaySource = { players: [], history: [] };

// `precomputed` is the `modes` map from ratings.json, supplied only when its
// fingerprint matches this exact data. Adopting it skips the replay entirely;
// the replay source is still recorded so a mode the file does not contain can
// be built later.
export function initializeRatingModes(players, history, precomputed = null) {
  replaySource = {
    players: normalizePlayerRatings(structuredClone(players || [])),
    history: history || []
  };

  // Each dataset is a full replay of every match: ~830ms at current volume.
  // Building one per registered mode on every page load meant paying for modes
  // nobody was looking at, so they are built on demand instead.
  //
  // "original" is the exception and is always built: the rest of the app reads
  // it as the identity source for players (profile IDs, names, admin fields).
  state.playerDatasets = {};

  for (const [modeId, dataset] of Object.entries(precomputed || {})) {
    if (RATING_MODES[modeId] && dataset?.length) {
      state.playerDatasets[modeId] = normalizePlayerRatings(dataset);
    }
  }
  state.ratingsArePrecomputed = Boolean(
    precomputed && state.playerDatasets.original?.length
  );

  // Builds "original" only if it was not adopted above.
  ensureRatingDataset("original");

  setRatingMode(readStoredMode(), false);
}

// Builds a mode's replayed dataset if it does not exist yet, and returns it.
export function ensureRatingDataset(modeId) {
  const mode = RATING_MODES[modeId];
  if (!mode) return null;
  if (state.playerDatasets[modeId]?.length) return state.playerDatasets[modeId];
  if (!replaySource.players.length) return null;

  state.playerDatasets[modeId] = buildReplayDataset(
    replaySource.players,
    replaySource.history,
    modeId,
    mode
  );
  return state.playerDatasets[modeId];
}

export function setRatingMode(mode, notify = true) {
  const fallbackMode = Object.keys(RATING_MODES)[0];
  const nextMode = RATING_MODES[mode] ? mode : fallbackMode;
  // Builds this mode's replay the first time it is selected.
  const dataset = ensureRatingDataset(nextMode);

  if (!dataset?.length) return false;

  state.ratingMode = nextMode;
  state.players = dataset;
  state.lastBalance = null;

  if (state.linkedPlayer) {
    state.linkedPlayer = findMatchingPlayer(dataset, state.linkedPlayer);
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, nextMode);
  }

  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lotr:dataChanged"));
    window.dispatchEvent(new CustomEvent("lotr:ratingModeChanged", {
      detail: { mode: nextMode }
    }));
  }

  return true;
}

export function toggleRatingMode() {
  // Every registered mode is selectable; its dataset is built on selection.
  const modes = Object.keys(RATING_MODES);
  if (!modes.length) return false;

  const currentIndex = modes.indexOf(state.ratingMode);
  const nextMode = modes[(currentIndex + 1) % modes.length];
  return setRatingMode(nextMode);
}

function buildReplayDataset(players, history, ratingMode, mode) {
  const replay = players.map(player =>
    resetPlayer(player, startingEloFor(player, mode), ratingMode)
  );
  for (const player of replay) {
    player.ratingContext = {
      benchmarkElo: 0,
      mainEloChangeMultiplier: mode.mainEloChangeMultiplier
    };
  }
  // Matches an admin has excluded stay in history and stay on the History page,
  // but never reach the replay.
  const matches = ratingEligibleHistory(history)
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  for (const match of matches) {
    applyReplayMatchRatings(replay, match);
  }

  applyManualAdjustments(replay);
  rebuildInactivityState(replay, matches);
  applyCommunityRatingContext(replay);
  return replay;
}

// An admin can override where a player's replay starts. This is the
// architecturally honest knob: because ratings are derived, a direct write to
// mainElo would be overwritten on the next load, whereas a seed survives.
function startingEloFor(player, mode) {
  const override = Number(player.ratingSeedOverride);
  return Number.isFinite(override) && override > 0
    ? override
    : mode.startingElo(player);
}

// A signed nudge applied once the replay has finished, for when an admin wants
// to correct a current rating without moving the starting point.
function applyManualAdjustments(players) {
  for (const player of players) {
    const adjustment = Number(player.eloAdjustment);
    if (!Number.isFinite(adjustment) || adjustment === 0) continue;
    player.mainElo = Math.round(Number(player.mainElo || 0) + adjustment);
  }
}

function resetPlayer(player, startingElo, ratingMode) {
  const reset = {
    ...structuredClone(player),
    ratingMode,
    ratingSeed: {
      mainElo: startingElo
    },
    mainElo: startingElo,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    lastPlayedAt: null,
    inactivityPenaltyBank: 0,
    returnGamesInWindow: 0,
    returnWindowStartedAt: 0,
    civStats: {},
    ratingModelVersion: RATING_MODEL_VERSION
  };

  for (const civ of CIVS) {
    reset.civStats[civ.id] = {
      games: 0,
      wins: 0
    };
  }

  return reset;
}

function readStoredMode() {
  if (typeof localStorage === "undefined") return "original";
  return localStorage.getItem(STORAGE_KEY) || "original";
}

function findMatchingPlayer(players, selectedPlayer) {
  return players.find(player => (
    (selectedPlayer.id && player.id === selectedPlayer.id) ||
    (
      selectedPlayer.profileId &&
      String(player.profileId || "") === String(selectedPlayer.profileId)
    ) ||
    player.name === selectedPlayer.name
  )) || null;
}
