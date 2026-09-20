// Infers games in progress by watching lobbies disappear.
//
// The AoE2 API has no notion of a running game. findAdvertisements returns only
// lobbies in state 0 (waiting) and carries no timestamps at all, and match
// history contains nothing until a game has finished. A lobby simply vanishes
// the moment it starts and the match reappears, completed, some time later.
//
// So the only way to know a community game is underway is to have watched it
// begin: remember the community lobbies seen on each poll, and when one stops
// being advertised, treat it as started. That gives a roster and a start time
// accurate to the polling interval.
//
// Consequences worth being honest about in the UI:
//   - This only works if someone had the Live page open when the game started.
//   - The elapsed time is an estimate, bounded by how often we polled.
//   - A lobby that was closed rather than started looks identical, so entries
//     expire, and are cleared as soon as the match shows up in the feed.

const STORAGE_KEY = "lotr-lobby-tracker-v1";

// A LOTR game runs well under two hours; anything older is a lobby that was
// abandoned rather than started.
const MAX_TRACK_MS = 2 * 60 * 60 * 1000;

// Below this a "game" is more likely a lobby that closed than one that started.
const MIN_PLAUSIBLE_MS = 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Private windows and blocked storage both land here; tracking is a bonus,
    // not something the page depends on.
    return {};
  }
}

function write(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: degrade to no tracking */
  }
}

/**
 * Records this poll's community lobbies and returns the ones that have
 * disappeared since the last poll.
 *
 * @param {Array} communityLobbies lobbies with enough recognised players
 * @param {Set<string>} finishedGameIds match ids already present in the feed
 * @returns {{ inProgress: Array }} games believed to be underway
 */
export function trackLobbies(communityLobbies, finishedGameIds = new Set()) {
  const now = Date.now();
  const stored = read();
  const next = {};
  const seenNow = new Set();

  // Anything still advertised is still waiting, not started.
  for (const lobby of communityLobbies || []) {
    const id = String(lobby.id);
    seenNow.add(id);
    const previous = stored[id];

    next[id] = {
      id,
      description: lobby.description,
      firstSeen: previous?.firstSeen || now,
      lastSeen: now,
      started: false,
      roster: lobby.members.map(member => ({
        name: member.name,
        isCommunity: member.isCommunity,
        playerId: member.player?.id || null
      })),
      communityCount: lobby.communityMembers.length,
      memberCount: lobby.memberCount
    };
  }

  const inProgress = [];

  for (const [id, entry] of Object.entries(stored)) {
    if (seenNow.has(id)) continue;

    const age = now - Number(entry.lastSeen || 0);

    // Expired, implausibly short, or the match already finished and landed in
    // the feed: stop tracking either way.
    if (age > MAX_TRACK_MS) continue;
    if (finishedGameIds.has(String(id))) continue;

    const carried = { ...entry, started: true, startedAt: entry.lastSeen };
    next[id] = carried;

    if (age >= MIN_PLAUSIBLE_MS) {
      inProgress.push({ ...carried, elapsedMs: age });
    }
  }

  write(next);
  return { inProgress: inProgress.sort((a, b) => a.elapsedMs - b.elapsedMs) };
}

// Called when a tracked game turns up in the match feed, so a finished game
// stops being reported as running.
export function forgetLobby(id) {
  const stored = read();
  delete stored[String(id)];
  write(stored);
}

export function clearTracker() {
  write({});
}

export function describeElapsed(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// How long a lobby has been sitting open, from when this browser first saw it.
export function describeWaiting(firstSeenMs) {
  if (!firstSeenMs) return "";
  const minutes = Math.floor((Date.now() - firstSeenMs) / 60000);
  if (minutes < 1) return "just opened";
  if (minutes < 60) return `waiting ${minutes} min`;
  return `waiting ${Math.floor(minutes / 60)}h+`;
}

export function lobbyFirstSeen(id) {
  return Number(read()[String(id)]?.firstSeen) || 0;
}
