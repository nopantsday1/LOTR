import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import {
  civElo,
  civGames,
  civModifier,
  decayedElo,
  effectiveCivElo,
  overallElo
} from "../elo/elo.js";

export function initPlayersPage() {
  const tbody = document.getElementById("playersTable");
  const civFilter = document.getElementById("civFilter");
  const search = document.getElementById("playersSearch");
  const searchMeta = document.getElementById("playersSearchMeta");
  if (!tbody) return;

  if (civFilter && civFilter.children.length <= 1) {
    for (const civ of CIVS) {
      const option = document.createElement("option");
      option.value = civ.id;
      option.textContent = civ.name;
      civFilter.append(option);
    }
  }

  function render() {
    const selectedCiv = civFilter?.value || "";
    const query = normalizeSearch(search?.value);

    const players = state.players
      .filter(player => matchesPlayerSearch(player, query))
      .slice()
      .sort((a, b) => overallElo(b) - overallElo(a));

    if (searchMeta) {
      searchMeta.textContent = query
        ? `${players.length} ${players.length === 1 ? "player" : "players"} found`
        : `${players.length} players`;
    }

    tbody.innerHTML = players.length ? players.map(player => {
      const wins = player.wins || 0;
      const losses = player.losses || 0;
      const total = wins + losses;
      const winRate = total ? Math.round((wins / total) * 100) : 0;

      return `
        <tr class="player-row" data-player-id="${escapeHtml(player.id)}" style="cursor: pointer;">
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
    }).join("") : `
      <tr>
        <td colspan="6" class="player-table-empty muted">No players match your search.</td>
      </tr>
    `;

    // Add click handlers to player rows
    tbody.querySelectorAll("tr.player-row").forEach(row => {
      row.addEventListener("click", () => {
        const playerId = row.dataset.playerId;
        window.location.href = `./profile.html?playerId=${encodeURIComponent(playerId)}`;
      });
    });

  }

  civFilter?.addEventListener("change", render);
  search?.addEventListener("input", render);

  render();
  window.addEventListener("lotr:dataChanged", render);
}

function matchesPlayerSearch(player, query) {
  if (!query) return true;
  return [
    player.name,
    player.profileId
  ].some(value => normalizeSearch(value).includes(query));
}

function normalizeSearch(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function renderCivs(player, selectedCiv) {
  return CIVS
    .filter(civ => !selectedCiv || civ.id === selectedCiv)
    .map(civ => {
      const elo = civElo(player, civ.id);
      const effective = effectiveCivElo(player, civ.id);
      const modifier = civModifier(player, civ.id);
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
            <span>${formatSigned(modifier)} mod · ${games}g</span>
            <span>${effective} eff</span>
          </div>
        </div>
      `;
    }).join("");
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
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
