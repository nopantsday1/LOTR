import { CIVS } from "../core/constants.js";
import { state } from "../core/state.js";
import {
  applyMatchRatings,
  normalizePlayerRatings,
  rebuildInactivityState,
  RATING_MODEL_VERSION
} from "./elo.js";

export const RATING_MODES = {
  original: {
    label: "Original",
    description: "Creator-assigned ratings"
  },
  replay: {
    label: "1000 Replay",
    description: "All recorded matches replayed from 1000 Elo"
  }
};

const STORAGE_KEY = "lotr-rating-mode";

export function initializeRatingModes(players, history) {
  const sourcePlayers = structuredClone(players || []);
  const original = normalizePlayerRatings(structuredClone(sourcePlayers));
  rebuildInactivityState(original, history);

  original.forEach((player, index) => {
    const source = sourcePlayers[index] || {};
    const creatorElo = Number(source.elo);

    player.ratingMode = "original";
    player.ratingSeed = {
      mainElo: Number.isFinite(creatorElo) ? Math.round(creatorElo) : player.mainElo
    };
  });

  const replay = buildReplayDataset(original, history, 1000);

  state.playerDatasets = { original, replay };
  setRatingMode(readStoredMode(), false);
}

export function setRatingMode(mode, notify = true) {
  const nextMode = RATING_MODES[mode] ? mode : "original";
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
  const nextMode = state.ratingMode === "original" ? "replay" : "original";
  return setRatingMode(nextMode);
}

function buildReplayDataset(players, history, startingElo) {
  const replay = players.map(player => resetPlayer(player, startingElo));
  const matches = (history || [])
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  for (const match of matches) {
    applyMatchRatings(replay, match);
  }

  return replay;
}

function resetPlayer(player, startingElo) {
  const reset = {
    ...structuredClone(player),
    ratingMode: "replay",
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
