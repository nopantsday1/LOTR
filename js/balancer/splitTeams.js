import { EVIL_CIVS, GOOD_CIVS } from "../core/constants.js";
import { bestAssign } from "./assignments.js";

export function splitTeams(selectedPlayers) {
  // TODO: move the original "top 3 balanced splits" algorithm here.
  // This placeholder makes one simple 4/4 split and assigns civs.
  const evilPlayers = selectedPlayers.slice(0, 4);
  const goodPlayers = selectedPlayers.slice(4, 8);

  const evil = bestAssign(evilPlayers, EVIL_CIVS);
  const good = bestAssign(goodPlayers, GOOD_CIVS);

  return {
    evil,
    good,
    diff: Math.abs((evil?.total || 0) - (good?.total || 0)),
  };
}
