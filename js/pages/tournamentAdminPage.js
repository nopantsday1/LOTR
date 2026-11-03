// Tournament management: create, edit and delete tournaments, enter their
// players and mark the champions. Requires the same Firebase admin sign-in as
// the Admin page; a session from there carries over.

import { ADMIN_EMAIL, LOCAL_SANDBOX } from "../core/config.js";
import { state } from "../core/state.js";
import {
  LIMITS,
  PLACEMENT_CHAMPION,
  PLACEMENT_RUNNER_UP,
  entrantKey,
  formatTournamentDate,
  isCompleted,
  sortTournaments,
  champions
} from "../core/tournaments.js";
import { observeAdmin, signInAdmin, signOutAdmin } from "../data/auth.js";
import {
  deleteTournament,
  describeTournamentError,
  saveTournament,
  subscribeTournaments
} from "../data/tournaments.js";
import { toast } from "../ui/toast.js";
import { escapeHtml, renderEntrantName, rosterIndex } from "./tournamentView.js";

const ROSTER_RESULTS = 24;

const PLACEMENT_OPTIONS = [
  { value: PLACEMENT_CHAMPION, label: "🏆 Champion" },
  { value: PLACEMENT_RUNNER_UP, label: "🥈 Runner-up" },
  { value: "", label: "Player" }
];

