/**
 * Cloudflare Worker: live LOTR lobby lookup.
 *
 * The browser cannot call the Worlds Edge API directly because it sends no
 * Access-Control-Allow-Origin header. This fetches it server-side and returns
 * the open LOTR lobbies with CORS headers, so the Balance page's "Select from
 * lobby" button sees what is open right now.
 *
 * Without this Worker the site falls back to the committed lobby.json, which a
 * scheduled GitHub job regenerates. GitHub throttles that schedule to roughly
 * every 2-4 hours whatever the cron says, and a lobby is open for minutes, so
 * the fallback rarely catches one.
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

// The upstream list changes slowly and the button is easy to mash, so a short
// edge cache keeps repeated clicks from hammering the game API.
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

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        headers: { "User-Agent": "HobbitBalancer/1.0" },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
    } catch (error) {
      return json({ error: "Upstream unreachable", detail: String(error) }, 502);
    }

    if (!upstream.ok) {
      return json({ error: `Upstream returned ${upstream.status}` }, 502);
    }

    let raw;
    try {
      raw = await upstream.json();
    } catch {
      return json({ error: "Upstream returned invalid JSON" }, 502);
    }

    const response = json(slim(raw), 200, {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

// Same shape scripts/filter_lobby.py produces, so the client can treat a live
// response and the committed lobby.json identically.
function slim(raw) {
  const matches = Array.isArray(raw?.matches) ? raw.matches : [];
  const relevant = matches.filter(match => {
    const name = String(match?.description || "").toLowerCase();
    return KEYWORDS.some(keyword => name.includes(keyword));
  });

  const wanted = new Set();
  const slimMatches = relevant.map(match => {
    const members = [];
    for (const member of match.matchmembers || []) {
      if (member?.profile_id == null) continue;
      const id = Number(member.profile_id);
      wanted.add(id);
      members.push({ profile_id: id });
    }
    members.sort((a, b) => a.profile_id - b.profile_id);

    return {
      id: match.id,
      description: match.description || "",
      mapname: match.mapname || "",
      maxplayers: match.maxplayers,
      matchmembers: members
    };
  });
  slimMatches.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

  const avatars = (raw?.avatars || [])
    .filter(a => a?.profile_id != null && wanted.has(Number(a.profile_id)))
    .map(a => ({ profile_id: Number(a.profile_id), alias: a.alias || "" }))
    .sort((a, b) => a.profile_id - b.profile_id);

  return {
    matches: slimMatches,
    avatars,
    // Present only on live responses; the client uses it to say "live" rather
    // than quoting the committed file's age.
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
