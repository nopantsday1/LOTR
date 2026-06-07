import { state } from "../core/state.js";
import { fmtDuration } from "../utils/format.js";
import { importNewMatches } from "../services/matchImportService.js";
import { toast } from "../ui/toast.js";

export function initHistoryPage() {
  const list = document.getElementById("historyList");
  const search = document.getElementById("historySearch");
  if (!list) return;

  function render() {
    const q = (search?.value || "").toLowerCase();

    const rows = (state.fullHistory?.length ? state.fullHistory : state.history)
      .slice()
      .sort((a, b) => {
        const ta = Number(a.timestamp || 0);
        const tb = Number(b.timestamp || 0);
        return tb - ta; // newest first
      })
      .filter(match => {
        if (!q) return true;
        return JSON.stringify(match).toLowerCase().includes(q);
      });
    list.innerHTML = rows.map(renderMatchCard).join("");
  }

  search?.addEventListener("input", render);

  document.getElementById("historyCheckNowBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const status = document.getElementById("historyCheckStatus");
    button.disabled = true;
    if (status) status.textContent = "Checking the latest generated match feed...";

    try {
      const result = await importNewMatches();
      const message = result.waiting
        ? "Waiting for Firebase data to finish loading."
        : result.skipped
          ? "Local sandbox: production imports are disabled."
          : result.added
            ? `${result.added} new match${result.added === 1 ? "" : "es"} recorded.`
            : "No new matches found.";
      if (status) {
        status.textContent = `${message} Last checked: ${new Date().toLocaleTimeString()}`;
      }
      if (result.added) toast(message);
    } catch (error) {
      console.error(error);
      if (status) status.textContent = "Match check failed. See the browser console for details.";
      toast("Could not import new matches", "err");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("historyClearSearch")?.addEventListener("click", () => {
    search.value = "";
    render();
  });

  render();
  window.addEventListener("lotr:dataChanged", render);
}

function renderMatchCard(match) {
  const date = match.timestamp
    ? new Date(match.timestamp).toLocaleString()
    : "Unknown date";

  const evil = match.evilAssign || [];
  const good = match.goodAssign || [];

  const winner = match.winner || match.result || "unknown";

  return `
    <article class="card match-card">
      <div class="match-head">
        <div>
          <strong>${escapeHtml(match.mapName || match.map || match.name || "LOTR Match")}</strong>
          <div class="muted small">${escapeHtml(date)}</div>
        </div>
        <div class="winner-badge ${winner}">
          ${escapeHtml(String(winner).toUpperCase())}
        </div>
      </div>

      <div class="teams">
        <section class="team evil-team">
          <h3>Evil</h3>
          ${evil.map(renderAssignment).join("") || `<p class="muted">No evil assignment</p>`}
        </section>

        <section class="team good-team">
          <h3>Good</h3>
          ${good.map(renderAssignment).join("") || `<p class="muted">No good assignment</p>`}
        </section>
      </div>

      <div class="match-meta muted">
        Duration: ${fmtDuration(match.duration || match.durationSeconds)}
        ${match.matchId ? ` · Match ID: ${escapeHtml(match.matchId)}` : ""}
      </div>
    </article>
  `;
}

function renderAssignment(a) {
  const playerName = a.name || a.playerName || "Unknown";
  const player = state.players.find(p => p.name === playerName);
  const profileLink = player ? `./profile.html?playerId=${encodeURIComponent(player.id)}` : null;

  const nameHtml = profileLink
    ? `<a href="${profileLink}" class="player-link">${escapeHtml(playerName)}</a>`
    : escapeHtml(playerName);

  return `
    <div class="assignment-row">
      <span>${nameHtml}</span>
      <span class="muted">${escapeHtml(a.civName || a.civ || "")}</span>
    </div>
  `;
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
