import { state } from "../core/state.js";
import { fmtDuration } from "../utils/format.js";
import { importNewMatches } from "../services/matchImportService.js";
import { createLazyList } from "../ui/lazyList.js";
import { toast } from "../ui/toast.js";
import {
  buildMatchRatingChanges,
  matchRatingKey
} from "../elo/progress.js";

const SEARCH_DEBOUNCE_MS = 150;

export function initHistoryPage() {
  const list = document.getElementById("historyList");
  const search = document.getElementById("historySearch");
  const meta = document.getElementById("historyResultMeta");
  if (!list) return;

  // The rating replay walks the whole history and costs ~0.8s at current
  // volume. It depends only on the dataset, not on the search box, so it is
  // cached and recomputed when the data actually changes -- previously it ran
  // again on every keystroke.
  let ratingChanges = new Map();
  let searchIndex = new Map();
  let sortedHistory = [];
  let searchTimer = null;

  const lazyList = createLazyList(list, {
    pageSize: 20,
    emptyHtml: '<p class="card muted">No matches found.</p>',
    renderItem: match => renderMatchCard(
      match,
      ratingChanges.get(matchRatingKey(match))
    ),
    onRendered: (shown, total) => {
      if (meta) {
        meta.textContent = total
          ? `Showing ${shown} of ${total} matches`
          : "";
      }
    }
  });

  function rebuildDataset() {
    const history = state.fullHistory?.length ? state.fullHistory : state.history;
    ratingChanges = buildMatchRatingChanges(state.players, history);
    sortedHistory = history
      .slice()
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    // Pre-flatten each match into one lowercase haystack. The old filter ran
    // JSON.stringify over every match on every keystroke.
    searchIndex = new Map(
      sortedHistory.map(match => [match, searchableText(match)])
    );
  }

  function applyFilter() {
    const query = (search?.value || "").trim().toLowerCase();
    const rows = query
      ? sortedHistory.filter(match => searchIndex.get(match)?.includes(query))
      : sortedHistory;
    lazyList.setItems(rows);
  }

  function render() {
    rebuildDataset();
    applyFilter();
  }

  search?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilter, SEARCH_DEBOUNCE_MS);
  });

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
            : result.previewAdded
              ? `${result.previewAdded} new feed match${result.previewAdded === 1 ? "" : "es"} loaded; Firebase write failed.`
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
    applyFilter();
  });

  render();
  window.addEventListener("lotr:dataChanged", render);
}

// One lowercase haystack per match, built once per dataset instead of
// JSON.stringify-ing every match on every keystroke.
function searchableText(match) {
  const assignments = [...(match.evilAssign || []), ...(match.goodAssign || [])];
  return [
    match.mapName,
    match.winner,
    match.gameId,
    match.id,
    match.date,
    match.timestamp ? new Date(match.timestamp).toLocaleString() : "",
    ...assignments.map(a => a.name),
    ...assignments.map(a => a.civName)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderMatchCard(match, ratingChanges) {
  const date = match.timestamp
    ? new Date(match.timestamp).toLocaleString()
    : "Unknown date";

  const evil = match.evilAssign || [];
  const good = match.goodAssign || [];
  const evilTotal = teamTotal(match, "evil", evil);
  const goodTotal = teamTotal(match, "good", good);

  const winner = match.winner || match.result || "unknown";
  // An admin can exclude a match from the rating replay. It stays listed here,
  // flagged, so an exclusion is visible rather than a silent disappearance.
  const excluded = match.eloExcluded === true;
  const excludedNote = excluded
    ? `<div class="small danger-text">Excluded from Elo${
        match.eloExcludedReason
          ? ` — ${escapeHtml(match.eloExcludedReason)}`
          : ""
      }</div>`
    : "";

  return `
    <article class="card match-card${excluded ? " is-elo-excluded" : ""}">
      <div class="match-head">
        <div>
          <strong>${escapeHtml(match.mapName || match.map || match.name || "LOTR Match")}</strong>
          <div class="muted small">${escapeHtml(date)}</div>
          ${excludedNote}
        </div>
        <div class="winner-badge ${winner}">
          ${escapeHtml(String(winner).toUpperCase())}
        </div>
      </div>

      <div class="teams">
        <section class="team evil-team">
          <h3>Evil ${formatTeamTotal(evilTotal)}</h3>
          ${evil.map(assignment => renderAssignment(assignment, ratingChanges)).join("") || `<p class="muted">No evil assignment</p>`}
        </section>

        <section class="team good-team">
          <h3>Good ${formatTeamTotal(goodTotal)}</h3>
          ${good.map(assignment => renderAssignment(assignment, ratingChanges)).join("") || `<p class="muted">No good assignment</p>`}
        </section>
      </div>

      <div class="match-meta muted">
        Duration: ${fmtDuration(match.duration || match.durationSeconds)}
        ${match.matchId ? ` · Match ID: ${escapeHtml(match.matchId)}` : ""}
      </div>
    </article>
  `;
}

function renderAssignment(a, ratingChanges) {
  const playerName = a.name || a.playerName || "Unknown";
  const player = state.players.find(p => (
    (
      a.profileId &&
      p.profileId &&
      String(a.profileId) === String(p.profileId)
    ) ||
    p.name === playerName
  ));
  const profileLink = player ? `./profile.html?playerId=${encodeURIComponent(player.id)}` : null;
  const delta = player
    ? ratingChanges?.get(String(player.id))
    : undefined;

  const nameHtml = profileLink
    ? `<a href="${profileLink}" class="player-link">${escapeHtml(playerName)}</a>`
    : escapeHtml(playerName);

  return `
    <div class="assignment-row">
      <span>${nameHtml}</span>
      <span class="assignment-rating">
        <span class="muted">${escapeHtml(a.civName || a.civ || "")}</span>
        ${Number.isFinite(delta)
          ? `<strong class="rating-delta ${delta > 0 ? "positive" : delta < 0 ? "negative" : ""}">${formatSigned(delta)}</strong>`
          : `<small class="muted">Unrated</small>`}
      </span>
    </div>
  `;
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function teamTotal(match, side, assignments) {
  const stored = Number(side === "evil" ? match.evilTotal : match.goodTotal);
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}
