import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import {
  civGames,
  ratingBreakdown
} from "../elo/elo.js";
import { createLazyList } from "../ui/lazyList.js";

const SEARCH_DEBOUNCE_MS = 150;

export function initPlayersPage() {
  const list = document.getElementById("playersList");
  const search = document.getElementById("playersSearch");
  const civSort = document.getElementById("playersCivSort");
  const searchMeta = document.getElementById("playersSearchMeta");
  if (!list) return;

  let currentCiv = "overall";
  let currentRanks = new Map();
  let searchTimer = null;

  const lazyList = createLazyList(list, {
    pageSize: 25,
    emptyHtml: '<p class="card muted">No players match your search.</p>',
    renderItem: player =>
      renderPlayer(player, currentRanks.get(player.id), currentCiv)
  });

  function render() {
    const query = normalizeSearch(search?.value);
    const selectedCiv = civSort?.value || "overall";
    const ranked = state.players
      .slice()
      .sort((a, b) => rankingElo(b, selectedCiv) - rankingElo(a, selectedCiv));
    const rankById = new Map(ranked.map((player, index) => [player.id, index + 1]));
    const players = ranked.filter(player => matchesPlayerSearch(player, query));

    if (searchMeta) {
      searchMeta.textContent = query
        ? `${players.length} ${players.length === 1 ? "player" : "players"} found`
        : `${players.length} ranked players`;
    }

    currentCiv = selectedCiv;
    currentRanks = rankById;
    lazyList.setItems(players);
  }

  // Delegated, so rows appended by the lazy list stay interactive without
  // rebinding listeners on every chunk.
  function openProfileFrom(target) {
    const row = target.closest(".player-rank-row");
    if (!row?.dataset.playerId) return;
    window.location.href =
      `./profile.html?playerId=${encodeURIComponent(row.dataset.playerId)}`;
  }

  list.addEventListener("click", event => openProfileFrom(event.target));
  list.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.closest(".player-rank-row")) return;
    event.preventDefault();
    openProfileFrom(event.target);
  });

  search?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(render, SEARCH_DEBOUNCE_MS);
  });
  civSort?.addEventListener("change", render);
  window.addEventListener("lotr:dataChanged", render);
  render();
}

function renderPlayer(player, rank, selectedCiv) {
  const wins = Number(player.wins || 0);
  const losses = Number(player.losses || 0);
  const total = wins + losses;
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  const realElo = rankingElo(player, selectedCiv);
  const permanent = ratingBreakdown(player).mainElo;
  const eloLabel = selectedCiv === "overall"
    ? "Real Elo"
    : `${selectedCiv.toUpperCase()} Decayed Civ Elo`;

  return `
    <article
      class="card player-rank-row"
      data-player-id="${escapeHtml(player.id)}"
      tabindex="0"
    >
      <div class="player-rank-number">#${rank}</div>
      <div class="player-rank-identity">
        <strong>${escapeHtml(player.name || "Unknown")}</strong>
        <span>${total} games | ${winRate}% WR</span>
      </div>
      <div class="player-real-elo">
        <strong>${realElo}</strong>
        <span>${eloLabel}</span>
        ${selectedCiv === "overall" && permanent !== realElo
          ? `<small>${permanent} permanent</small>`
          : ""}
      </div>
      ${renderCivChart(player)}
    </article>
  `;
}

function rankingElo(player, selectedCiv) {
  const rating = ratingBreakdown(
    player,
    selectedCiv === "overall" ? null : selectedCiv
  );

  return selectedCiv === "overall"
    ? rating.displayedMainElo
    : rating.displayedCivElo;
}

function renderCivChart(player) {
  const values = CIVS.map(civ => ({
    civ,
    games: civGames(player, civ.id),
    wins: Number(player.civStats?.[civ.id]?.wins || 0),
  }));
  const maxGames = Math.max(1, ...values.map(item => item.games));

  return `
    <div class="civ-activity-chart" style="--civ-count:${values.length}">
      ${values.map(({ civ, games, wins }) => {
        const winRate = games ? Math.round((wins / games) * 100) : 0;
        const height = games ? Math.max(18, Math.round((games / maxGames) * 100)) : 4;

        return `
          <div
            class="civ-activity-column ${civ.side}"
            title="${escapeHtml(civ.name)}: ${games} games, ${winRate}% win rate"
          >
            <div class="civ-activity-track">
              <div class="civ-activity-bar" style="height:${height}%">
                <span>${games ? `${winRate}% WR` : "-"}</span>
              </div>
            </div>
            <div class="civ-activity-label">${civ.id.toUpperCase()}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function matchesPlayerSearch(player, query) {
  if (!query) return true;
  return [player.name, player.profileId]
    .some(value => normalizeSearch(value).includes(query));
}

function normalizeSearch(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}
