import { CIVS, DEFAULT_ELO } from "../core/constants.js";

export const DECAY_GRACE_DAYS = 30;
export const DECAY_RATE_PER_DAY = 1;
export const DECAY_MAX = 150;
export const DECAY_FLOOR = 600;
export const MIN_ELO_CHANGE = 5;
export const MIN_CIV_MODIFIER = -200;
export const MAX_CIV_MODIFIER = 200;

export function normalizePlayerRating(player) {
  if (!player) return player;
  if (
    player.ratingModelVersion === 2 &&
    Number.isFinite(Number(player.mainElo)) &&
    CIVS.every(civ => player.civStats?.[civ.id])
  ) {
    return player;
  }

  const mainElo = Number.isFinite(Number(player.mainElo))
    ? Math.round(Number(player.mainElo))
    : legacyMainElo(player);
  const civStats = {};

  for (const civ of CIVS) {
    const wins = Number(player.civWins?.[civ.id] || 0);
    const losses = Number(player.civLosses?.[civ.id] || 0);
    const existing = player.civStats?.[civ.id] || {};
    const games = Number(existing.games ?? wins + losses);
    let modifier = Number(existing.modifier);

    if (!Number.isFinite(modifier)) {
      const legacyCivElo = Number(player.civElo?.[civ.id]);
      if (Number.isFinite(legacyCivElo)) {
        modifier = legacyCivElo - mainElo;
      } else {
        const legacyPct = legacyCivPercent(player, civ.id);
        modifier = Number.isFinite(legacyPct)
          ? Math.max(mainElo * ((legacyPct - 100) / 100), -150)
          : 0;
      }
    }

    civStats[civ.id] = {
      ...existing,
      games,
      wins: Number(existing.wins ?? wins),
      modifier: clamp(Math.round(modifier), MIN_CIV_MODIFIER, MAX_CIV_MODIFIER),
      manualPreference: existing.manualPreference ?? preferenceFor(player, civ.id)
    };
  }

  player.mainElo = mainElo;
  player.gamesPlayed = Number(player.gamesPlayed ?? ((player.wins || 0) + (player.losses || 0)));
  player.civStats = civStats;
  player.ratingModelVersion = 2;
  return player;
}

export function normalizePlayerRatings(players) {
  return (players || []).map(normalizePlayerRating);
}

export function overallElo(player) {
  normalizePlayerRating(player);
  return Math.round(Number(player.mainElo || DEFAULT_ELO));
}

export function civModifier(player, civId) {
  normalizePlayerRating(player);
  return clamp(
    Number(player.civStats?.[civId]?.modifier || 0),
    MIN_CIV_MODIFIER,
    MAX_CIV_MODIFIER
  );
}

export function civGames(player, civId) {
  normalizePlayerRating(player);
  return Number(player.civStats?.[civId]?.games || 0);
}

export function confidenceWeight(player, civId) {
  const games = civGames(player, civId);
  return games / (games + 5);
}

export function preferenceBonus(player, civId) {
  const preference = player.civStats?.[civId]?.manualPreference ?? preferenceFor(player, civId);
  if (preference === "fav") return 40;
  if (preference === "avoid") return -120;
  return 0;
}

export function uncertaintyPenalty(player, civId) {
  const games = civGames(player, civId);
  if (games === 0) return -40;
  if (games === 1) return -25;
  if (games === 2) return -15;
  return 0;
}

export function weightedCivAdjustment(player, civId) {
  return Math.round(confidenceWeight(player, civId) * civModifier(player, civId));
}

export function civElo(player, civId) {
  return overallElo(player) + weightedCivAdjustment(player, civId);
}

export function effectiveCivElo(player, civId) {
  return Math.max(
    100,
    civElo(player, civId) +
      preferenceBonus(player, civId) +
      uncertaintyPenalty(player, civId)
  );
}

export function assignmentPenalty(player, civId, recentCivs = []) {
  if ((player.bannedCivs || []).includes(civId)) return Infinity;

  let penalty = 0;
  const preference = player.civStats?.[civId]?.manualPreference ?? preferenceFor(player, civId);

  if (preference === "avoid") penalty += 150;
  if (preference === "fav") penalty -= 20;
  if (civGames(player, civId) === 0) penalty += 20;
  if (recentCivs[0] === civId) penalty += 30;

  return penalty;
}

export function decayAmount(player, now = Date.now()) {
  if (!player.lastPlayedAt) return 0;

  const daysSince = (now - player.lastPlayedAt) / 86400000;
  if (daysSince <= DECAY_GRACE_DAYS) return 0;

  const decay = Math.floor((daysSince - DECAY_GRACE_DAYS) * DECAY_RATE_PER_DAY);
  return Math.min(decay, DECAY_MAX);
}

export function decayedElo(player) {
  return Math.max(overallElo(player) - decayAmount(player), DECAY_FLOOR);
}

export function mainKFactor(gamesPlayed) {
  if (gamesPlayed < 10) return 40;
  if (gamesPlayed < 30) return 32;
  return 24;
}

