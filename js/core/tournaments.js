// Pure tournament helpers: no Firebase, no DOM, so Node tests can import them.
//
// A tournament document (collection `tournaments`) looks like:
//
//   {
//     name:         "The Battle for Erebor",
//     date:         "2026-05-17",          // YYYY-MM-DD, may be ""
//     format:       "4v4 single elimination", // free text, may be ""
//     championTeam: "The Iron Hills Boys",    // optional team name
//     notes:        "",
//     entrants: [
//       { name: "Sito", playerId: "abc123", placement: "champion" },
//       { name: "Guest", playerId: "",      placement: "runnerUp" },
//       { name: "Bob",   playerId: "def456", placement: "" }
//     ],
//     createdAt: 1730000000000,
//     updatedAt: 1730000000000
//   }
//
// `playerId` links an entrant to the roster when they are a community member,
// so titles follow a player through renames. Guests are stored by name only.
// A tournament with no champion yet is shown as upcoming / in progress.

export const TOURNAMENT_COLLECTION = "tournaments";

export const PLACEMENT_CHAMPION = "champion";
export const PLACEMENT_RUNNER_UP = "runnerUp";
export const PLACEMENTS = [PLACEMENT_CHAMPION, PLACEMENT_RUNNER_UP];

export const LIMITS = {
  name: 80,
  format: 60,
  championTeam: 60,
  notes: 1000,
  entrantName: 60,
  entrants: 128
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNotes(value) {
  return String(value ?? "").trim().slice(0, LIMITS.notes);
}

export function normalizeEntrant(raw) {
  const name = cleanText(raw?.name, LIMITS.entrantName);
  const playerId = cleanText(raw?.playerId, 120);
  const placement = PLACEMENTS.includes(raw?.placement) ? raw.placement : "";
  return { name, playerId, placement };
}

// The identity used to de-duplicate entrants and count titles: the roster id
// when there is one, otherwise the case-insensitive name.
export function entrantKey(entrant) {
  if (entrant?.playerId) return `id:${entrant.playerId}`;
  return `name:${String(entrant?.name || "").trim().toLowerCase()}`;
}

// Turns form input (or a stored document) into the exact shape that is saved.
// Returns { tournament, errors }; errors is empty when it is safe to write.
export function normalizeTournament(raw) {
  const errors = [];
  const seen = new Set();
  const entrants = [];

  for (const item of Array.isArray(raw?.entrants) ? raw.entrants : []) {
    const entrant = normalizeEntrant(item);
    if (!entrant.name) continue;
    const key = entrantKey(entrant);
    if (seen.has(key)) continue;
    seen.add(key);
    entrants.push(entrant);
  }

  const tournament = {
    name: cleanText(raw?.name, LIMITS.name),
    date: cleanText(raw?.date, 10),
    format: cleanText(raw?.format, LIMITS.format),
    championTeam: cleanText(raw?.championTeam, LIMITS.championTeam),
    notes: cleanNotes(raw?.notes),
    entrants: entrants.slice(0, LIMITS.entrants)
  };

  if (!tournament.name) errors.push("Give the tournament a name.");
  if (tournament.date && !DATE_RE.test(tournament.date)) {
    errors.push("The date must look like YYYY-MM-DD.");
  }
  if (entrants.length > LIMITS.entrants) {
    errors.push(`A tournament can list at most ${LIMITS.entrants} players.`);
  }

  return { tournament, errors };
}

export function champions(tournament) {
  return (tournament?.entrants || []).filter(
    entrant => entrant.placement === PLACEMENT_CHAMPION
  );
}

export function runnersUp(tournament) {
  return (tournament?.entrants || []).filter(
    entrant => entrant.placement === PLACEMENT_RUNNER_UP
  );
}

export function isCompleted(tournament) {
  return champions(tournament).length > 0;
}

// Newest first; undated tournaments go last, then by creation time.
export function sortTournaments(list) {
  return [...(list || [])].sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// Hall of champions: one row per person who has played a tournament, ordered
// by titles, then runner-up finishes, then appearances.
//
// `rosterNames` (playerId -> current name) lets a renamed player show under
// their current name; entrants without a roster match keep their stored name.
export function buildChampionStandings(tournaments, rosterNames = new Map()) {
  const rows = new Map();

  for (const tournament of tournaments || []) {
    for (const entrant of tournament.entrants || []) {
      if (!entrant?.name) continue;
      const key = entrantKey(entrant);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          playerId: entrant.playerId || "",
          name: entrant.name,
          titles: 0,
          runnerUps: 0,
          played: 0,
          titleNames: []
        };
        rows.set(key, row);
      }
      row.played += 1;
      if (entrant.placement === PLACEMENT_CHAMPION) {
        row.titles += 1;
        row.titleNames.push(tournament.name);
      } else if (entrant.placement === PLACEMENT_RUNNER_UP) {
        row.runnerUps += 1;
      }
    }
  }

  for (const row of rows.values()) {
    if (row.playerId && rosterNames.has(row.playerId)) {
      row.name = rosterNames.get(row.playerId);
    }
  }

  return [...rows.values()]
    .filter(row => row.titles > 0 || row.runnerUps > 0)
    .sort(
      (a, b) =>
        b.titles - a.titles ||
        b.runnerUps - a.runnerUps ||
        b.played - a.played ||
        a.name.localeCompare(b.name)
    );
}

// "2026-05-17" -> a readable date, parsed as a local calendar day so it never
// shifts by one across time zones.
export function formatTournamentDate(date, locale) {
  if (!date || !DATE_RE.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}
