export async function fetchMatchesJson() {
  const matchesUrl = new URL("../../matches.json", import.meta.url);
  const res = await fetch(matchesUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch matches.json: ${res.status}`);
  return res.json();
}

export async function fetchLobbyJson() {
  const lobbyUrl = new URL("../../lobby.json", import.meta.url);
  const res = await fetch(lobbyUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch lobby.json: ${res.status}`);
  return res.json();
}
