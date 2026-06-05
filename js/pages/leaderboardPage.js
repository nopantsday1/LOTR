import { state } from "../core/state.js";
import { overallElo } from "../elo/elo.js";

export function initLeaderboardPage() {
  const list = document.getElementById("leaderboardList");
  if (!list) return;

  function render() {
    const players = state.players.slice().sort((a, b) => overallElo(b) - overallElo(a));
    list.innerHTML = players.map((p, i) => `
      <article class="card">
        <strong>#${i + 1} ${p.name || "Unknown"}</strong>
        <span class="muted">${overallElo(p)} Elo</span>
      </article>
    `).join("");
  }

  render();
  window.addEventListener("lotr:dataChanged", render);
}
