import { CIVS, DEFAULT_ELO, TEAMID_MAP } from "../core/constants.js";
import { LOCAL_SANDBOX } from "../core/config.js";
import { state } from "../core/state.js";
import {
  applyMatchRatings,
  civElo,
  normalizePlayerRating,
  overallElo,
} from "../elo/elo.js";
import { firestoreApi as fb } from "../data/firebase.js";
import { buildCommunityIdSet, buildProfileMap } from "./aoeApi.js";
import { fetchMatchesJson } from "./matchesService.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const EVIL_POSITIONS = new Set(["p1", "p2", "p3", "p4"]);
const GOOD_POSITIONS = new Set(["p5", "p6", "p7", "p8"]);
const POSITION_ORDER = CIVS.map(civ => civ.id);

let importPromise = null;
let pollTimer = null;

export function startAutoMatchImport() {
  if (LOCAL_SANDBOX || pollTimer) return;

  window.addEventListener("lotr:dataChanged", () => {
    importNewMatches().catch(error => console.warn("[match import]", error));
  }, { once: true });

  window.setTimeout(() => {
    importNewMatches().catch(error => console.warn("[match import]", error));
  }, 5000);

  pollTimer = window.setInterval(() => {
    importNewMatches().catch(error => console.warn("[match import]", error));
  }, POLL_INTERVAL_MS);
}

export function importNewMatches() {
  if (LOCAL_SANDBOX) {
    return Promise.resolve({ added: 0, skipped: true });
  }
  if (importPromise) return importPromise;

  importPromise = runImport().finally(() => {
    importPromise = null;
  });
  return importPromise;
}

async function runImport() {
  if (!state.db || !state.players.length) {
    return { added: 0, waiting: true };
  }

  const data = await fetchMatchesJson();
  const matches = (data.matches || [])
    .slice()
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b));
  const known = new Set(
    (state.fullHistory || [])
      .flatMap(match => [match.id, match.gameId])
      .filter(Boolean)
      .map(String)
  );
  const identityPlayers = state.playerDatasets.original?.length
    ? state.playerDatasets.original
    : state.players;
  const communityIds = buildCommunityIdSet(identityPlayers);
  const profileMap = buildProfileMap(identityPlayers);
  const normalizedMatches = matches
    .map(rawMatch => normalizeMatch(rawMatch, communityIds, profileMap))
    .filter(Boolean);
  const previewAdded = mergeFeedMatchesIntoState(normalizedMatches, known);
  let added = 0;
  let writeError = null;

  for (const normalized of normalizedMatches) {
    if (known.has(normalized.gameId)) continue;

    try {
      if (await recordMatch(normalized)) {
        known.add(normalized.gameId);
        added += 1;
      }
    } catch (error) {
      writeError = error;
      console.warn("[match import] Firebase write failed", error);
      break;
    }
  }

  return {
    added,
    previewAdded,
    writeError,
    checked: matches.length,
    feedUpdatedAt: Number(data.updated || 0) * 1000 || null,
  };
}

function mergeFeedMatchesIntoState(matches, known) {
  const previewMatches = matches
    .filter(match => !known.has(match.gameId))
    .map(match => {
      const evilTotal = teamTotal(match.evilAssign);
      const goodTotal = teamTotal(match.goodAssign);

      return {
        id: match.gameId,
        date: new Date(match.timestamp).toLocaleDateString("en-CA"),
        winner: match.winner,
        evilTotal,
        goodTotal,
        gap: Math.abs(evilTotal - goodTotal),
        timestamp: match.timestamp,
        source: "feed",
        gameId: match.gameId,
        duration: match.duration,
        mapName: match.mapName,
        evilAssign: serializeAssignments(match.evilAssign),
        goodAssign: serializeAssignments(match.goodAssign),
      };
    });

  if (!previewMatches.length) return 0;

  const byGameId = new Map();
  for (const match of [...previewMatches, ...(state.fullHistory || [])]) {
    byGameId.set(String(match.gameId || match.id), match);
  }

  state.fullHistory = [...byGameId.values()]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  state.history = state.fullHistory.slice(0, 100);
  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));

  return previewMatches.length;
}

