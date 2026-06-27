import { CIVS, DEFAULT_ELO } from "../core/constants.js";
import {
  applyMatchRatings,
  civElo,
  normalizePlayerRating,
  overallElo,
  RATING_MODEL_VERSION
} from "./elo.js";

export function buildPlayerEloProgress(players, history, playerId, civId = "overall") {
  const originalPlayer = players.find(player => player.id === playerId);
  if (!originalPlayer) return [];

  const playerMap = new Map(
    players.map(player => [player.name, resetPlayerForReplay(player)])
  );
  const matches = history
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const tracked = playerMap.get(originalPlayer.name);

  if (!tracked) return [];

  const points = [{
    timestamp: null,
    label: "Start",
    value: ratingValue(tracked, civId),
    match: null
  }];

  for (const match of matches) {
    const participated = didPlayerParticipate(match, originalPlayer.name);
    applyMatchToPlayers(playerMap, match);

    if (participated) {
      points.push({
        timestamp: Number(match.timestamp || 0),
        label: formatDate(match.timestamp),
        value: ratingValue(playerMap.get(originalPlayer.name), civId),
        match
      });
    }
  }

  return anchorProgressToCurrent(points, originalPlayer, civId);
}

export function buildMatchRatingChanges(players, history) {
  const replayPlayers = players.map(resetPlayerForReplay);
  const matches = history
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const changesByMatch = new Map();

  for (const match of matches) {
    const changes = applyReplayMatchRatings(replayPlayers, match);
    const changesByPlayer = new Map(
      changes.map(change => [String(change.player.id), change.mainDelta])
    );
    changesByMatch.set(matchRatingKey(match), changesByPlayer);
  }

  return changesByMatch;
}

export function matchRatingKey(match) {
  return String(
    match?.gameId ||
    match?.matchId ||
    match?.id ||
    match?.timestamp ||
    ""
  );
}

export function resetPlayerForReplay(player) {
  const startingElo = Number(player.ratingSeed?.mainElo);
  const reset = {
    ...structuredClone(player),
    mainElo: Number.isFinite(startingElo) ? startingElo : DEFAULT_ELO,
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

export function applyReplayMatchRatings(players, match) {
  const freezeMainElo = players.some(player => player.ratingMode === "base");
  const mainEloBefore = freezeMainElo
    ? new Map(players.map(player => [String(player.id), player.mainElo]))
    : null;
  const changes = applyMatchRatings(players, match);

  if (!freezeMainElo) return changes;

  for (const change of changes) {
    const startingElo = mainEloBefore.get(String(change.player.id));
    if (!Number.isFinite(startingElo)) continue;
    change.player.mainElo = startingElo;
    change.mainDelta = 0;
  }

  return changes;
}

function applyMatchToPlayers(playerMap, match) {
  applyReplayMatchRatings([...playerMap.values()], match);
}

function anchorProgressToCurrent(points, player, civId) {
  if (!points.length) return points;

  normalizePlayerRating(player);
  const currentValue = ratingValue(player, civId);
  const offset = currentValue - points[points.length - 1].value;

  if (!offset) return points;
  return points.map(point => ({ ...point, value: point.value + offset }));
}

function ratingValue(player, civId) {
  return civId === "overall" ? overallElo(player) : civElo(player, civId);
}

function didPlayerParticipate(match, playerName) {
  return [...(match.evilAssign || []), ...(match.goodAssign || [])]
    .some(assignment => (assignment.name || assignment.playerName) === playerName);
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Date(Number(timestamp)).toLocaleDateString();
}
