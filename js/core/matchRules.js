// Central match-eligibility rules.
//
// Two independent questions are answered here:
//
//   1. Should a raw feed match be imported at all? (lobby name + shape gates)
//   2. Should an imported match count towards Elo? (admin override)
//
// Keeping both in one pure module means the importer, the rating replay and the
// admin panel all agree on one definition of "a LOTR game". scrape_matches.py
// keeps its own copy of LOBBY_KEYWORDS; change both together.

export const LOBBY_KEYWORDS = ["lotr", "bfme", "hobbit", "bobbit"];

export const MIN_MATCH_SECONDS = 600;
export const MIN_MATCH_MEMBERS = 8;
export const MIN_COMMUNITY_PLAYERS = 4;

// Raw feed matches carry the lobby title in `description`; matches already
// stored in Firestore carry the same string in `mapName`.
export function lobbyNameOf(match) {
  return String(
    match?.description || match?.mapName || match?.mapname || ""
  );
}

export function lobbyNameAllowed(name) {
  const text = String(name || "").toLowerCase();
  if (!text) return false;
  return LOBBY_KEYWORDS.some(keyword => text.includes(keyword));
}

export function lobbyAllowed(match) {
  return lobbyNameAllowed(lobbyNameOf(match));
}

// `eloExcluded` is stamped onto history docs by the data layer from the
// matchOverrides collection. Anything reading ratings must respect it.
export function isEloExcluded(match) {
  return match?.eloExcluded === true;
}

export function ratingEligibleHistory(history) {
  return (history || []).filter(match => !isEloExcluded(match));
}

// ---------------------------------------------------------------------------
// Import gates
//
// Kept pure and free of Firebase imports so they can be unit tested in Node.
// matchImportService supplies `forced` from the admin override collection.
// ---------------------------------------------------------------------------

export const REJECT_LOBBY_NAME = "lobbyName";
export const REJECT_TOO_SHORT = "tooShort";
export const REJECT_PLAYER_COUNT = "playerCount";
export const REJECT_COMMUNITY = "notEnoughCommunity";
export const REJECT_NO_RESULT = "noResult";
export const REJECT_NO_TEAMS = "noTeams";

export const REJECT_LABELS = {
  [REJECT_LOBBY_NAME]: "Lobby name has no LOTR/BFME/Hobbit/Bobbit keyword",
  [REJECT_TOO_SHORT]: "Shorter than 10 minutes",
  [REJECT_PLAYER_COUNT]: "Fewer than 8 players",
  [REJECT_COMMUNITY]: "Fewer than 4 community members",
  [REJECT_NO_RESULT]: "Feed reported no winner",
  [REJECT_NO_TEAMS]: "Teams could not be determined"
};

// Reasons an admin can override. noResult/noTeams cannot be overridden: without
// a winner or teams there is nothing to record.
export const OVERRIDABLE_REJECTIONS = new Set([
  REJECT_LOBBY_NAME,
  REJECT_TOO_SHORT,
  REJECT_PLAYER_COUNT,
  REJECT_COMMUNITY
]);

export function feedMatchMeta(rawMatch, communityIds) {
  const members =
    rawMatch?.matchhistorymember || rawMatch?.matchhistoryreportresults || [];
  const duration =
    rawMatch?.completiontime && rawMatch?.startgametime
      ? Number(rawMatch.completiontime) - Number(rawMatch.startgametime)
      : null;

  return {
    gameId: String(rawMatch?.match_id || rawMatch?.id || ""),
    lobbyName: lobbyNameOf(rawMatch),
    members,
    duration,
    memberCount: members.length,
    communityCount: members.filter(member =>
      communityIds?.has?.(Number(member.profile_id))
    ).length
  };
}

// Returns the soft gate that rejects this match, or null when it passes them
// all. `forced` skips every soft gate.
export function softRejectionReason(meta, forced = false) {
  if (!meta.gameId) return REJECT_PLAYER_COUNT;
  if (forced) return null;
  if (!lobbyNameAllowed(meta.lobbyName)) return REJECT_LOBBY_NAME;
  if (meta.memberCount < MIN_MATCH_MEMBERS) return REJECT_PLAYER_COUNT;
  if (meta.duration !== null && meta.duration < MIN_MATCH_SECONDS) {
    return REJECT_TOO_SHORT;
  }
  if (meta.communityCount < MIN_COMMUNITY_PLAYERS) return REJECT_COMMUNITY;
  return null;
}

// ---------------------------------------------------------------------------
// Admin match overrides (pure part)
//
// The Firestore reads/writes live in js/data/matchOverrides.js, which
// re-exports these. They are kept here, free of Firebase imports, so that Node
// tooling -- scripts/build-ratings.mjs -- can apply overrides without pulling
// the browser SDK in from a CDN.
// ---------------------------------------------------------------------------

export const OVERRIDE_EXCLUDE = "exclude";
export const OVERRIDE_INCLUDE = "include";

export function overrideKey(match) {
  return String(
    match?.gameId || match?.matchId || match?.match_id || match?.id || ""
  );
}

// Stamps `eloExcluded` onto each history doc so everything downstream reads a
// plain boolean instead of consulting the override map.
export function applyOverridesToHistory(history, overrides) {
  const map = overrides || new Map();
  if (!map.size) return history || [];

  return (history || []).map(match => {
    const override = map.get(overrideKey(match));
    return override?.mode === OVERRIDE_EXCLUDE
      ? { ...match, eloExcluded: true, eloExcludedReason: override.reason || "" }
      : match;
  });
}
