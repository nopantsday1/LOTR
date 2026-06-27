import { CIVS, normalizeCivName } from "../core/constants.js";
import { ratingBreakdown } from "./elo.js";
import {
  applyReplayMatchRatings,
  resetPlayerForReplay
} from "./progress.js";

export function buildBalancerBacktest(players, history) {
  const replayPlayers = (players || []).map(resetPlayerForReplay);
  const matches = (history || [])
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const results = [];

  for (const match of matches) {
    const winner = normalizeWinner(match);
    const timestamp = normalizedTimestamp(match);
    const evilTotal = preMatchTeamTotal(
      replayPlayers,
      match.evilAssign,
      timestamp
    );
    const goodTotal = preMatchTeamTotal(
      replayPlayers,
      match.goodAssign,
      timestamp
    );

    if (
      winner &&
      Number.isFinite(evilTotal) &&
      Number.isFinite(goodTotal)
    ) {
      const predictedWinner = evilTotal === goodTotal
        ? ""
        : evilTotal > goodTotal
          ? "evil"
          : "good";
      const durationSeconds = normalizedDuration(match);

      results.push({
        match,
        winner,
        predictedWinner,
        correct: predictedWinner ? predictedWinner === winner : null,
        evilTotal,
        goodTotal,
        eloGap: Math.abs(evilTotal - goodTotal),
        durationSeconds
      });
    }

    applyReplayMatchRatings(replayPlayers, match);
  }

  return summarizeBalancerBacktest(results);
}

export function summarizeBalancerBacktest(matches) {
  const comparable = matches.filter(match => match.predictedWinner);
  const correct = comparable.filter(match => match.correct).length;
  const ties = matches.length - comparable.length;
  const durationMatches = matches.filter(match =>
    Number.isFinite(match.durationSeconds) && match.durationSeconds > 0
  );
  const correlation = pearsonCorrelation(
    durationMatches.map(match => match.eloGap),
    durationMatches.map(match => match.durationSeconds)
  );
  const regression = linearRegression(
    durationMatches.map(match => match.eloGap),
    durationMatches.map(match => match.durationSeconds)
  );

  return {
    matches,
    prediction: {
      correct,
      incorrect: comparable.length - correct,
      ties,
      comparable: comparable.length,
      accuracy: comparable.length ? correct / comparable.length : NaN
    },
    duration: {
      matches: durationMatches,
      correlation,
      slopeSecondsPerElo: regression.slope,
      interceptSeconds: regression.intercept
    }
  };
}

function preMatchTeamTotal(players, assignments, timestamp) {
  if (!Array.isArray(assignments) || assignments.length !== 4) return NaN;

  const ratings = assignments.map(assignment => {
    const player = findPlayer(players, assignment);
    const civId = findCivId(
      assignment.civId || assignment.civ || assignment.civName
    );
    if (!player || !civId) return NaN;
    return ratingBreakdown(player, civId, timestamp).balancerElo;
  });

  if (ratings.some(rating => !Number.isFinite(rating))) return NaN;
  return ratings.reduce((sum, rating) => sum + rating, 0);
}

function findPlayer(players, assignment) {
  const profileId = String(assignment?.profileId || "");
  const name = String(assignment?.name || assignment?.playerName || "");

  return players.find(player => (
    (
      profileId &&
      player.profileId &&
      String(player.profileId) === profileId
    ) ||
    String(player.name || "") === name
  ));
}

function findCivId(value) {
  if (!value) return null;
  const normalized = normalizeCivName(String(value)).toLocaleLowerCase();

  return CIVS.find(civ => (
    civ.id === normalized ||
    normalizeCivName(civ.name).toLocaleLowerCase() === normalized
  ))?.id || normalized.match(/\bp[1-8]\b/)?.[0] || null;
}

function normalizeWinner(match) {
  const winner = String(match?.winner || match?.result || "").toLocaleLowerCase();
  if (winner.includes("evil")) return "evil";
  if (winner.includes("good")) return "good";
  return "";
}

function normalizedTimestamp(match) {
  const timestamp = Number(match?.timestamp || Date.parse(match?.date || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Date.now();
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function normalizedDuration(match) {
  const duration = Number(match?.durationSeconds ?? match?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return NaN;
  return duration > 100000 ? duration / 1000 : duration;
}

function pearsonCorrelation(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return NaN;

  const meanX = average(xs);
  const meanY = average(ys);
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator ? covariance / denominator : NaN;
}

function linearRegression(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) {
    return { slope: NaN, intercept: NaN };
  }

  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - meanX;
    numerator += dx * (ys[index] - meanY);
    denominator += dx * dx;
  }

  const slope = denominator ? numerator / denominator : NaN;
  return {
    slope,
    intercept: Number.isFinite(slope) ? meanY - slope * meanX : NaN
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
