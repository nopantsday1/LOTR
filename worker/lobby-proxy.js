/**
 * Cloudflare Worker: live LOTR lobby lookup, plus in-progress game detection.
 *
 * Two jobs:
 *
 *   fetch()     serves open LOTR lobbies to the browser with CORS headers. The
 *               browser cannot call the Worlds Edge API itself because it sends
 *               no Access-Control-Allow-Origin header.
 *
 *   scheduled() watches for lobbies disappearing. The AoE2 API has no concept
 *               of a running game: findAdvertisements returns only lobbies in
 *               state 0 and carries no timestamps, and match history contains
 *               nothing until a game has finished. A lobby simply vanishes when
 *               it starts. Watching from the browser only worked while someone
 *               had the page open, so the Worker watches instead.
 *
 * Kept deliberately cheap. On the Workers free plan the binding limit is KV
 * writes at 1,000/day, so state is written only when the set of open lobbies
 * actually changes -- quiet hours cost nothing. Budget at the configured
 * 2-minute cadence:
 *
 *   Worker invocations  720/day cron + client polls   (limit 100,000/day)
 *   KV reads            1 per cron + 1 per request    (limit 100,000/day)
 *   KV writes           only on change, tens/day      (limit 1,000/day)
 *
 * Deploy:  cd worker && npx wrangler deploy
 *
 * Deliberately NOT a general-purpose proxy: the upstream URL is hardcoded and
 * no caller-supplied URL is honoured, so this cannot relay arbitrary traffic.
 */

const UPSTREAM =
  "https://aoe-api.worldsedgelink.com/community/advertisement/findAdvertisements" +
  "?title=age2&count=100";

// Keep in sync with LOBBY_KEYWORDS in js/core/matchRules.js.
const KEYWORDS = ["lotr", "bfme", "hobbit", "bobbit"];

const STATE_KEY = "lobby-state-v1";

// A LOTR game runs well under this; past it, the lobby was abandoned rather
// than started.
const MAX_RUNNING_MS = 2 * 60 * 60 * 1000;

// Below this a vanished lobby is more likely to have been closed than started.
const MIN_RUNNING_MS = 60 * 1000;

// Guards against a pathological upstream response bloating stored state.
const MAX_TRACKED = 40;

// Repeated clicks should not re-hit the game API.
const CACHE_SECONDS = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/lobbies", request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let raw;
    try {
      raw = await fetchUpstream();
    } catch (error) {
      // Still answer with whatever in-progress state we have; a failed upstream
      // call should not hide a game that is already running.
      const fallback = await readState(env);
      return json({
        matches: [],
        avatars: [],
        inProgress: runningGames(fallback, Date.now()),
        fetchedAt: Date.now(),
        upstreamError: String(error)
      }, 200);
    }

    const payload = slim(raw);
    const stored = await readState(env);
    payload.inProgress = runningGames(stored, Date.now());

    const response = json(payload, 200, {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },

  // Cron entry point. Diffs the open lobbies against stored state and records
  // any that have disappeared as started.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env));
  }
};

async function sweep(env) {
  let raw;
  try {
    raw = await fetchUpstream();
  } catch {
    // Leave state untouched; a transient upstream failure must not be read as
    // every lobby starting at once.
    return;
  }

  const now = Date.now();
  const open = slim(raw).matches;
  const stored = await readState(env);
  const previous = stored.lobbies || {};
  const next = {};
  let changed = false;

  for (const lobby of open) {
    const id = String(lobby.id);
    const before = previous[id];
    if (!before) changed = true;

    next[id] = before?.startedAt
      // Was thought to be running and is advertised again: it never started.
      ? { ...lobbyRecord(lobby, before.firstSeen || now) }
      : { ...lobbyRecord(lobby, before?.firstSeen || now) };

    if (before?.startedAt) changed = true;
  }

  for (const [id, record] of Object.entries(previous)) {
    if (next[id]) continue;

    const startedAt = record.startedAt || now;
    if (now - startedAt > MAX_RUNNING_MS) {
      changed = true;               // expired: drop it
      continue;
    }
    if (!record.startedAt) changed = true;   // newly vanished
    next[id] = { ...record, startedAt };
  }

  // Only write when something actually moved. This is what keeps the job inside
  // the 1,000 writes/day free-tier limit.
  if (!changed) return;

  const trimmed = Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => (b[1].startedAt || b[1].firstSeen || 0) - (a[1].startedAt || a[1].firstSeen || 0))
      .slice(0, MAX_TRACKED)
  );

  await env.LOBBY_STATE.put(
    STATE_KEY,
    JSON.stringify({ lobbies: trimmed, updatedAt: now })
  );
}

function lobbyRecord(lobby, firstSeen) {
  return {
    id: lobby.id,
    description: lobby.description,
    maxplayers: lobby.maxplayers,
    members: lobby.matchmembers.map(member => member.profile_id),
    aliases: lobby.aliases || {},
    firstSeen
  };
}

// Vanished lobbies that plausibly represent a game in flight. The client
// resolves the profile ids against the roster and decides which are community
// games -- the Worker deliberately knows nothing about who plays here.
function runningGames(stored, now) {
  return Object.values(stored.lobbies || {})
    .filter(record => record.startedAt)
    .map(record => ({
      id: record.id,
      description: record.description,
      maxplayers: record.maxplayers,
      members: record.members,
      aliases: record.aliases,
      startedAt: record.startedAt,
      elapsedMs: now - record.startedAt
    }))
    .filter(game => game.elapsedMs >= MIN_RUNNING_MS && game.elapsedMs <= MAX_RUNNING_MS)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

async function readState(env) {
  if (!env.LOBBY_STATE) return {};
  try {
    const raw = await env.LOBBY_STATE.get(STATE_KEY, { type: "json" });
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function fetchUpstream() {
  const res = await fetch(UPSTREAM, {
    headers: { "User-Agent": "HobbitBalancer/1.0" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
  return res.json();
}

// Same shape scripts/filter_lobby.py produces, so the client can treat a live
// response and the committed lobby.json identically.
function slim(raw) {
  const matches = Array.isArray(raw?.matches) ? raw.matches : [];
  const relevant = matches.filter(match => {
    const name = String(match?.description || "").toLowerCase();
    return KEYWORDS.some(keyword => name.includes(keyword));
  });

  const aliasById = new Map(
    (raw?.avatars || [])
      .filter(a => a?.profile_id != null)
      .map(a => [Number(a.profile_id), a.alias || ""])
  );

  const wanted = new Set();
  const slimMatches = relevant.map(match => {
    const members = [];
    const aliases = {};
    for (const member of match.matchmembers || []) {
      if (member?.profile_id == null) continue;
      const id = Number(member.profile_id);
      wanted.add(id);
      members.push({ profile_id: id });
      const alias = aliasById.get(id);
      if (alias) aliases[id] = alias;
    }
    members.sort((a, b) => a.profile_id - b.profile_id);

    return {
      id: match.id,
      description: match.description || "",
      mapname: match.mapname || "",
      maxplayers: match.maxplayers,
      matchmembers: members,
      aliases
    };
  });
  slimMatches.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

  const avatars = [...wanted]
    .filter(id => aliasById.has(id))
    .map(id => ({ profile_id: id, alias: aliasById.get(id) }))
    .sort((a, b) => a.profile_id - b.profile_id);

  return {
    matches: slimMatches,
    avatars,
    fetchedAt: Date.now(),
    totalLobbies: matches.length
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders
    }
  });
}
