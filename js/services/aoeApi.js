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

// Resolves a lobby.json payload against the community roster.
//
// Shared by the Live page and the Balance page's "Select from lobby" button so
// they always agree on which lobby is "the" community game and who is in it.
export function resolveLobbies(data, players, minCommunity = 2) {
  const profileMap = buildProfileMap(players || []);
  const aliases = new Map(
    (data?.avatars || []).map(a => [Number(a.profile_id), a.alias])
  );

  const lobbies = (data?.matches || []).map(lobby => {
    const members = (lobby.matchmembers || [])
      .map(member => Number(member.profile_id))
      .filter(Number.isFinite)
      .map(profileId => {
        const player = profileMap[profileId] || null;
        return {
          profileId,
          player,
          name: player?.name || aliases.get(profileId) || `Player ${profileId}`,
          isCommunity: Boolean(player)
        };
      });

    return {
      id: lobby.id,
      description: lobby.description || "",
      maxplayers: lobby.maxplayers,
      memberCount: members.length,
      members,
      communityMembers: members.filter(member => member.isCommunity)
    };
  });

  // Most recognised players wins; ties break toward the fuller lobby.
  const community = lobbies
    .filter(lobby => lobby.communityMembers.length >= minCommunity)
    .sort((a, b) =>
      b.communityMembers.length - a.communityMembers.length ||
      b.memberCount - a.memberCount
    );

  return { lobbies, community, best: community[0] || null };
}
