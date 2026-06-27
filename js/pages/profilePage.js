import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import {
  civGames,
  ratingBreakdown
} from "../elo/elo.js";
import { buildPlayerEloProgress } from "../elo/progress.js";
import { RATING_MODES } from "../elo/ratingModes.js";
import { fmtDuration } from "../utils/format.js";

export function initProfilePage() {
  const profileHeader = document.getElementById("profileHeader");
  const civSelect = document.getElementById("profileCivSelect");
  const canvas = document.getElementById("profileEloProgressCanvas");
  const progressMeta = document.getElementById("profileEloProgressMeta");
  const historyList = document.getElementById("profileHistoryList");
  const historyMeta = document.getElementById("profileHistoryMeta");

  if (!profileHeader) return;

  function themeColor(variable, fallback) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(variable)
      .trim() || fallback;
  }

  // Get player ID from URL query parameter or use linked player
  function getSelectedPlayer() {
    const params = new URLSearchParams(window.location.search);
    const playerId = params.get("playerId");

    if (playerId) {
      return state.players.find(p => p.id === playerId);
    }
    return state.linkedPlayer;
  }

  function clearCanvas(message) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.font = "16px system-ui";
    ctx.fillStyle = themeColor("--muted", "#8491a8");
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }

  function drawLineChart(points) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!points.length) {
      clearCanvas("No Elo progress data");
      return;
    }

    const padding = {
      top: 24,
      right: 28,
      bottom: 42,
      left: 58
    };

    const values = points.map(p => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const eloTick = 100;

    min = Math.floor(min / eloTick) * eloTick;
    max = Math.ceil(max / eloTick) * eloTick;

    if (min === max) {
      min -= eloTick;
      max += eloTick;
    }

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    function xAt(index) {
      if (points.length === 1) return padding.left + plotW / 2;
      return padding.left + (index / (points.length - 1)) * plotW;
    }

    function yAt(value) {
      return padding.top + ((max - value) / (max - min)) * plotH;
    }

    // grid
    ctx.strokeStyle = themeColor("--chart-grid", "rgba(207,218,238,.1)");
    ctx.lineWidth = 1;

    const gridLines = (max - min) / eloTick;
    for (let i = 0; i <= gridLines; i++) {
      const label = max - i * eloTick;
      const y = yAt(label);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = themeColor("--muted", "#8491a8");
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(String(label), padding.left - 8, y + 4);
    }

    // line
    ctx.strokeStyle = themeColor("--accent", "#d79a4b");
    ctx.lineWidth = 2;
    ctx.beginPath();

    points.forEach((point, index) => {
      const x = xAt(index);
      const y = yAt(point.value);

      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // points
    ctx.fillStyle = themeColor("--accent", "#d79a4b");
    points.forEach((point, index) => {
      const x = xAt(index);
      const y = yAt(point.value);

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // x labels
    ctx.fillStyle = themeColor("--muted", "#8491a8");
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";

    const first = points[0];
    const last = points[points.length - 1];

    ctx.fillText(first.label || "Start", padding.left, height - 14);
    ctx.fillText(last.label || "Latest", width - padding.right, height - 14);

    // current value label
    const latest = points[points.length - 1];
    ctx.fillStyle = themeColor("--text", "#f3f6fb");
    ctx.font = "14px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(`Latest: ${latest.value}`, width - padding.right, padding.top - 6);
  }

  function renderProgressGraph() {
    const player = getSelectedPlayer();
    if (!player || !civSelect) return;

    const civId = civSelect.value || "overall";
    const history = state.fullHistory?.length ? state.fullHistory : state.history;
    const points = buildPlayerEloProgress(state.players, history, player.id, civId);

    drawLineChart(points);

    if (progressMeta) {
      progressMeta.textContent = `${player.name || "Player"} · ${points.length} recorded points · ${civId === "overall" ? "Main Elo" : civId.toUpperCase()}`;
    }
  }

  function renderGameHistory(player) {
    if (!historyList) return;

    const history = state.fullHistory?.length ? state.fullHistory : state.history;
    const progress = buildPlayerEloProgress(state.players, history, player.id, "overall");
    const eloChanges = new Map();

    for (let index = 1; index < progress.length; index++) {
      eloChanges.set(progress[index].match, progress[index].value - progress[index - 1].value);
    }

    const matches = history
      .filter(match => findPlayerAssignment(match, player))
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    if (historyMeta) {
      const modeLabel = RATING_MODES[state.ratingMode]?.label || "Original";
      historyMeta.textContent = `${matches.length} recorded ${matches.length === 1 ? "game" : "games"} · ${modeLabel} Main Elo changes`;
    }

    historyList.innerHTML = matches.length
      ? matches.map(match => renderPlayerMatch(match, player, eloChanges.get(match))).join("")
      : `<p class="muted">No recorded games found for this player.</p>`;
  }

  function render() {
    const player = getSelectedPlayer();

    if (!player) {
      profileHeader.innerHTML = `<p>No player found.</p>`;
      clearCanvas("No player selected");
      return;
    }

    const wins = player.wins || 0;
    const losses = player.losses || 0;
    const total = wins + losses;
    const winRate = total ? Math.round((wins / total) * 100) : 0;
    const rating = ratingBreakdown(player);

    profileHeader.innerHTML = `
      <div class="player-profile">
        <div class="player-info">
          <h2>${escapeHtml(player.name || "Unknown")}</h2>
          <p class="muted">${total} games · ${winRate}% WR</p>
          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-label">Main Elo</span>
              <span class="stat-value">${rating.mainElo}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Decayed Elo</span>
              <span class="stat-value">${rating.displayedMainElo}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Wins</span>
              <span class="stat-value">${wins}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Losses</span>
              <span class="stat-value">${losses}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Profile ID</span>
              <span class="stat-value">${escapeHtml(player.profileId || "N/A")}</span>
            </div>
          </div>
        </div>
        <div class="civ-overview">
          <h3>Civilization Elos</h3>
          <div class="civ-grid">
            ${renderCivs(player)}
          </div>
        </div>
      </div>
    `;

    renderProgressGraph();
    renderGameHistory(player);
  }

  civSelect?.addEventListener("change", renderProgressGraph);

  render();
  window.addEventListener("lotr:dataChanged", render);
  window.addEventListener("lotr:themeChanged", renderProgressGraph);
}

function renderPlayerMatch(match, player, eloChange) {
  const playerEntry = findPlayerAssignment(match, player);
  const winner = normalizeWinner(match.winner || match.result);
  const won = winner && winner === playerEntry.side;
  const result = winner ? (won ? "Win" : "Loss") : "Unknown";
  const date = match.timestamp
    ? new Date(Number(match.timestamp)).toLocaleString()
    : match.date || "Unknown date";
  const position = assignmentPosition(playerEntry.assignment);
  const eloText = Number.isFinite(eloChange)
    ? `${eloChange > 0 ? "+" : ""}${eloChange}`
    : "N/A";
  const matchId = match.matchId || match.gameId || match.id;

  return `
    <article class="profile-match ${won ? "win" : winner ? "loss" : ""}">
      <div class="profile-match-summary">
        <div>
          <div class="profile-match-result ${won ? "win" : winner ? "loss" : ""}">${result}</div>
          <strong>${escapeHtml(position.label)}</strong>
          <div class="muted small">${escapeHtml(playerEntry.sideLabel)} · ${escapeHtml(date)}</div>
        </div>
        <div class="profile-match-elo ${eloChange > 0 ? "positive" : eloChange < 0 ? "negative" : ""}">
          <span>${escapeHtml(eloText)}</span>
          <small>Main Elo</small>
        </div>
      </div>

      <div class="profile-match-teams">
        ${renderProfileTeam("Evil", match.evilAssign || [], player, match.evilTotal)}
        ${renderProfileTeam("Good", match.goodAssign || [], player, match.goodTotal)}
      </div>

      <div class="match-meta muted">
        Duration: ${fmtDuration(match.duration || match.durationSeconds)}
        ${matchId ? ` · Match ID: ${escapeHtml(matchId)}` : ""}
        ${match.source ? ` · Source: ${escapeHtml(match.source)}` : ""}
      </div>
    </article>
  `;
}

function renderProfileTeam(label, assignments, selectedPlayer, storedTotal) {
  return `
    <section class="profile-match-team ${label.toLowerCase()}">
      <h3>${label} ${formatTeamTotal(teamTotal(assignments, storedTotal))}</h3>
      ${assignments.map(assignment => {
        const playerName = assignment.name || assignment.playerName || "Unknown";
        const linkedPlayer = findStatePlayer(assignment);
        const isSelected = assignmentMatchesPlayer(assignment, selectedPlayer);
        const position = assignmentPosition(assignment);
        const name = linkedPlayer
          ? `<a class="player-link" href="./profile.html?playerId=${encodeURIComponent(linkedPlayer.id)}">${escapeHtml(playerName)}</a>`
          : escapeHtml(playerName);

        return `
          <div class="profile-assignment ${isSelected ? "selected" : ""}">
            <span class="position-badge">${escapeHtml(position.id)}</span>
            <span>${name}</span>
            <span class="muted">${escapeHtml(position.civName)}</span>
          </div>
        `;
      }).join("") || `<p class="muted">No assignments recorded</p>`}
    </section>
  `;
}

function teamTotal(assignments, storedTotal) {
  const stored = Number(storedTotal);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);

  const summed = assignments
    .map(assignment => Number(assignment.effElo))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);

  return summed > 0 ? Math.round(summed) : null;
}

function formatTeamTotal(total) {
  return Number.isFinite(total) ? `<span class="muted">(${total} eff)</span>` : "";
}

function findPlayerAssignment(match, player) {
  for (const [side, assignments] of [
    ["evil", match.evilAssign || []],
    ["good", match.goodAssign || []]
  ]) {
    const assignment = assignments.find(item => assignmentMatchesPlayer(item, player));
    if (assignment) {
      return {
        assignment,
        side,
        sideLabel: side === "evil" ? "Evil" : "Good"
      };
    }
  }

  return null;
}

function assignmentMatchesPlayer(assignment, player) {
  const assignmentProfileId = String(assignment.profileId || "");
  const playerProfileId = String(player.profileId || "");

  if (assignmentProfileId && playerProfileId && assignmentProfileId === playerProfileId) {
    return true;
  }

  return String(assignment.name || assignment.playerName || "") === String(player.name || "");
}

function findStatePlayer(assignment) {
  const profileId = String(assignment.profileId || "");
  const name = String(assignment.name || assignment.playerName || "");

  return state.players.find(player => (
    (profileId && String(player.profileId || "") === profileId) ||
    String(player.name || "") === name
  ));
}

function assignmentPosition(assignment) {
  const civValue = String(assignment.civName || assignment.civ || assignment.civId || "");
  const civ = CIVS.find(item => (
    item.id === civValue.toLowerCase() ||
    item.name.toLowerCase() === civValue.toLowerCase()
  ));
  const id = civ?.id.toUpperCase() || civValue.match(/\bP[1-8]\b/i)?.[0]?.toUpperCase() || "?";
  const civName = civ?.name.replace(/^P\d+\s*/, "") || civValue.replace(/^P\d+\s*/, "") || "Unknown";

  return {
    id,
    civName,
    label: `${id} ${civName}`
  };
}

function normalizeWinner(value) {
  const winner = String(value || "").toLowerCase();
  if (winner.includes("evil")) return "evil";
  if (winner.includes("good")) return "good";
  return "";
}

function renderCivs(player) {
  return CIVS.map(civ => {
    const rating = ratingBreakdown(player, civ.id);
    const elo = rating.civElo;
    const bias = rating.civBias;
    const games = civGames(player, civ.id);
    const wins = player.civStats?.[civ.id]?.wins || 0;
    const wr = games ? Math.round((wins / games) * 100) : 0;
    const pct = eloToPercent(elo);

    return `
      <div class="civ-card ${civ.side}">
        <div class="civ-top">
          <span class="civ-id">${civ.id.toUpperCase()}</span>
          <span class="civ-elo">${elo}</span>
        </div>

        <div class="civ-name">${escapeHtml(shortCivName(civ.name))}</div>

        <div class="elo-bar">
          <div class="elo-fill" style="width:${pct}%"></div>
        </div>

        <div class="civ-meta">
          <span>${formatSigned(bias)} bias · ${games}g</span>
          <span>${wr}% WR</span>
        </div>
      </div>
    `;
  }).join("");
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function eloToPercent(elo) {
  const min = 500;
  const max = 1600;
  return Math.max(4, Math.min(100, ((elo - min) / (max - min)) * 100));
}

function shortCivName(name) {
  return String(name || "")
    .replace(/^P\d+\s*/, "")
    .replace("Blue Mountains", "Blue Mtns")
    .replace("Azog's Host", "Azog")
    .replace("Dol Guldur", "Dol Guldur")
    .replace("Iron Hills", "Iron Hills");
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
