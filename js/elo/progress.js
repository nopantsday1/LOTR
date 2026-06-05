import { CIVS, DEFAULT_ELO } from "../core/constants.js";
import { calcElo, overallElo } from "./elo.js";

export function buildPlayerEloProgress(players, history, playerId, civId = "overall") {
  const originalPlayer = players.find(p => p.id === playerId);
  if (!originalPlayer) return [];

  const playerName = originalPlayer.name;

  const playerMap = new Map(
    players.map(player => [
      player.name,
      cloneResetPlayer(player)
    ])
  );

  const matches = history
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  const points = [];

  const tracked = playerMap.get(playerName);
  if (!tracked) return [];

  points.push({
    timestamp: null,
    label: "Start",
    value: civId === "overall" ? overallElo(tracked) : getCivElo(tracked, civId),
    match: null
  });

  for (const match of matches) {
    applyMatchToPlayers(playerMap, match);

    const updatedTracked = playerMap.get(playerName);
    const participated = didPlayerParticipate(match, playerName);

    if (participated) {
      points.push({
        timestamp: Number(match.timestamp || 0),
        label: formatDate(match.timestamp),
        value: civId === "overall"
          ? overallElo(updatedTracked)
          : getCivElo(updatedTracked, civId),
        match
      });
    }
  }

  return points;
}

function cloneResetPlayer(player) {
  const civElo = {};
  const civWins = {};
  const civLosses = {};

  for (const civ of CIVS) {
    civElo[civ.id] = DEFAULT_ELO;
    civWins[civ.id] = 0;
    civLosses[civ.id] = 0;
  }

  return {
    ...structuredClone(player),
    wins: 0,
    losses: 0,
    civElo,
    civWins,
    civLosses
  };
}

function applyMatchToPlayers(playerMap, match) {
  const evil = match.evilAssign || [];
  const good = match.goodAssign || [];

  const winner = String(match.winner || match.result || "").toLowerCase();

  const evilWon = winner.includes("evil");
  const goodWon = winner.includes("good");

  if (!evilWon && !goodWon) return;

  const evilPlayers = evil
    .map(a => playerMap.get(a.name || a.playerName))
    .filter(Boolean);

  const goodPlayers = good
    .map(a => playerMap.get(a.name || a.playerName))
    .filter(Boolean);

  if (!evilPlayers.length || !goodPlayers.length) return;

  const evilAvg = average(evilPlayers.map(overallElo));
  const goodAvg = average(goodPlayers.map(overallElo));

  for (const assignment of evil) {
    const player = playerMap.get(assignment.name || assignment.playerName);
    if (!player) continue;

    const civId = assignment.civ || assignment.civId || findCivIdByName(assignment.civName);
    if (!civId) continue;

    applyPlayerResult(player, civId, evilWon, goodAvg);
  }

  for (const assignment of good) {
    const player = playerMap.get(assignment.name || assignment.playerName);
    if (!player) continue;

    const civId = assignment.civ || assignment.civId || findCivIdByName(assignment.civName);
    if (!civId) continue;

    applyPlayerResult(player, civId, goodWon, evilAvg);
  }
}

function applyPlayerResult(player, civId, won, opponentAverage) {
  const oldElo = getCivElo(player, civId);
  const totalGames = (player.wins || 0) + (player.losses || 0);
  const civGames = (player.civWins?.[civId] || 0) + (player.civLosses?.[civId] || 0);

  const newElo = calcElo(oldElo, opponentAverage, won, totalGames, civGames);

  player.civElo[civId] = newElo;

  if (won) {
    player.wins = (player.wins || 0) + 1;
    player.civWins[civId] = (player.civWins[civId] || 0) + 1;
  } else {
    player.losses = (player.losses || 0) + 1;
    player.civLosses[civId] = (player.civLosses[civId] || 0) + 1;
  }
}

function didPlayerParticipate(match, playerName) {
  return [...(match.evilAssign || []), ...(match.goodAssign || [])]
    .some(a => (a.name || a.playerName) === playerName);
}

function getCivElo(player, civId) {
  return player.civElo?.[civId] ?? DEFAULT_ELO;
}

function findCivIdByName(civName) {
  if (!civName) return null;

  const normalized = String(civName).toLowerCase();

  return CIVS.find(civ => {
    return (
      civ.name.toLowerCase() === normalized ||
      civ.id.toLowerCase() === normalized ||
      civ.name.toLowerCase().includes(normalized) ||
      normalized.includes(civ.name.toLowerCase())
    );
  })?.id || null;
}

function average(values) {
  if (!values.length) return DEFAULT_ELO;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Date(Number(timestamp)).toLocaleDateString();
}