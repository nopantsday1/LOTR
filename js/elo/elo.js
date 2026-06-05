import { CIVS, DEFAULT_ELO } from "../core/constants.js";

export const BASE_WEIGHT = 0.25;
export const DECAY_GRACE_DAYS = 30;
export const DECAY_RATE_PER_DAY = 1;
export const DECAY_MAX = 150;
export const DECAY_FLOOR = 600;

export function civElo(player, civId) {
  return Math.max(100, player.civElo?.[civId] ?? DEFAULT_ELO);
}

export function overallElo(player) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const civ of CIVS) {
    const games = (player.civWins?.[civ.id] || 0) + (player.civLosses?.[civ.id] || 0);
    const weight = BASE_WEIGHT + Math.sqrt(games);

    weightedSum += civElo(player, civ.id) * weight;
    totalWeight += weight;
  }

  return Math.round(weightedSum / totalWeight);
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

export function effectiveCivElo(player, civId) {
  const games = (player.civWins?.[civId] || 0) + (player.civLosses?.[civId] || 0);
  const decay = decayAmount(player);

  let base;
  if (games >= 5) {
    base = civElo(player, civId);
  } else {
    const experiencedElos = CIVS
      .filter(c => (player.civWins?.[c.id] || 0) + (player.civLosses?.[c.id] || 0) >= 5)
      .map(c => civElo(player, c.id));

    base = experiencedElos.length ? Math.min(...experiencedElos) : overallElo(player);
  }

  return Math.max(base - decay, DECAY_FLOOR);
}

export function kFactor(totalGames, civGames) {
  if (civGames < 5) return 200;
  if (totalGames < 20) return 128;
  if (totalGames < 40) return 64;
  return 32;
}

export function calcElo(elo, opponentAverage, won, totalGames, civGames = 99) {
  const k = kFactor(totalGames, civGames);
  const expected = 1 / (1 + Math.pow(10, (opponentAverage - elo) / 400));
  return Math.max(100, Math.round(elo + k * ((won ? 1 : 0) - expected)));
}
