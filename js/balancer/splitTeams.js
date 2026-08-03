import { EVIL_CIVS, GOOD_CIVS } from "../core/constants.js";
import { assignmentOptions } from "./assignments.js";

export const BALANCED_SCORE_RANGE = 60;
export const RANDOM_SCORE_RANGE = 200;
export const DEFAULT_OPTION_COUNT = 3;
export const STRONG_OPTION_POSITION_CHANGES = 6;
export const MIN_OPTION_POSITION_CHANGES = 4;

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

  return withMetadata(chosen, {
    bestScore,
    scoreRange,
    eligibleCount: eligible.length,
    selectionMode: options.random ? "random" : "balanced"
  });
}

export function splitTeamOptions(selectedPlayers, options = {}) {
  if (selectedPlayers.length !== 8) return [];

  const candidates = buildCandidates(selectedPlayers);
  if (!candidates.length) return [];

  candidates.sort((a, b) => a.score - b.score);

  const bestScore = candidates[0].score;
  const scoreRange = options.random
    ? RANDOM_SCORE_RANGE
    : BALANCED_SCORE_RANGE;
  const eligible = candidates.filter(candidate => candidate.score <= bestScore + scoreRange);
  const count = Math.max(1, Number(options.count || DEFAULT_OPTION_COUNT));
  const previousSignatures = new Set(options.previousSignatures || []);
  const eligibleAlternatives = eligible.filter(candidate => !previousSignatures.has(candidate.signature));
  const candidateAlternatives = candidates.filter(candidate => !previousSignatures.has(candidate.signature));
  const eligiblePool = eligibleAlternatives.length >= count
    ? eligibleAlternatives
    : eligible;
  const candidatePool = candidateAlternatives.length >= count
    ? candidateAlternatives
    : candidates;
  const selected = [];
  const metadata = {
    bestScore,
    scoreRange,
    eligibleCount: eligible.length,
    selectionMode: options.random ? "random" : "balanced"
  };

  addDistantOptions(
    selected,
    shuffled(eligiblePool),
    metadata,
    count,
    STRONG_OPTION_POSITION_CHANGES
  );
  if (selected.length === count) return selected;

  addDistantOptions(
    selected,
    shuffled(candidatePool),
    metadata,
    count,
    STRONG_OPTION_POSITION_CHANGES
  );
  if (selected.length === count) return selected;

  addDistantOptions(
    selected,
    shuffled(candidatePool),
    metadata,
    count,
    MIN_OPTION_POSITION_CHANGES
  );

  return selected;
}

function shuffled(items) {
  const shuffledItems = [...items];

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const replacementIndex = Math.floor(Math.random() * (index + 1));
    [shuffledItems[index], shuffledItems[replacementIndex]] = [
      shuffledItems[replacementIndex],
      shuffledItems[index]
    ];
  }

  return shuffledItems;
}

function addDistantOptions(selected, candidates, metadata, count, minChanges) {
  for (const candidate of candidates) {
    if (selected.length === count) return;
    if (selected.some(option => option.signature === candidate.signature)) continue;
    if (minAssignmentDistance(candidate, selected) < minChanges) continue;
    selected.push(withMetadata(candidate, {
      ...metadata,
      minOptionPositionChanges: minAssignmentDistance(candidate, selected)
    }));
  }
}

function minAssignmentDistance(candidate, selected) {
  if (!selected.length) return 8;
  return Math.min(...selected.map(option => assignmentDistance(candidate, option)));
}

function assignmentDistance(left, right) {
  const rightBySlot = assignmentSlotMap(right);

  return assignmentSlots(left).reduce((changes, slot) => (
    rightBySlot.get(slot.civId) === slot.playerId ? changes : changes + 1
  ), 0);
}

function assignmentSlotMap(split) {
  return new Map(assignmentSlots(split).map(slot => [slot.civId, slot.playerId]));
}

function assignmentSlots(split) {
  return [...split.evil.assignment, ...split.good.assignment].map(item => ({
    civId: item.civ.id,
    playerId: item.player.id
  }));
}

function withMetadata(candidate, metadata) {
  return {
    ...candidate,
    ...metadata
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
