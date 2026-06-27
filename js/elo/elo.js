import { CIVS, DEFAULT_ELO } from "../core/constants.js";

export const RATING_MODEL_VERSION = 3;
export const INACTIVE_AFTER_DAYS = 7;
export const FULL_PENALTY_AFTER_DAYS = 30;
export const MIN_INACTIVITY_PENALTY = 50;
export const MAX_INACTIVITY_PENALTY = 300;
export const RECOVERY_GAMES_REQUIRED = 2;
export const RECOVERY_WINDOW_DAYS = 7;
export const BALANCER_INACTIVITY_MULTIPLIER = 0.6;
export const ELO_EXPECTATION_SCALE = 400;
export const MAX_CIV_BIAS = 200;
export const BASE_CIV_BIAS = 20;
export const LOW_WIN_RATE_THRESHOLD = 0.5;
export const LOW_WIN_RATE_MAX_PENALTY = 200;
export const LOW_WIN_RATE_PENALTY_POWER = 1.5;
export const HARD_CIV_IDS = new Set(["p2", "p6"]);
export const HARD_CIV_LOW_ELO_START = 1200;
export const HARD_CIV_LOW_ELO_FLOOR = 800;
export const HARD_CIV_MAX_LOW_ELO_PENALTY = 120;
export const INEXPERIENCE_PENALTIES = [20, 15, 10, 5, 3];

export function normalizePlayerRating(player) {
  if (!player) return player;
  if (
    player.ratingModelVersion === RATING_MODEL_VERSION &&
    Number.isFinite(Number(player.mainElo)) &&
    CIVS.every(civ => player.civStats?.[civ.id])
  ) {
    player.mainElo = Math.round(Number(player.mainElo));
    player.inactivityPenaltyBank = Number(player.inactivityPenaltyBank || 0);
    player.returnGamesInWindow = Number(player.returnGamesInWindow || 0);
    player.returnWindowStartedAt = Number(player.returnWindowStartedAt || 0);
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

    civStats[civ.id] = {
      games,
      wins: Number(existing.wins ?? wins)
    };
  }

  player.mainElo = mainElo;
  player.gamesPlayed = Number(player.gamesPlayed ?? ((player.wins || 0) + (player.losses || 0)));
  player.inactivityPenaltyBank = Number(player.inactivityPenaltyBank || 0);
  player.returnGamesInWindow = Number(player.returnGamesInWindow || 0);
  player.returnWindowStartedAt = Number(player.returnWindowStartedAt || 0);
  player.civStats = civStats;
  player.ratingModelVersion = RATING_MODEL_VERSION;
  return player;
}

export function normalizePlayerRatings(players) {
  return (players || []).map(normalizePlayerRating);
}

export function rebuildInactivityState(players, history) {
  const matches = (history || [])
    .slice()
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b));

  for (const player of players || []) {
    normalizePlayerRating(player);
    const playedAt = matches
      .filter(match => playerParticipated(player, match))
      .map(matchTimestamp)
      .filter(Boolean);

    if (!playedAt.length) continue;

    player.lastPlayedAt = null;
    player.inactivityPenaltyBank = 0;
    player.returnGamesInWindow = 0;
    player.returnWindowStartedAt = 0;

    for (const timestamp of playedAt) {
      applyInactivityGame(player, timestamp);
    }
  }

  return players;
}

export function overallElo(player) {
  return Math.round(permanentElo(player));
}

export function permanentElo(player) {
  normalizePlayerRating(player);
  return Math.round(Number(player.mainElo || DEFAULT_ELO));
}

export function civGames(player, civId) {
  normalizePlayerRating(player);
  return Number(player.civStats?.[civId]?.games || 0);
}

export function uncertaintyPenalty(player, civId) {
  const games = civGames(player, civId);
  return -(INEXPERIENCE_PENALTIES[games] || 0);
}

export function civWinRatePenalty(player, civId) {
  const games = civGames(player, civId);
  if (!games) return 0;

  const winRate = civWinRate(player, civId);
  const deficitRatio = clamp(
    (LOW_WIN_RATE_THRESHOLD - winRate) / LOW_WIN_RATE_THRESHOLD,
    0,
    1
  );

  return Math.round(
    LOW_WIN_RATE_MAX_PENALTY *
      Math.pow(deficitRatio, LOW_WIN_RATE_PENALTY_POWER)
  );
}

export function civWinRate(player, civId) {
  const games = civGames(player, civId);
  if (!games) return 0;

  const wins = Number(player.civStats?.[civId]?.wins || 0);
  return wins / games;
}

export function rawCivBiasPenalty(player, civId) {
  return BASE_CIV_BIAS -
    uncertaintyPenalty(player, civId) +
    civWinRatePenalty(player, civId);
}

