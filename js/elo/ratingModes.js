import { CIVS } from "../core/constants.js";
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

export const RATING_MODES = {
  original: {
    label: "Original",
    description: "Community starting ratings updated after every result",
    startingElo: communityEloSeed,
    mainEloChangeMultiplier: 1
  },
  // rating1000: {
  //   label: "1000 Rating",
  //   description: "Every player starts at 1000 before results are replayed",
  //   startingElo: () => 1000,
  //   mainEloChangeMultiplier: 1
  // },
  // Uncomment the next line to enable all three rating modes.
  base: BASE_RATING_MODE
};

const STORAGE_KEY = "lotr-rating-mode";

export function initializeRatingModes(players, history) {
  const sourcePlayers = normalizePlayerRatings(structuredClone(players || []));
  state.playerDatasets = Object.fromEntries(
    Object.entries(RATING_MODES).map(([modeId, mode]) => [
      modeId,
      buildReplayDataset(sourcePlayers, history, modeId, mode)
    ])
  );
  setRatingMode(readStoredMode(), false);
}

export function setRatingMode(mode, notify = true) {
  const fallbackMode = Object.keys(RATING_MODES)[0];
  const nextMode = RATING_MODES[mode] ? mode : fallbackMode;
  const dataset = state.playerDatasets[nextMode];

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
  const modes = Object.keys(RATING_MODES).filter(
    mode => state.playerDatasets[mode]?.length
  );
  if (!modes.length) return false;

  const currentIndex = modes.indexOf(state.ratingMode);
  const nextMode = modes[(currentIndex + 1) % modes.length];
  return setRatingMode(nextMode);
}

function buildReplayDataset(players, history, ratingMode, mode) {
  const replay = players.map(player =>
    resetPlayer(player, mode.startingElo(player), ratingMode)
  );
  for (const player of replay) {
    player.ratingContext = {
      benchmarkElo: 0,
      mainEloChangeMultiplier: mode.mainEloChangeMultiplier
    };
  }
  const matches = (history || [])
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  for (const match of matches) {
    applyReplayMatchRatings(replay, match);
  }

  rebuildInactivityState(replay, matches);
  applyCommunityRatingContext(replay);
  return replay;
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