export function initTournamentAdminPage() {
  const $ = id => document.getElementById(id);
  const login = $("tAdminLogin");
  const tools = $("tAdminTools");
  if (!login || !tools) return;

  // ── Editor state ─────────────────────────────────────────────────────────
  let tournaments = [];
  let editingId = "";
  let entrants = [];
  let pendingDeleteId = "";
  let saving = false;

  const fields = {
    name: $("tName"),
    date: $("tDate"),
    format: $("tFormat"),
    championTeam: $("tChampionTeam"),
    notes: $("tNotes")
  };
  fields.name.maxLength = LIMITS.name;
  fields.format.maxLength = LIMITS.format;
  fields.championTeam.maxLength = LIMITS.championTeam;
  fields.notes.maxLength = LIMITS.notes;

  function setStatus(id, message, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function roster() {
    const players = state.knownPlayers?.length ? state.knownPlayers : state.players;
    return [...(players || [])].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  }

  // ── Sign-in ──────────────────────────────────────────────────────────────
  const sharedEmail = String(ADMIN_EMAIL || "").trim();
  const emailField = $("tAdminEmailField");
  if (emailField) emailField.hidden = Boolean(sharedEmail);

  function applyUser(user) {
    state.adminUnlocked = Boolean(user);
    login.hidden = Boolean(user);
    tools.hidden = !user;
    $("tAdminSignOut").hidden = !user;
    if (user) {
      $("tAdminPass").value = "";
      setStatus("tAdminError", "");
      renderAll();
    }
  }

  $("tAdminLoginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("tAdminSignIn");
    button.disabled = true;
    setStatus("tAdminError", "");
    try {
      const email = sharedEmail || $("tAdminEmail").value;
      const user = await signInAdmin(email, $("tAdminPass").value);
      toast(
        LOCAL_SANDBOX
          ? `Signed in as ${user.email} (sandbox: writes are blocked)`
          : `Signed in as ${user.email}`
      );
    } catch (err) {
      setStatus("tAdminError", err.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("tAdminSignOut").addEventListener("click", async () => {
    try {
      await signOutAdmin();
      toast("Signed out");
    } catch (err) {
      console.error("[tournament-admin]", err);
      toast("Could not sign out", "err");
    }
  });

  observeAdmin(applyUser).catch(err => {
    console.error("[tournament-admin]", err);
    setStatus(
      "tAdminError",
      "Could not reach Firebase Authentication. Check your connection.",
      true
    );
  });

  // ── Roster picker ────────────────────────────────────────────────────────
  const rosterSearch = $("tRosterSearch");
  const rosterList = $("tRosterList");

  function renderRoster() {
    const query = rosterSearch.value.trim().toLowerCase();
    const taken = new Set(entrants.map(entrantKey));
    const matches = roster().filter(
      player =>
        !taken.has(`id:${player.id}`) &&
        (!query || String(player.name || "").toLowerCase().includes(query))
    );
    const shown = matches.slice(0, ROSTER_RESULTS);

    rosterList.innerHTML = shown.length
      ? shown
          .map(
            player =>
              `<button type="button" class="entrant-chip add" data-player-id="${escapeHtml(player.id)}">
                 + ${escapeHtml(player.name || "Unknown")}
               </button>`
          )
          .join("") +
        (matches.length > shown.length
          ? `<span class="muted small">…and ${matches.length - shown.length} more. Type to narrow down.</span>`
          : "")
      : `<span class="muted small">${
          roster().length ? "No roster player matches. Add them as a guest below." : "Loading the roster…"
        }</span>`;
  }

  rosterSearch.addEventListener("input", renderRoster);
  rosterSearch.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    rosterList.querySelector("[data-player-id]")?.click();
  });

  rosterList.addEventListener("click", event => {
    const button = event.target.closest("[data-player-id]");
    if (!button) return;
    const player = roster().find(p => String(p.id) === button.dataset.playerId);
    if (!player) return;
    addEntrant({ name: player.name || "Unknown", playerId: String(player.id) });
    rosterSearch.focus();
  });

  $("tGuestForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("tGuestName");
    const name = input.value.replace(/\s+/g, " ").trim();
    if (!name) return;
    // A guest typed with a roster name is almost always that roster player.
    const member = roster().find(
      p => String(p.name || "").toLowerCase() === name.toLowerCase()
    );
    addEntrant(member ? { name: member.name, playerId: String(member.id) } : { name, playerId: "" });
    input.value = "";
    input.focus();
  });

  function addEntrant(entrant) {
    const candidate = { placement: "", ...entrant };
    const key = entrantKey(candidate);
    if (entrants.some(e => entrantKey(e) === key)) {
      toast(`${candidate.name} is already entered`);
      return;
    }
    if (entrants.length >= LIMITS.entrants) {
      toast(`At most ${LIMITS.entrants} players`, "err");
      return;
    }
    entrants.push(candidate);
    renderEntrants();
    renderRoster();
  }

  // ── Entrants with placements ─────────────────────────────────────────────
  const entrantList = $("tEntrants");

  function renderEntrants() {
    const names = rosterIndex(roster());
    $("tEntrantCount").textContent = entrants.length
      ? `${entrants.length} ${entrants.length === 1 ? "player" : "players"} · ${
          entrants.filter(e => e.placement === PLACEMENT_CHAMPION).length
        } champion(s)`
      : "";

    entrantList.innerHTML = entrants.length
      ? entrants
          .map(
            (entrant, index) => `
          <div class="entrant-row ${entrant.placement}" data-index="${index}">
            <span class="entrant-name">
              ${renderEntrantName(entrant, names)}
              ${entrant.playerId ? "" : '<span class="muted small">guest</span>'}
            </span>
            <span class="placement-toggle" role="group" aria-label="Result for ${escapeHtml(entrant.name)}">
              ${PLACEMENT_OPTIONS.map(
                option => `
                <button type="button" class="btn small-btn${entrant.placement === option.value ? " primary" : ""}"
                        data-placement="${option.value}" aria-pressed="${entrant.placement === option.value}">
                  ${option.label}
                </button>`
              ).join("")}
            </span>
            <button type="button" class="btn small-btn" data-remove aria-label="Remove ${escapeHtml(entrant.name)}">✕</button>
          </div>`
          )
          .join("")
      : `<p class="muted small">No players yet. Pick them from the roster or add a guest.</p>`;
  }

  entrantList.addEventListener("click", event => {
    const row = event.target.closest(".entrant-row");
    if (!row) return;
    const index = Number(row.dataset.index);
    if (event.target.closest("[data-remove]")) {
      entrants.splice(index, 1);
    } else {
      const button = event.target.closest("[data-placement]");
      if (!button) return;
      entrants[index].placement = button.dataset.placement;
    }
    renderEntrants();
    renderRoster();
  });

  // ── Save / edit / reset ──────────────────────────────────────────────────
  function resetEditor() {
    editingId = "";
    entrants = [];
    for (const input of Object.values(fields)) input.value = "";
    $("tEditorTitle").textContent = "New Tournament";
    $("tSaveBtn").textContent = "Save tournament";
    $("tCancelEdit").hidden = true;
    setStatus("tSaveStatus", "");
    renderEntrants();
    renderRoster();
  }

  function loadIntoEditor(tournament) {
    editingId = tournament.id;
    entrants = tournament.entrants.map(e => ({ ...e }));
    fields.name.value = tournament.name || "";
    fields.date.value = tournament.date || "";
    fields.format.value = tournament.format || "";
    fields.championTeam.value = tournament.championTeam || "";
    fields.notes.value = tournament.notes || "";
    $("tEditorTitle").textContent = `Editing: ${tournament.name}`;
    $("tSaveBtn").textContent = "Save changes";
    $("tCancelEdit").hidden = false;
    setStatus("tSaveStatus", "");
    renderEntrants();
    renderRoster();
    $("tEditor").scrollIntoView({ behavior: "smooth", block: "start" });
    fields.name.focus({ preventScroll: true });
  }

  $("tCancelEdit").addEventListener("click", resetEditor);

  $("tSaveBtn").addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    const button = $("tSaveBtn");
    button.disabled = true;
    setStatus("tSaveStatus", "Saving…");

    const input = {
      name: fields.name.value,
      date: fields.date.value,
      format: fields.format.value,
      championTeam: fields.championTeam.value,
      notes: fields.notes.value,
      entrants
    };

    try {
      const previous = tournaments.find(t => t.id === editingId);
      const wasEditing = Boolean(editingId);
      await saveTournament(editingId, input, previous);
      if (!LOCAL_SANDBOX) toast(wasEditing ? "Tournament updated" : "Tournament added");
      resetEditor();
      setStatus("tSaveStatus", wasEditing ? "Changes saved." : "Tournament saved.");
    } catch (err) {
      console.error("[tournament-admin]", err);
      setStatus("tSaveStatus", describeTournamentError(err), true);
    } finally {
      saving = false;
      button.disabled = false;
    }
  });

  // ── Existing tournaments ─────────────────────────────────────────────────
  const existing = $("tExisting");

  function renderExisting() {
    const names = rosterIndex(roster());
    const sorted = sortTournaments(tournaments);
    existing.innerHTML = sorted.length
      ? sorted
          .map(t => {
            const champs = champions(t);
            const date = formatTournamentDate(t.date);
            const confirming = pendingDeleteId === t.id;
            return `
            <div class="tournament-admin-row${t.id === editingId ? " editing" : ""}" data-id="${escapeHtml(t.id)}">
              <div>
                <strong>${escapeHtml(t.name)}</strong>
                <div class="muted small">
                  ${[date, t.format, `${t.entrants.length} players`].filter(Boolean).map(escapeHtml).join(" · ")}
                </div>
                <div class="small">
                  ${isCompleted(t)
                    ? `🏆 ${champs.map(e => renderEntrantName(e, names)).join(" &amp; ")}`
                    : '<span class="muted">⏳ No champion yet</span>'}
                </div>
              </div>
              <div class="actions">
                <button type="button" class="btn" data-edit>Edit</button>
                <button type="button" class="btn danger" data-delete>
                  ${confirming ? "Click again to delete" : "Delete"}
                </button>
              </div>
            </div>`;
          })
          .join("")
      : `<p class="muted small">No tournaments yet.</p>`;
  }

  existing.addEventListener("click", async event => {
    const row = event.target.closest(".tournament-admin-row");
    if (!row) return;
    const tournament = tournaments.find(t => t.id === row.dataset.id);
    if (!tournament) return;

    if (event.target.closest("[data-edit]")) {
      pendingDeleteId = "";
      loadIntoEditor(tournament);
      renderExisting();
      return;
    }

    if (event.target.closest("[data-delete]")) {
      // Two clicks instead of a browser confirm() dialog.
      if (pendingDeleteId !== tournament.id) {
        pendingDeleteId = tournament.id;
        renderExisting();
        setTimeout(() => {
          if (pendingDeleteId === tournament.id) {
            pendingDeleteId = "";
            renderExisting();
          }
        }, 4000);
        return;
      }
      pendingDeleteId = "";
      try {
        await deleteTournament(tournament.id);
        if (editingId === tournament.id) resetEditor();
        if (!LOCAL_SANDBOX) toast(`Deleted ${tournament.name}`);
      } catch (err) {
        console.error("[tournament-admin]", err);
        toast(describeTournamentError(err), "err");
      }
      renderExisting();
    }
  });

  function renderAll() {
    renderRoster();
    renderEntrants();
    renderExisting();
  }

  subscribeTournaments(
    list => {
      tournaments = list;
      if (state.adminUnlocked) renderExisting();
    },
    error => setStatus("tSaveStatus", describeTournamentError(error), true)
  );

  window.addEventListener("lotr:dataChanged", () => {
    if (state.adminUnlocked) renderAll();
  });

  resetEditor();
}