export function civBiasAdjustment(player, civId) {
  normalizePlayerRating(player);

  const rankedAdjustments = CIVS
    .map((civ, index) => ({
      id: civ.id,
      index,
      penalty: rawCivBiasPenalty(player, civ.id),
      winRate: civWinRate(player, civ.id),
      games: civGames(player, civ.id)
    }))
    .sort((a, b) => (
      a.penalty - b.penalty ||
      b.winRate - a.winRate ||
      b.games - a.games ||
      a.index - b.index
    ));
  const rank = rankedAdjustments.findIndex(civ => civ.id === civId);

  if (rank >= 0 && rank < 2) return 0;

  const penalty = rankedAdjustments[rank]?.penalty ??
    rawCivBiasPenalty(player, civId);
  return -clamp(Math.max(1, penalty), 1, MAX_CIV_BIAS);
}

export function civElo(player, civId) {
  return ratingBreakdown(player, civId).civElo;
}

export function hardCivLowEloPenalty(player, civId) {
  if (!HARD_CIV_IDS.has(civId)) return 0;

  const elo = overallElo(player);
  if (elo >= HARD_CIV_LOW_ELO_START) return 0;

  const range = HARD_CIV_LOW_ELO_START - HARD_CIV_LOW_ELO_FLOOR;
  const ratio = clamp((HARD_CIV_LOW_ELO_START - elo) / range, 0, 1);
  return -Math.round(HARD_CIV_MAX_LOW_ELO_PENALTY * ratio);
}

export function assignmentPenalty(player, civId, recentCivs = []) {
  if ((player.bannedCivs || []).includes(civId)) return Infinity;

  let penalty = 0;

  if (civGames(player, civId) === 0) penalty += 20;
  if (recentCivs[0] === civId) penalty += 30;

  return penalty;
}

export function rawInactivityPenalty(player, now = Date.now()) {
  if (!player.lastPlayedAt) return 0;

  const daysSince = (now - player.lastPlayedAt) / 86400000;
  if (daysSince < INACTIVE_AFTER_DAYS) return 0;
  if (daysSince >= FULL_PENALTY_AFTER_DAYS) return MAX_INACTIVITY_PENALTY;

  const range = FULL_PENALTY_AFTER_DAYS - INACTIVE_AFTER_DAYS;
  const elapsed = daysSince - INACTIVE_AFTER_DAYS;
  const ramp = elapsed / range;
  return Math.round(
    MIN_INACTIVITY_PENALTY +
      (MAX_INACTIVITY_PENALTY - MIN_INACTIVITY_PENALTY) * ramp
  );
}

export function activeInactivityPenalty(player, now = Date.now()) {
  normalizePlayerRating(player);

  if (player.inactivityPenaltyBank > 0) return player.inactivityPenaltyBank;

  return rawInactivityPenalty(player, now);
}

export function decayedElo(player, now = Date.now()) {
  return ratingBreakdown(player, null, now).displayedMainElo;
}

export function displayElo(player, now = Date.now()) {
  return ratingBreakdown(player, null, now).displayedMainElo;
}

export function balanceElo(player, civId, now = Date.now()) {
  return ratingBreakdown(player, civId, now).balancerElo;
}

export function ratingBreakdown(player, civId = null, now = Date.now()) {
  const mainElo = overallElo(player);
  const civBias = civId ? civBiasAdjustment(player, civId) : 0;
  const positionElo = mainElo + civBias;
  const inactivityPenalty = activeInactivityPenalty(player, now);
  const balancerInactivityPenalty = Math.round(
    inactivityPenalty * BALANCER_INACTIVITY_MULTIPLIER
  );
  const hardCivPenalty = civId ? hardCivLowEloPenalty(player, civId) : 0;

  return {
    mainElo,
    civBias,
    civElo: positionElo,
    inactivityPenalty,
    displayedMainElo: Math.max(100, mainElo - inactivityPenalty),
    displayedCivElo: Math.max(100, positionElo - inactivityPenalty),
    balancerInactivityPenalty,
    hardCivPenalty,
    balancerElo: Math.max(
      100,
      positionElo + hardCivPenalty - balancerInactivityPenalty
    )
  };
}

export function mainKFactor(gamesPlayed) {
  if (gamesPlayed < 10) return 40;
  if (gamesPlayed < 30) return 32;
  return 24;
}

export function activityKMultiplier(gamesPlayed, communityAverageGames) {
  if (!communityAverageGames) return 1;

  const ratio = gamesPlayed / communityAverageGames;
  if (ratio <= 1.5) return 1;
  if (ratio <= 2.5) return 0.9;
  if (ratio <= 4) return 0.8;
  return 0.7;
}

export function effectiveK(player, communityAverageGames) {
  const gamesPlayed = Number(player.gamesPlayed || 0);
  const dampened = mainKFactor(gamesPlayed) *
    activityKMultiplier(gamesPlayed, communityAverageGames);
  return clamp(dampened, 16, 40);
}

export function communityAverageGames(players) {
  const ratedGameCounts = (players || [])
    .map(player => Number(player.gamesPlayed || 0))
    .filter(games => games > 0);

  return ratedGameCounts.length ? average(ratedGameCounts) : 0;
}

