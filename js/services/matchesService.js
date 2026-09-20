import { LIVE_LOBBY_PROXY } from "../core/config.js";

export async function fetchMatchesJson() {
  const matchesUrl = new URL("../../matches.json", import.meta.url);
  const res = await fetch(matchesUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch matches.json: ${res.status}`);
  return res.json();
}

// On-demand lobby lookup for the "check now" buttons.
//
// Tries the optional Cloudflare Worker first for genuinely current data, and
// falls back to the committed lobby.json whenever the proxy is not configured,
// is unreachable, or errors. The caller gets `isLive` so the UI can say which
// it got rather than implying freshness it does not have.
export async function fetchLiveLobbies() {
  if (LIVE_LOBBY_PROXY) {
    try {
      const res = await fetch(LIVE_LOBBY_PROXY, {
        cache: "no-store",
        signal: AbortSignal.timeout?.(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.matches)) {
          return { ...data, isLive: true, lastModified: data.fetchedAt || Date.now() };
        }
      }
      console.warn(`Lobby proxy returned ${res.status}; using the committed file`);
    } catch (error) {
      console.warn("Lobby proxy unreachable; using the committed file:", error?.message || error);
    }
  }

  const data = await fetchLobbyJson();
  return { ...data, isLive: false };
}

export async function fetchLobbyJson() {
  const lobbyUrl = new URL("../../lobby.json", import.meta.url);
  const res = await fetch(lobbyUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch lobby.json: ${res.status}`);

  const data = await res.json();
  // lobby.json deliberately carries no timestamp: one would change on every
  // scheduled run and force a commit even when no lobby changed. The HTTP
  // Last-Modified header gives the file's age for free instead.
  const lastModified = Date.parse(res.headers.get("last-modified") || "");
  return {
    ...data,
    lastModified: Number.isFinite(lastModified) ? lastModified : null
  };
}

// How old lobby.json is, in words. The generating workflow runs every ~5
// minutes and GitHub drops scheduled runs under load, so "a few minutes" is the
// normal, healthy case rather than a problem.
export function describeLobbyAge(lastModified, isLive = false) {
  // A live proxy fetch is current by definition; only the committed file ages.
  if (isLive) return "live";
  if (!lastModified) return "age unknown";

  const minutes = Math.max(0, Math.round((Date.now() - lastModified) / 60000));
  if (minutes < 1) return "updated just now";
  if (minutes === 1) return "updated 1 minute ago";
  if (minutes < 60) return `updated ${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  return hours === 1 ? "updated 1 hour ago" : `updated ${hours} hours ago`;
}