function normalizeMatch(rawMatch, communityIds, profileMap) {
  const gameId = String(rawMatch.match_id || rawMatch.id || "");
  const members = rawMatch.matchhistorymember || rawMatch.matchhistoryreportresults || [];
  const duration = rawMatch.completiontime && rawMatch.startgametime
    ? Number(rawMatch.completiontime) - Number(rawMatch.startgametime)
    : null;

  if (!gameId || members.length < 8 || (duration !== null && duration < 600)) {
    return null;
  }
  if (members.filter(member => communityIds.has(Number(member.profile_id))).length < 4) {
    return null;
  }

  const hasPositions = members.some(member => positionFor(member));
  const isEvil = member => {
    const position = positionFor(member);
    return hasPositions
      ? EVIL_POSITIONS.has(position)
      : Number(member.teamid) >= 5 && Number(member.teamid) <= 8;
  };
  const isGood = member => {
    const position = positionFor(member);
    return hasPositions
      ? GOOD_POSITIONS.has(position)
      : Number(member.teamid) >= 9 && Number(member.teamid) <= 12;
  };
  const evilMembers = members.filter(isEvil).sort(comparePositions);
  const goodMembers = members.filter(isGood).sort(comparePositions);
  if (!evilMembers.length || !goodMembers.length) return null;

  const evilWins = evilMembers.filter(member => Number(member.resulttype) === 1).length;
  const goodWins = goodMembers.filter(member => Number(member.resulttype) === 1).length;
  if (!evilWins && !goodWins) return null;

  return {
    gameId,
    winner: evilWins > goodWins ? "evil" : "good",
    timestamp: matchTimestamp(rawMatch) || Date.now(),
    duration,
    mapName: rawMatch.description || rawMatch.mapname || "LOTR Match",
    evilAssign: evilMembers.map(member => buildAssignment(member, profileMap)),
    goodAssign: goodMembers.map(member => buildAssignment(member, profileMap)),
  };
}

async function recordMatch(match) {
  const historyRef = fb.doc(state.db, "history", match.gameId);
  let recorded = false;

  await fb.runTransaction(state.db, async transaction => {
    const existing = await transaction.get(historyRef);
    if (existing.exists()) return;

    const uniquePlayerIds = [...new Set(
      [...match.evilAssign, ...match.goodAssign]
        .map(assignment => assignment.playerId)
        .filter(Boolean)
    )];
    const playerRefs = uniquePlayerIds.map(id =>
      fb.doc(state.db, "players", String(id))
    );
    const playerSnapshots = await Promise.all(
      playerRefs.map(ref => transaction.get(ref))
    );
    const players = playerSnapshots
      .filter(snapshot => snapshot.exists())
      .map(snapshot => normalizePlayerRating({
        id: snapshot.id,
        ...snapshot.data(),
      }));
    const playersById = new Map(players.map(player => [String(player.id), player]));
    const ratedMatch = {
      ...match,
      evilAssign: refreshAssignments(match.evilAssign, playersById),
      goodAssign: refreshAssignments(match.goodAssign, playersById),
    };
    const evilTotal = teamTotal(ratedMatch.evilAssign);
    const goodTotal = teamTotal(ratedMatch.goodAssign);

    transaction.set(historyRef, {
      date: new Date(match.timestamp).toLocaleDateString("en-CA"),
      winner: match.winner,
      evilTotal,
      goodTotal,
      gap: Math.abs(evilTotal - goodTotal),
      timestamp: match.timestamp,
      source: "auto",
      gameId: match.gameId,
      duration: match.duration,
      mapName: match.mapName,
      evilAssign: serializeAssignments(ratedMatch.evilAssign),
      goodAssign: serializeAssignments(ratedMatch.goodAssign),
    });

    applyMatchRatings(players, ratedMatch);

    for (const player of players) {
      transaction.set(fb.doc(state.db, "players", String(player.id)), {
        mainElo: player.mainElo,
        gamesPlayed: player.gamesPlayed,
        wins: player.wins,
        losses: player.losses,
        lastPlayedAt: player.lastPlayedAt,
        civStats: player.civStats,
        ratingModelVersion: player.ratingModelVersion,
      }, { merge: true });
    }

    recorded = true;
  });

  return recorded;
}

function refreshAssignments(assignments, playersById) {
  return assignments.map(assignment => {
    const player = playersById.get(String(assignment.playerId || ""));
    return {
      ...assignment,
      effElo: player
        ? (assignment.civId ? civElo(player, assignment.civId) : overallElo(player))
        : DEFAULT_ELO,
    };
  });
}

function serializeAssignments(assignments) {
  return assignments.map(assignment => ({
    name: assignment.name,
    civId: assignment.civId || "",
    civName: assignment.civName || "",
    effElo: assignment.effElo,
    isCommunity: assignment.isCommunity,
    profileId: assignment.profileId,
  }));
}

function buildAssignment(member, profileMap) {
  const profileId = String(member.profile_id || "");
  const player = profileMap[Number(member.profile_id)] || null;
  const civId = positionFor(member);

  return {
    name: player?.name || member.name || `Player ${profileId}`,
    playerId: player?.id ? String(player.id) : null,
    profileId,
    civId,
    civName: CIVS.find(civ => civ.id === civId)?.name || "",
    effElo: player
      ? (civId ? civElo(player, civId) : overallElo(player))
      : DEFAULT_ELO,
    isCommunity: Boolean(player || member.is_community),
  };
}

function positionFor(member) {
  const direct = String(member.civ_position || "").toLowerCase();
  if (POSITION_ORDER.includes(direct)) return direct;
  return TEAMID_MAP[Number(member.teamid)] || null;
}

function comparePositions(a, b) {
  return POSITION_ORDER.indexOf(positionFor(a)) - POSITION_ORDER.indexOf(positionFor(b));
}

function teamTotal(assignments) {
  return assignments.reduce((sum, assignment) => sum + assignment.effElo, 0);
}

function matchTimestamp(match) {
  return Number(match.completiontime || match.startgametime || 0) * 1000;
}
