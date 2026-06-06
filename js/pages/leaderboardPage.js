import { state } from "../core/state.js";
import { overallElo } from "../elo/elo.js";

export function initLeaderboardPage() {
  const list = document.getElementById("leaderboardList");
  if (!list) return;

  function render() {
    const players = state.players.slice().sort((a, b) => overallElo(b) - overallElo(a));
    list.innerHTML = players.map((p, i) => `
      <article class="card">
        <span class="leaderboard-rank">#${i + 1}</span>
        <a href="/pages/profile.html?playerId=${encodeURIComponent(p.id)}" class="player-link leaderboard-name">${escapeHtml(p.name || "Unknown")}</a>
        <span class="leaderboard-elo">${overallElo(p)} <small>Elo</small></span>
      </article>
    `).join("");
  }

  render();
  window.addEventListener("lotr:dataChanged", render);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}
