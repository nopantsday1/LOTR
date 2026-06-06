import { EVIL_CIVS, GOOD_CIVS } from "../core/constants.js";
import { assignmentOptions } from "./assignments.js";

export const BALANCED_SCORE_RANGE = 60;
export const RANDOM_SCORE_RANGE = 200;

export function splitTeams(selectedPlayers, options = {}) {
  if (selectedPlayers.length !== 8) return null;

  const candidates = buildCandidates(selectedPlayers);
  if (!candidates.length) return null;

  candidates.sort((a, b) => a.score - b.score);

  const bestScore = candidates[0].score;
  const scoreRange = options.random
    ? RANDOM_SCORE_RANGE
    : BALANCED_SCORE_RANGE;
  const eligible = candidates.filter(candidate => candidate.score <= bestScore + scoreRange);
  const alternatives = options.random && options.previousTeamSignature
    ? eligible.filter(candidate => candidate.teamSignature !== options.previousTeamSignature)
    : options.previousSignature
      ? eligible.filter(candidate => candidate.signature !== options.previousSignature)
      : eligible;
  const pool = alternatives.length ? alternatives : eligible;
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  return {
    ...chosen,
    bestScore,
    scoreRange,
    eligibleCount: eligible.length,
    selectionMode: options.random ? "random" : "balanced"
  };
}

function buildCandidates(selectedPlayers) {
  const candidates = [];

  for (const evilPlayers of combinations(selectedPlayers, 4)) {
    const evilIds = new Set(evilPlayers.map(player => player.id));
    const goodPlayers = selectedPlayers.filter(player => !evilIds.has(player.id));
    const evilOptions = assignmentOptions(evilPlayers, EVIL_CIVS);
    const goodOptions = assignmentOptions(goodPlayers, GOOD_CIVS);

    for (const evil of evilOptions) {
      for (const good of goodOptions) {
        const diff = Math.abs(evil.total - good.total);
        const assignmentPenalty = evil.penalty + good.penalty;
        const score = diff + assignmentPenalty;

        candidates.push({
          evil,
          good,
          diff,
          assignmentPenalty,
          score,
          signature: assignmentSignature(evil, good),
          teamSignature: teamSignature(evil, good)
        });
      }
    }
  }

  return candidates;
}

function teamSignature(evil, good) {
  return [
    `evil:${evil.assignment.map(item => item.player.id).sort().join(",")}`,
    `good:${good.assignment.map(item => item.player.id).sort().join(",")}`
  ].join("|");
}

function assignmentSignature(evil, good) {
  return [
    ...evil.assignment.map(item => `evil:${item.civ.id}:${item.player.id}`),
    ...good.assignment.map(item => `good:${item.civ.id}:${item.player.id}`)
  ].sort().join("|");
}

function* combinations(items, size, start = 0, chosen = []) {
  if (chosen.length === size) {
    yield chosen;
    return;
  }

  for (let index = start; index <= items.length - (size - chosen.length); index++) {
    yield* combinations(items, size, index + 1, [...chosen, items[index]]);
  }
}
