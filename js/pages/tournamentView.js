// Rendering helpers shared by the two tournament pages.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// playerId -> current roster name, plus the set of ids that still exist.
export function rosterIndex(players) {
  const names = new Map();
  for (const player of players || []) {
    if (player?.id) names.set(String(player.id), player.name || "Unknown");
  }
  return { names };
}

// A roster member links to their profile under their current name; a guest is
// plain text.
export function renderEntrantName(entrant, roster) {
  const id = entrant?.playerId ? String(entrant.playerId) : "";
  if (id && roster?.names?.has(id)) {
    return `<a class="player-link" href="./profile.html?playerId=${encodeURIComponent(id)}">${escapeHtml(roster.names.get(id))}</a>`;
  }
  return escapeHtml(entrant?.name || "Unknown");
}
