import { LOTR_KEYWORDS, LOTR_MAPS } from "../core/constants.js";

export function isLotrMatch(match) {
  const description = (match.description || match.mapname || "").toLowerCase();
  const map = (match.mapname || "").toLowerCase();

  return LOTR_KEYWORDS.some(k => description.includes(k)) ||
    LOTR_MAPS.some(k => map.includes(k));
}

export function playerProfileIds(player) {
  const ids = [];
  if (player.profileId) ids.push(Number(player.profileId));
  (player.altProfileIds || []).forEach(id => {
    if (id) ids.push(Number(id));
  });
  return ids;
}

export function buildCommunityIdSet(players) {
  const set = new Set();
  players.forEach(player => playerProfileIds(player).forEach(id => set.add(id)));
  return set;
}

export function buildProfileMap(players) {
  const map = {};
  players.forEach(player => {
    playerProfileIds(player).forEach(id => {
      map[id] = player;
    });
  });
  return map;
}
