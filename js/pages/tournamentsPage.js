// Public tournament page: the hall of champions and the record of every
// tournament. Read-only; editing lives on tournament-admin.html.

import { state } from "../core/state.js";
import {
  buildChampionStandings,
  champions,
  formatTournamentDate,
  isCompleted,
  runnersUp,
  sortTournaments
} from "../core/tournaments.js";
import {
  describeTournamentError,
  subscribeTournaments
} from "../data/tournaments.js";
import { escapeHtml, renderEntrantName, rosterIndex } from "./tournamentView.js";

export function initTournamentsPage() {
  const hall = document.getElementById("tournamentHall");
  const upcoming = document.getElementById("tournamentUpcoming");
  const upcomingWrap = document.getElementById("tournamentUpcomingSection");
  const past = document.getElementById("tournamentPast");
  const meta = document.getElementById("tournamentMeta");
  if (!hall || !past) return;

  let tournaments = null;

  function render() {
    if (!tournaments) return;
    const roster = rosterIndex(state.knownPlayers?.length ? state.knownPlayers : state.players);
    const sorted = sortTournaments(tournaments);
    const done = sorted.filter(isCompleted);
    const pending = sorted.filter(t => !isCompleted(t));

    if (meta) {
      meta.textContent = done.length
        ? `${done.length} ${done.length === 1 ? "tournament" : "tournaments"} decided`
        : "";
    }

    renderHall(hall, buildChampionStandings(done, roster.names), roster);

    if (upcomingWrap) upcomingWrap.hidden = pending.length === 0;
    if (upcoming) {
      upcoming.innerHTML = pending.map(t => renderTournamentCard(t, roster)).join("");
    }

    past.innerHTML = done.length
      ? done.map(t => renderTournamentCard(t, roster)).join("")
      : `<p class="card muted">No tournament results yet. An admin can add them from
         <a class="player-link" href="./tournament-admin.html">Manage tournaments</a>.</p>`;
  }

  subscribeTournaments(
    list => {
      tournaments = list;
      render();
    },
    error => {
      past.innerHTML = `<p class="card error">${escapeHtml(describeTournamentError(error))}</p>`;
    }
  );

  // Roster names arrive separately; re-render so renamed players show correctly.
  window.addEventListener("lotr:dataChanged", render);
}

function renderHall(container, standings, roster) {
  if (!standings.length) {
    container.innerHTML = `<p class="muted">The hall is empty — no champions crowned yet.</p>`;
    return;
  }

  const rows = standings
    .map((row, index) => {
      const rank = index + 1;
      // Only title holders get the crown and the highlight; a row there for
      // runner-up finishes alone just shows its rank.
      const top = row.titles > 0 && rank <= 3;
      const crown = rank === 1 && row.titles > 0 ? "👑" : rank;
      return `
        <li class="hall-row${top ? ` hall-top hall-top-${rank}` : ""}">
          <span class="hall-rank">${crown}</span>
          <span class="hall-name">${renderEntrantName(row, roster)}</span>
          <span class="hall-stat" title="Tournaments won">
            <strong>${row.titles}</strong> ${row.titles === 1 ? "title" : "titles"}
          </span>
          <span class="hall-stat muted" title="Runner-up finishes">
            ${row.runnerUps} runner-up
          </span>
          <span class="hall-stat muted" title="Tournaments played">
            ${row.played} played
          </span>
        </li>`;
    })
    .join("");

  container.innerHTML = `<ol class="hall-list">${rows}</ol>`;
}

function renderTournamentCard(tournament, roster) {
  const date = formatTournamentDate(tournament.date);
  const champs = champions(tournament);
  const seconds = runnersUp(tournament);
  const others = tournament.entrants.filter(e => !e.placement);
  const done = champs.length > 0;

  const champLine = done
    ? `<div class="tournament-podium">
        <div class="podium-first">
          <span class="podium-label">🏆 Champion${champs.length > 1 ? "s" : ""}</span>
          ${tournament.championTeam ? `<span class="podium-team">${escapeHtml(tournament.championTeam)}</span>` : ""}
          <span class="podium-names">${champs.map(e => renderEntrantName(e, roster)).join(" &amp; ")}</span>
        </div>
        ${seconds.length ? `
        <div class="podium-second">
          <span class="podium-label">🥈 Runner-up</span>
          <span class="podium-names">${seconds.map(e => renderEntrantName(e, roster)).join(" &amp; ")}</span>
        </div>` : ""}
      </div>`
    : `<p class="tournament-status">⏳ Upcoming or in progress</p>`;

  const entrantList = tournament.entrants.length
    ? `<details class="tournament-entrants">
        <summary>${tournament.entrants.length} ${tournament.entrants.length === 1 ? "player" : "players"}</summary>
        <div class="entrant-chips">
          ${[...champs, ...seconds, ...others]
            .map(e => `<span class="entrant-chip ${e.placement || ""}">${renderEntrantName(e, roster)}</span>`)
            .join("")}
        </div>
      </details>`
    : "";

  return `
    <article class="card tournament-card${done ? " done" : ""}">
      <header class="tournament-head">
        <div>
          <h3>${escapeHtml(tournament.name)}</h3>
          <div class="muted small">
            ${[date, tournament.format].filter(Boolean).map(escapeHtml).join(" · ")}
          </div>
        </div>
      </header>
      ${champLine}
      ${tournament.notes ? `<p class="tournament-notes">${escapeHtml(tournament.notes)}</p>` : ""}
      ${entrantList}
    </article>`;
}
