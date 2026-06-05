export async function fetchMatchesJson() {
  const res = await fetch("/matches.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch matches.json: ${res.status}`);
  return res.json();
}

export async function fetchLobbyJson() {
  const res = await fetch("/lobby.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch lobby.json: ${res.status}`);
  return res.json();
}
