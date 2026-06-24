import { CIVS, normalizeCivName } from "../core/constants.js";
import { state } from "../core/state.js";
import {
  assignmentPenalty,
  civBiasAdjustment,
  civModifier,
  confidenceWeight,
  effectiveCivElo,
  hardCivLowEloPenalty,
  preferenceBonus,
  uncertaintyPenalty
} from "../elo/elo.js";

export function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }

  for (let index = 0; index < items.length; index++) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const permutation of permutations(rest)) {
      yield [items[index], ...permutation];
    }
  }
}

export function assignmentOptions(players, civs) {
  const recentCivs = recentCivsByPlayer(players);
  const options = [];

  for (const permutation of permutations(civs)) {
    const assignment = players.map((player, index) => {
      const civ = permutation[index];
      const recent = recentCivs[player.id] || [];

      return {
        player,
        civ,
        elo: effectiveCivElo(player, civ.id),
        civBias: civBiasAdjustment(player, civ.id),
        modifier: civModifier(player, civ.id),
        confidence: confidenceWeight(player, civ.id),
        preferenceBonus: preferenceBonus(player, civ.id),
        uncertaintyPenalty: uncertaintyPenalty(player, civ.id),
        hardCivPenalty: hardCivLowEloPenalty(player, civ.id),
        penalty: assignmentPenalty(player, civ.id, recent)
      };
    });

    if (assignment.some(item => !Number.isFinite(item.penalty))) continue;

    options.push({
      assignment,
      total: assignment.reduce((sum, item) => sum + item.elo, 0),
      penalty: assignment.reduce((sum, item) => sum + item.penalty, 0)
    });
  }

  return options;
}

export function bestAssign(players, civs) {
  return assignmentOptions(players, civs)
    .sort((a, b) => a.penalty - b.penalty || b.total - a.total)[0] || null;
}

function recentCivsByPlayer(players) {
  const result = {};
  const history = state.fullHistory?.length ? state.fullHistory : state.history;

  for (const player of players) {
    result[player.id] = history
      .filter(match => [...(match.evilAssign || []), ...(match.goodAssign || [])]
        .some(assignment => assignmentMatchesPlayer(assignment, player)))
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .map(match => [...(match.evilAssign || []), ...(match.goodAssign || [])]
        .find(assignment => assignmentMatchesPlayer(assignment, player)))
      .map(assignment => findCivId(assignment?.civName || assignment?.civ || assignment?.civId))
      .filter(Boolean)
      .slice(0, 3);
  }

  return result;
}

function assignmentMatchesPlayer(assignment, player) {
  if (
    assignment.profileId &&
    player.profileId &&
    String(assignment.profileId) === String(player.profileId)
  ) {
    return true;
  }

  return String(assignment.name || assignment.playerName || "") === String(player.name || "");
}

function findCivId(value) {
  if (!value) return null;
  const normalized = normalizeCivName(String(value)).toLowerCase();

  return CIVS.find(civ => (
    normalizeCivName(civ.name).toLowerCase() === normalized ||
    civ.id === normalized
  ))?.id || normalized.match(/\bp[1-8]\b/)?.[0] || null;
}