export function expectedTeamScore(teamAverage, opponentAverage) {
  return 1 / (1 + Math.pow(10, (opponentAverage - teamAverage) / 400));
}

export function ratingDelta(k, actual, expected, minimum = MIN_ELO_CHANGE) {
  const calculated = Math.round(k * (actual - expected));
  return actual
    ? Math.max(minimum, calculated)
    : Math.min(-minimum, calculated);
}

export function mainEloDelta(player, won, expected) {
  return ratingDelta(mainKFactor(Number(player.gamesPlayed || 0)), won ? 1 : 0, expected);
}

export function civModifierDelta(player, civId, won, expected) {
  const sampleMultiplier = civGames(player, civId) < 3 ? 0.7 : 1;
  return Math.round(10 * ((won ? 1 : 0) - expected) * sampleMultiplier);
}

export function applyRatingResult(player, civId, won, expected, timestamp = Date.now()) {
  normalizePlayerRating(player);

  const mainDelta = mainEloDelta(player, won, expected);
  const modifierDelta = civModifierDelta(player, civId, won, expected);
  const stats = player.civStats[civId];

  player.mainElo = Math.max(100, overallElo(player) + mainDelta);
  player.gamesPlayed += 1;
  player.wins = Number(player.wins || 0) + (won ? 1 : 0);
  player.losses = Number(player.losses || 0) + (won ? 0 : 1);
  player.lastPlayedAt = timestamp || player.lastPlayedAt;

  stats.games += 1;
  stats.wins += won ? 1 : 0;
  stats.modifier = clamp(
    stats.modifier + modifierDelta,
    MIN_CIV_MODIFIER,
    MAX_CIV_MODIFIER
  );

  return { mainDelta, modifierDelta };
}

export function applyMatchRatings(players, match) {
  normalizePlayerRatings(players);

  const evilAssignments = match.evilAssign || [];
  const goodAssignments = match.goodAssign || [];
  const winner = normalizeWinner(match.winner || match.result);
  const evilPlayers = matchedPlayers(players, evilAssignments);
  const goodPlayers = matchedPlayers(players, goodAssignments);

  if (!winner || !evilPlayers.length || !goodPlayers.length) return [];

  const evilAverage = average(evilPlayers.map(overallElo));
  const goodAverage = average(goodPlayers.map(overallElo));
  const evilExpected = expectedTeamScore(evilAverage, goodAverage);
  const timestamp = Number(match.timestamp || Date.now());

  return [
    ...applyTeamRatings(players, evilAssignments, winner === "evil", evilExpected, timestamp),
    ...applyTeamRatings(players, goodAssignments, winner === "good", 1 - evilExpected, timestamp)
  ];
}

function legacyMainElo(player) {
  const ratings = CIVS
    .map(civ => Number(player.civElo?.[civ.id]))
    .filter(Number.isFinite);

  if (ratings.length) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const civ of CIVS) {
      const rating = Number(player.civElo?.[civ.id]);
      if (!Number.isFinite(rating)) continue;

      const games = Number(player.civWins?.[civ.id] || 0) + Number(player.civLosses?.[civ.id] || 0);
      const weight = 0.25 + Math.sqrt(games);
      weightedSum += rating * weight;
      totalWeight += weight;
    }

    if (totalWeight) return Math.round(weightedSum / totalWeight);
  }

  return Math.round(Number(player.elo || DEFAULT_ELO));
}

function legacyCivPercent(player, civId) {
  const direct = Number(player.civPct?.[civId]);
  if (Number.isFinite(direct)) return direct;
  return NaN;
}

function preferenceFor(player, civId) {
  if ((player.favCivs || []).includes(civId)) return "fav";
  if ((player.avoidCivs || []).includes(civId)) return "avoid";
  return null;
}

function applyTeamRatings(players, assignments, won, expected, timestamp) {
  const changes = [];

  for (const assignment of assignments) {
    const player = findPlayer(players, assignment);
    const civId = findCivId(assignment.civ || assignment.civId || assignment.civName);
    if (!player || !civId) continue;

    changes.push({
      player,
      civId,
      ...applyRatingResult(player, civId, won, expected, timestamp)
    });
  }

  return changes;
}

function matchedPlayers(players, assignments) {
  return assignments.map(assignment => findPlayer(players, assignment)).filter(Boolean);
}

function findPlayer(players, assignment) {
  const profileId = String(assignment.profileId || "");
  const name = String(assignment.name || assignment.playerName || "");

  return players.find(player => (
    (profileId && String(player.profileId || "") === profileId) ||
    String(player.name || "") === name
  ));
}

function findCivId(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase();

  return CIVS.find(civ => (
    civ.id === normalized ||
    civ.name.toLowerCase() === normalized ||
    civ.name.toLowerCase().includes(normalized) ||
    normalized.includes(civ.name.toLowerCase())
  ))?.id || normalized.match(/\bp[1-8]\b/)?.[0] || null;
}

function normalizeWinner(value) {
  const winner = String(value || "").toLowerCase();
  if (winner.includes("evil")) return "evil";
  if (winner.includes("good")) return "good";
  return "";
}

function average(values) {
  if (!values.length) return DEFAULT_ELO;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