export function expectedTeamScore(teamAverage, opponentAverage) {
  return 1 / (1 + Math.pow(10, (opponentAverage - teamAverage) / ELO_EXPECTATION_SCALE));
}

export function ratingDelta(k, actual, expected) {
  return Math.round(k * (actual - expected));
}

export function mainEloDelta(player, won, expected, communityAverageGames) {
  return ratingDelta(effectiveK(player, communityAverageGames), won ? 1 : 0, expected);
}

export function applyRatingResult(
  player,
  civId,
  won,
  expected,
  timestamp = Date.now(),
  communityAverageGames = 0
) {
  normalizePlayerRating(player);
  applyInactivityGame(player, timestamp);

  const mainDelta = mainEloDelta(player, won, expected, communityAverageGames);
  const stats = player.civStats[civId];

  player.mainElo = Math.round(Math.max(100, Number(player.mainElo || DEFAULT_ELO) + mainDelta));
  player.gamesPlayed += 1;
  player.wins = Number(player.wins || 0) + (won ? 1 : 0);
  player.losses = Number(player.losses || 0) + (won ? 0 : 1);

  stats.games += 1;
  stats.wins += won ? 1 : 0;

  return { mainDelta };
}

export function applyMatchRatings(players, match, options = {}) {
  normalizePlayerRatings(players);

  const evilAssignments = match.evilAssign || [];
  const goodAssignments = match.goodAssign || [];
  const winner = normalizeWinner(match.winner || match.result);
  const evilPlayers = matchedPlayers(players, evilAssignments);
  const goodPlayers = matchedPlayers(players, goodAssignments);

  if (!winner || !evilPlayers.length || !goodPlayers.length) return [];

  const evilAverage = average(evilPlayers.map(permanentElo));
  const goodAverage = average(goodPlayers.map(permanentElo));
  const averageGames = Number.isFinite(Number(options.communityAverageGames))
    ? Number(options.communityAverageGames)
    : communityAverageGames(players);
  const evilExpected = expectedTeamScore(evilAverage, goodAverage);
  const timestamp = Number(match.timestamp || Date.now());

  return [
    ...applyTeamRatings(
      players,
      evilAssignments,
      winner === "evil",
      evilExpected,
      timestamp,
      averageGames
    ),
    ...applyTeamRatings(
      players,
      goodAssignments,
      winner === "good",
      1 - evilExpected,
      timestamp,
      averageGames
    )
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

function applyTeamRatings(
  players,
  assignments,
  won,
  expected,
  timestamp,
  communityAverageGames
) {
  const changes = [];

  for (const assignment of assignments) {
    const player = findPlayer(players, assignment);
    const civId = findCivId(assignment.civ || assignment.civId || assignment.civName);
    if (!player || !civId) continue;

    changes.push({
      player,
      civId,
      ...applyRatingResult(
        player,
        civId,
        won,
        expected,
        timestamp,
        communityAverageGames
      )
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

function applyInactivityGame(player, timestamp) {
  const playedAt = Number(timestamp || Date.now());
  const rawPenalty = rawInactivityPenalty(player, playedAt);

  if (rawPenalty > Number(player.inactivityPenaltyBank || 0)) {
    player.inactivityPenaltyBank = rawPenalty;
    player.returnGamesInWindow = 0;
    player.returnWindowStartedAt = 0;
  }

  recordRecoveryGame(player, playedAt);
  player.lastPlayedAt = playedAt;
}

function recordRecoveryGame(player, timestamp) {
  if (player.inactivityPenaltyBank <= 0) return;

  const windowMs = RECOVERY_WINDOW_DAYS * 86400000;
  const windowExpired = !player.returnWindowStartedAt ||
    timestamp - player.returnWindowStartedAt > windowMs;

  if (windowExpired) {
    player.returnWindowStartedAt = timestamp;
    player.returnGamesInWindow = 1;
  } else {
    player.returnGamesInWindow += 1;
  }

  if (player.returnGamesInWindow >= RECOVERY_GAMES_REQUIRED) {
    player.inactivityPenaltyBank = 0;
    player.returnGamesInWindow = 0;
    player.returnWindowStartedAt = 0;
  }
}

function playerParticipated(player, match) {
  return [...(match.evilAssign || []), ...(match.goodAssign || [])]
    .some(assignment => (
      (
        assignment.playerId &&
        String(assignment.playerId) === String(player.id || "")
      ) ||
      (
        assignment.profileId &&
        String(assignment.profileId) === String(player.profileId || "")
      ) ||
      (
        assignment.name &&
        String(assignment.name) === String(player.name || "")
      )
    ));
}

function matchTimestamp(match) {
  const timestamp = Number(match?.timestamp || 0);
  return timestamp > 0 && timestamp < 100000000000
    ? timestamp * 1000
    : timestamp;
}
