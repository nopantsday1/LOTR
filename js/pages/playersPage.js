import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import { overallElo, civElo, decayedElo } from "../elo/elo.js";
import { buildPlayerEloProgress } from "../elo/progress.js";

export function initPlayersPage() {
  const tbody = document.getElementById("playersTable");
  const civFilter = document.getElementById("civFilter");
  const progressPlayerSelect = document.getElementById("progressPlayerSelect");
  const progressCivSelect = document.getElementById("progressCivSelect");
  const progressCanvas = document.getElementById("eloProgressCanvas");
  const progressMeta = document.getElementById("eloProgressMeta");
  if (!tbody) return;

  if (civFilter && civFilter.children.length <= 1) {
    for (const civ of CIVS) {
      const option = document.createElement("option");
      option.value = civ.id;
      option.textContent = civ.name;
      civFilter.append(option);
    }
  }

  function renderProgressControls() {
    if (!progressPlayerSelect) return;

    const currentValue = progressPlayerSelect.value;

    progressPlayerSelect.innerHTML = `<option value="">Select player</option>` +
      state.players
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map(player => `
          <option value="${escapeHtml(player.id)}">
            ${escapeHtml(player.name || "Unknown")}
          </option>
        `)
        .join("");

    if (currentValue) {
      progressPlayerSelect.value = currentValue;
    }
  }

  function renderProgressGraph() {
    if (!progressCanvas || !progressPlayerSelect) return;

    const playerId = progressPlayerSelect.value;
    const civId = progressCivSelect?.value || "overall";

    if (!playerId) {
      clearCanvas(progressCanvas, "Select a player to show Elo progress");
      if (progressMeta) progressMeta.textContent = "";
      return;
    }

    const history = state.fullHistory?.length ? state.fullHistory : state.history;
    const points = buildPlayerEloProgress(state.players, history, playerId, civId);

    drawLineChart(progressCanvas, points);

    const player = state.players.find(p => p.id === playerId);
    if (progressMeta) {
      progressMeta.textContent = `${player?.name || "Player"} · ${points.length} recorded points · ${civId === "overall" ? "Overall Elo" : civId.toUpperCase()}`;
    }
  }

  function clearCanvas(canvas, message) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "#817968";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }

  function drawLineChart(canvas, points) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!points.length) {
      clearCanvas(canvas, "No Elo progress data");
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

    min = Math.floor((min - 50) / 50) * 50;
    max = Math.ceil((max + 50) / 50) * 50;

    if (min === max) {
      min -= 100;
      max += 100;
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
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;

    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (i / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      const label = Math.round(max - (i / gridLines) * (max - min));
      ctx.fillStyle = "#817968";
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(String(label), padding.left - 8, y + 4);
    }

    // line
    ctx.strokeStyle = "#d7b56d";
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
    ctx.fillStyle = "#d7b56d";
    points.forEach((point, index) => {
      const x = xAt(index);
      const y = yAt(point.value);

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // x labels
    ctx.fillStyle = "#817968";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";

    const first = points[0];
    const last = points[points.length - 1];

    ctx.fillText(first.label || "Start", padding.left, height - 14);
    ctx.fillText(last.label || "Latest", width - padding.right, height - 14);

    // current value label
    const latest = points[points.length - 1];
    ctx.fillStyle = "#ece6d2";
    ctx.font = "14px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(`Latest: ${latest.value}`, width - padding.right, padding.top - 6);
  }

  function render() {
    const selectedCiv = civFilter?.value || "";

    const players = state.players
      .slice()
      .sort((a, b) => overallElo(b) - overallElo(a));

    tbody.innerHTML = players.map(player => {
      const wins = player.wins || 0;
      const losses = player.losses || 0;
      const total = wins + losses;
      const winRate = total ? Math.round((wins / total) * 100) : 0;

      return `
        <tr class="player-row">
          <td>
            <div class="player-name">${escapeHtml(player.name || "Unknown")}</div>
            <div class="player-sub muted">
              ${total} games · ${winRate}% WR
            </div>
          </td>

          <td>
            <div class="elo-main">${overallElo(player)}</div>
            <div class="muted small">Decayed: ${decayedElo(player)}</div>
          </td>

          <td>
            <div class="civ-grid">
              ${renderCivs(player, selectedCiv)}
            </div>
          </td>

          <td>${wins}</td>
          <td>${losses}</td>
          <td class="muted">${escapeHtml(player.profileId || "")}</td>
        </tr>
      `;
    }).join("");

    renderProgressControls();
    renderProgressGraph();
  }

  civFilter?.addEventListener("change", render);

  progressPlayerSelect?.addEventListener("change", renderProgressGraph);
  progressCivSelect?.addEventListener("change", renderProgressGraph);

  render();
  window.addEventListener("lotr:dataChanged", render);
}

function renderCivs(player, selectedCiv) {
  return CIVS
    .filter(civ => !selectedCiv || civ.id === selectedCiv)
    .map(civ => {
      const elo = civElo(player, civ.id);
      const wins = player.civWins?.[civ.id] || 0;
      const losses = player.civLosses?.[civ.id] || 0;
      const games = wins + losses;
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
            <span>${games}g</span>
            <span>${wr}% WR</span>
          </div>
        </div>
      `;
    }).join("");
}

function eloToPercent(elo) {
  // Visual scale only. Adjust if your Elos go much higher/lower.
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