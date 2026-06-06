import { EVIL_CIVS, GOOD_CIVS } from "../core/constants.js";
import { assignmentOptions } from "./assignments.js";

export function splitTeams(selectedPlayers) {
  if (selectedPlayers.length !== 8) return null;

  let best = null;

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

        if (!best || score < best.score) {
          best = {
            evil,
            good,
            diff,
            assignmentPenalty,
            score
          };
        }
      }
    }
  }

  return best;
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
