import { CIVS, normalizeCivName } from "../core/constants.js";
import { state } from "../core/state.js";
import { effectiveCivElo } from "../elo/elo.js";

export function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) {
      yield [items[i], ...p];
    }
  }
}

export function bestAssign(players, civs) {
  const recentCivs = {};
  const playedCivs = {};

  for (const player of players) {
    const matches = state.history
      .filter(h => [...(h.evilAssign || []), ...(h.goodAssign || [])].some(a => a.name === player.name))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    recentCivs[player.id] = [];
    playedCivs[player.id] = new Set();

    for (const match of matches) {
      const assignment = [...(match.evilAssign || []), ...(match.goodAssign || [])].find(a => a.name === player.name);
      if (!assignment?.civName) continue;

      const civ = CIVS.find(c => normalizeCivName(c.name) === normalizeCivName(assignment.civName));
      if (!civ) continue;

      if (civs.some(c => c.id === civ.id)) {
        if (recentCivs[player.id].length < 3) recentCivs[player.id].push(civ.id);
        playedCivs[player.id].add(civ.id);
      }
    }
  }

  function adjustedElo(player, civId) {
    if ((player.bannedCivs || []).includes(civId)) return -Infinity;

    let elo = effectiveCivElo(player, civId);

    if ((player.favCivs || []).includes(civId)) elo = Math.round(elo * 1.40);
    if ((player.avoidCivs || []).includes(civId)) elo = Math.round(elo * 0.60);

    const recent = recentCivs[player.id] || [];
    if (recent[0] === civId) elo = Math.round(elo * 0.65);
    if (recent[1] === civId) elo = Math.round(elo * 0.80);
    if (recent[2] === civId) elo = Math.round(elo * 0.90);

    return elo;
  }

  let best = null;

  for (const perm of permutations(civs)) {
    const assignment = players.map((player, i) => {
      const civ = perm[i];
      return {
        player,
        civ,
        elo: adjustedElo(player, civ.id),
      };
    });

    if (assignment.some(a => a.elo === -Infinity)) continue;

    const total = assignment.reduce((sum, a) => sum + a.elo, 0);
    if (!best || total > best.total) {
      best = { assignment, total };
    }
  }

  return best;
}
