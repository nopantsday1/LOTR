import { ADMIN_EMAIL, LOCAL_SANDBOX } from "../core/config.js";
import {
  observeAdmin,
  sendAdminPasswordReset,
  signInAdmin,
  signOutAdmin
} from "../data/auth.js";
import {
  LOBBY_KEYWORDS,
  OVERRIDABLE_REJECTIONS,
  REJECT_LABELS
} from "../core/matchRules.js";
import { state } from "../core/state.js";
import {
  EXCLUDE,
  INCLUDE,
  clearMatchOverride,
  getOverride,
  overrideKey,
  setMatchOverride
} from "../data/matchOverrides.js";
import {
  addPlayer,
  clearEloAdjustment,
  setEloAdjustment
} from "../services/adminService.js";
import { parseEloValue } from "../core/playerInput.js";
import { classifyFeedMatches } from "../services/matchImportService.js";
import { downloadDataBackup } from "../services/exportService.js";
import { decayedElo } from "../elo/elo.js";
import {
  buildMatchRatingChanges,
  matchRatingKey
} from "../elo/progress.js";
import { fmtDuration } from "../utils/format.js";
import { toast } from "../ui/toast.js";

const LIST_PAGE_SIZE = 40;

let cachedRejected = null;

export function initAdminPage() {
  const unlock = document.getElementById("adminUnlockBtn");
  if (!unlock) return;

  const lock = document.getElementById("adminLockBtn");
  const form = document.getElementById("adminLoginForm");
  const email = document.getElementById("adminEmail");
  const password = document.getElementById("adminPass");
  const error = document.getElementById("adminError");
  const login = document.getElementById("adminLogin");
  const tools = document.getElementById("adminTools");

  // With a shared admin account configured, the form is password-only: the
  // email is a fixed username, not something each admin needs to know.
  const emailField = document.getElementById("adminEmailField");
  const sharedEmail = String(ADMIN_EMAIL || "").trim();
  if (emailField) emailField.hidden = Boolean(sharedEmail);
  if (sharedEmail && email) email.value = sharedEmail;

  // A shared account's address is often not a real mailbox, and rotating a
  // shared password belongs in the Firebase Console anyway.
  const resetBtn = document.getElementById("adminResetBtn");
  if (resetBtn && sharedEmail) resetBtn.hidden = true;

  function adminEmail() {
    return sharedEmail || email?.value || "";
  }

  // Show/hide the password, as most sign-in forms allow.
  const passToggle = document.getElementById("adminPassToggle");

  function setPasswordVisible(visible) {
    if (!password || !passToggle) return;
    password.type = visible ? "text" : "password";
    passToggle.textContent = visible ? "Hide" : "Show";
    passToggle.setAttribute("aria-pressed", String(visible));
    passToggle.setAttribute(
      "aria-label",
      visible ? "Hide password" : "Show password"
    );
  }

  passToggle?.addEventListener("click", () => {
    const visible = password?.type === "text";
    setPasswordVisible(!visible);
    // Keep the caret where it was, so typing can continue uninterrupted.
    password?.focus();
  });

  function showError(message) {
    if (!error) return;
    error.textContent = message || "";
    error.hidden = !message;
  }

  // Driven by Firebase's auth state rather than a local flag, so a restored
  // session, a sign-out in another tab, and a revoked account all take effect
  // here without a reload.
  function applyUser(user) {
    state.adminUnlocked = Boolean(user);
    login.hidden = Boolean(user);
    tools.hidden = !user;

    // Never leave a revealed password on screen across a sign-in or sign-out.
    setPasswordVisible(false);

    if (user) {
      showError("");
      if (password) password.value = "";
      setStatus("adminAuthStatus", `Signed in as ${user.email}`);
      renderAll();
    } else {
      setStatus("adminAuthStatus", "");
    }
  }

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    unlock.disabled = true;
    showError("");
    setStatus("adminAuthStatus", "Signing in...");

    try {
      const user = await signInAdmin(adminEmail(), password?.value);
      toast(
        LOCAL_SANDBOX
          ? `Signed in as ${user.email} (sandbox: writes are blocked)`
          : `Signed in as ${user.email}`
      );
      // applyUser runs from the auth-state listener.
    } catch (err) {
      showError(err.message);
      setStatus("adminAuthStatus", "");
    } finally {
      unlock.disabled = false;
    }
  });

  document.getElementById("adminResetBtn")?.addEventListener("click", async () => {
    showError("");
    try {
      await sendAdminPasswordReset(adminEmail());
      setStatus(
        "adminAuthStatus",
        "If that address has an admin account, a reset link is on its way."
      );
    } catch (err) {
      showError(err.message);
    }
  });

  password?.addEventListener("input", () => showError(""));

  lock?.addEventListener("click", async () => {
    try {
      await signOutAdmin();
      toast("Signed out");
    } catch (err) {
      console.error("[admin]", err);
      toast("Could not sign out", "err");
    }
  });

  observeAdmin(applyUser).catch(err => {
    console.error("[admin]", err);
    showError(
      "Could not reach Firebase Authentication. Check that Email/Password " +
      "sign-in is enabled under Firebase Console > Security > Authentication > " +
      "Sign-in method."
    );
  });

  const keywordList = document.getElementById("adminKeywordList");
  if (keywordList) {
    keywordList.textContent = LOBBY_KEYWORDS
      .map(keyword => keyword.toUpperCase())
      .join(", ");
  }

  initEloSection();
  initAddPlayerSection();
  initHistorySection();
  initRejectedSection();
  initExportSection();

  window.addEventListener("lotr:dataChanged", () => {
    if (state.adminUnlocked) renderAll();
  });
}

function renderAll() {
  // Only refresh the Elo picker while the editor is actually open. Doing it
  // mid-confirm would rewrite the input under the admin's hands when a
  // background snapshot arrives.
  if (eloStep === ELO_STEP_EDIT) renderEloPlayers();
  renderHistoryList();
}

// --- helpers ---------------------------------------------------------------

// Identity lives on the original dataset; the other datasets are replays of it.
function identityPlayers() {
  return state.playerDatasets.original?.length
    ? state.playerDatasets.original
    : state.players || [];
}

function setStatus(id, message, isError = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("error", Boolean(isError));
}

// Wraps an admin write so every handler surfaces failures the same way, rather
// than swallowing them into the console.
async function runWrite(statusId, workingMessage, action) {
  setStatus(statusId, workingMessage);
  try {
    const message = await action();
    setStatus(statusId, message || "Saved.");
    if (message) toast(message);
    return true;
  } catch (err) {
    console.error("[admin]", err);
    const detail = err?.code === "permission-denied"
      ? "Firestore rejected the write (permission denied). Check your security rules."
      : err?.message || "The write failed.";
    setStatus(statusId, detail, true);
    toast("Admin action failed", "err");
    return false;
  }
}

// --- 2. Change a player's Elo ----------------------------------------------
//
// Three deliberate steps: open the editor, type a value, confirm. Overriding a
// rating changes the leaderboard and team balancing for everyone, and is only
// meant for correcting a rating that went wrong, so it should not be reachable
// by one stray click.
//
// The admin enters the Elo they want the player to HAVE. Ratings are derived by
// replaying match history, so there is no stored number to overwrite; the
// difference between the target and the replayed value is saved as the
// adjustment. The seed/base knob is deliberately not exposed -- setting where a
// replay starts is not what anyone actually wants to do.

const ELO_STEP_CLOSED = "closed";
const ELO_STEP_EDIT = "edit";
const ELO_STEP_CONFIRM = "confirm";

let eloStep = ELO_STEP_CLOSED;
let pendingElo = null;

function initEloSection() {
  const picker = document.getElementById("adminEloPlayer");
  if (!picker) return;

  picker.addEventListener("change", renderEloReadout);

  document.getElementById("adminEloOpenBtn")?.addEventListener("click", () => {
    setEloStep(ELO_STEP_EDIT);
    renderEloPlayers();
    setStatus("adminEloStatus", "");
  });

  document.getElementById("adminEloCancelBtn")?.addEventListener("click", () => {
    setEloStep(ELO_STEP_CLOSED);
    setStatus("adminEloStatus", "");
  });

  document.getElementById("adminEloBackBtn")?.addEventListener("click", () => {
    setEloStep(ELO_STEP_EDIT);
  });

  document.getElementById("adminEloReviewBtn")?.addEventListener("click", () => {
    const player = selectedEloPlayer();
    if (!player) return;

    const input = document.getElementById("adminEloNew");
    let target;
    try {
      target = parseEloValue(input?.value, "New Elo");
    } catch (err) {
      setStatus("adminEloStatus", err.message, true);
      return;
    }

    const current = currentEloOf(player.id);
    if (current === null) {
      setStatus("adminEloStatus", "That player has no rating yet.", true);
      return;
    }
    if (target === current) {
      setStatus("adminEloStatus", "That is already their current Elo.", true);
      return;
    }

    pendingElo = { playerId: player.id, name: player.name, current, target };
    renderEloSummary();
    setEloStep(ELO_STEP_CONFIRM);
    setStatus("adminEloStatus", "");
  });

  document.getElementById("adminEloConfirmBtn")?.addEventListener("click", () => {
    if (!pendingElo) return;
    const { playerId, name, current, target } = pendingElo;

    runWrite("adminEloStatus", "Saving...", async () => {
      // Stored as a correction on top of the replayed value, because the
      // replayed value is recomputed from history on every load.
      const existing = Number(
        identityPlayers().find(p => String(p.id) === String(playerId))
          ?.eloAdjustment
      );
      const base = Number.isFinite(existing) ? existing : 0;
      await setEloAdjustment(playerId, base + (target - current));

      pendingElo = null;
      setEloStep(ELO_STEP_CLOSED);
      return `${name}: ${current} → ${target}.`;
    });
  });

  document.getElementById("adminEloResetBtn")?.addEventListener("click", () => {
    const player = selectedEloPlayer();
    if (!player) return;

    runWrite("adminEloStatus", "Removing override...", async () => {
      await clearEloAdjustment(player.id);
      setEloStep(ELO_STEP_CLOSED);
      return `${player.name} is back to their calculated rating.`;
    });
  });

  setEloStep(ELO_STEP_CLOSED);
}

function setEloStep(step) {
  eloStep = step;
  toggle("adminEloClosed", step === ELO_STEP_CLOSED);
  toggle("adminEloEditor", step === ELO_STEP_EDIT);
  toggle("adminEloConfirm", step === ELO_STEP_CONFIRM);
  if (step !== ELO_STEP_CONFIRM) pendingElo = null;
}

function toggle(id, visible) {
  const node = document.getElementById(id);
  if (node) node.hidden = !visible;
}

function selectedEloPlayer() {
  const picker = document.getElementById("adminEloPlayer");
  const playerId = picker?.value;
  return identityPlayers().find(p => String(p.id) === String(playerId)) || null;
}

// The rating actually on display, from the replayed dataset currently in view.
function currentEloOf(playerId) {
  const replayed = (state.players || []).find(p => String(p.id) === String(playerId));
  return replayed ? decayedElo(replayed) : null;
}

function renderEloPlayers() {
  const picker = document.getElementById("adminEloPlayer");
  if (!picker) return;

  const players = identityPlayers()
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const previous = picker.value;

  picker.innerHTML = players
    .map(player => {
      const label = escapeHtml(player.name || "Unnamed");
      return `<option value="${escapeHtml(player.id)}">${label}</option>`;
    })
    .join("");

  if (previous && players.some(player => String(player.id) === previous)) {
    picker.value = previous;
  }
  renderEloReadout();
}

function renderEloReadout() {
  const readout = document.getElementById("adminEloCurrent");
  const input = document.getElementById("adminEloNew");
  const resetBtn = document.getElementById("adminEloResetBtn");
  if (!readout) return;

  const player = selectedEloPlayer();
  if (!player) {
    readout.textContent = "";
    return;
  }

  const replayed = (state.players || []).find(p => String(p.id) === String(player.id));
  const current = currentEloOf(player.id);
  const adjustment = Number(player.eloAdjustment);
  const hasAdjustment = Number.isFinite(adjustment) && adjustment !== 0;

  readout.innerHTML = [
    `<span>Current Elo: <strong>${current ?? "&mdash;"}</strong></span>`,
    `<span>Games played: <strong>${Number(replayed?.gamesPlayed || 0)}</strong></span>`,
    hasAdjustment
      ? `<span>Manual override: <strong>${adjustment > 0 ? "+" : ""}${adjustment}</strong></span>`
      : `<span>Manual override: <strong>none</strong></span>`
  ].join("");

  // Pre-filled with the current value, so the field shows what it is changing.
  if (input) input.value = current ?? "";
  if (resetBtn) resetBtn.hidden = !hasAdjustment;
}

function renderEloSummary() {
  const summary = document.getElementById("adminEloSummary");
  if (!summary || !pendingElo) return;

  const { name, current, target } = pendingElo;
  const delta = target - current;
  const sign = delta > 0 ? "+" : "";

  summary.innerHTML =
    `<strong>${escapeHtml(name)}</strong>: ` +
    `${current} → <strong>${target}</strong> ` +
    `<span class="${delta > 0 ? "positive" : "negative"}">(${sign}${delta})</span>`;
}

// --- 1. Add player ---------------------------------------------------------

function initAddPlayerSection() {
  const button = document.getElementById("adminAddPlayerBtn");
  if (!button) return;

  button.addEventListener("click", () => {
    const name = document.getElementById("adminNewName")?.value;
    const profileId = document.getElementById("adminNewProfileId")?.value;
    const altProfileIds = document.getElementById("adminNewAltIds")?.value;
    const seedElo = document.getElementById("adminNewSeedElo")?.value;

    runWrite("adminAddStatus", "Adding player...", async () => {
      const created = await addPlayer({ name, profileId, altProfileIds, seedElo });
      [
        "adminNewName",
        "adminNewProfileId",
        "adminNewAltIds",
        "adminNewSeedElo"
      ].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      return created.profileId
        ? `Added ${created.name} at ${created.mainElo} Elo.`
        : `Added ${created.name} at ${created.mainElo} Elo. Without a profile ID their games will not auto-import.`;
    });
  });
}

// --- 3. Exclude recorded games --------------------------------------------

function initHistorySection() {
  const search = document.getElementById("adminHistorySearch");
  if (!search) return;

  search.addEventListener("input", renderHistoryList);
  const historyList = document.getElementById("adminHistoryList");
  historyList?.addEventListener("click", onMatchListClick);
  historyList?.addEventListener("click", onMatchDetailsClick);
}

function renderHistoryList() {
  const list = document.getElementById("adminHistoryList");
  if (!list) return;

  const query = (document.getElementById("adminHistorySearch")?.value || "")
    .toLowerCase();
  const all = state.fullHistory || [];
  const filtered = query
    ? all.filter(match => JSON.stringify(match).toLowerCase().includes(query))
    : all;
  const shown = filtered.slice(0, LIST_PAGE_SIZE);
  const excludedCount = all.filter(match => match.eloExcluded).length;
  const truncated = filtered.length > shown.length
    ? ` · showing the first ${shown.length} of ${filtered.length}`
    : "";

  setStatus(
    "adminHistoryStatus",
    `${all.length} recorded games · ${excludedCount} excluded from Elo${truncated}`
  );

  if (!shown.length) {
    list.innerHTML = `<p class="muted small">No recorded games match that search.</p>`;
    return;
  }

  list.innerHTML = shown.map(match => {
    const id = overrideKey(match);
    const excluded = match.eloExcluded === true;
    return matchRow({
      id,
      title: match.mapName || "LOTR Match",
      meta: [
        match.timestamp
          ? new Date(match.timestamp).toLocaleString()
          : "Unknown date",
        `Winner: ${String(match.winner || "?").toUpperCase()}`,
        fmtDuration(match.duration),
        `ID ${id}`
      ],
      flagged: excluded,
      flagLabel: "Excluded from Elo",
      buttonLabel: excluded ? "Re-include in Elo" : "Exclude from Elo",
      buttonClass: excluded ? "" : "danger",
      action: excluded ? "clear" : "exclude"
    });
  }).join("");
}

// --- 4. Re-include discarded games ----------------------------------------

function initRejectedSection() {
  const button = document.getElementById("adminLoadRejectedBtn");
  if (!button) return;

  button.addEventListener("click", loadRejected);
  document.getElementById("adminOnlyOverridable")
    ?.addEventListener("change", () => {
      if (cachedRejected) renderRejectedList(cachedRejected);
    });
  const rejectedList = document.getElementById("adminRejectedList");
  rejectedList?.addEventListener("click", onMatchListClick);
  rejectedList?.addEventListener("click", onMatchDetailsClick);
}

async function loadRejected() {
  const button = document.getElementById("adminLoadRejectedBtn");
  if (button) button.disabled = true;
  setStatus("adminRejectedStatus", "Reading the generated match feed...");

  try {
    const classified = await classifyFeedMatches();
    cachedRejected = classified
      .filter(entry => entry.rejectedFor && !entry.inHistory);
    renderRejectedList(cachedRejected);
  } catch (err) {
    console.error("[admin]", err);
    setStatus(
      "adminRejectedStatus",
      `Could not read the feed: ${err.message}`,
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
}

function renderRejectedList(entries) {
  const list = document.getElementById("adminRejectedList");
  if (!list) return;

  const onlyOverridable = document
    .getElementById("adminOnlyOverridable")?.checked !== false;
  const shown = onlyOverridable
    ? entries.filter(entry => OVERRIDABLE_REJECTIONS.has(entry.rejectedFor))
    : entries;

  const byReason = entries.reduce((acc, entry) => {
    acc[entry.rejectedFor] = (acc[entry.rejectedFor] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} × ${REJECT_LABELS[reason] || reason}`)
    .join(" · ");

  setStatus(
    "adminRejectedStatus",
    `${entries.length} discarded games${summary ? ` — ${summary}` : ""}`
  );

  if (!shown.length) {
    list.innerHTML = `<p class="muted small">Nothing discarded that you can override.</p>`;
    return;
  }

  list.innerHTML = shown.slice(0, LIST_PAGE_SIZE).map(entry => {
    const included = getOverride(entry.gameId)?.mode === INCLUDE;
    const overridable = OVERRIDABLE_REJECTIONS.has(entry.rejectedFor);
    const label = included
      ? "Cancel import"
      : overridable ? "Include in Elo" : "Cannot be included";

    return matchRow({
      id: entry.gameId,
      title: entry.lobbyName || "(no lobby name)",
      meta: [
        entry.timestamp
          ? new Date(entry.timestamp).toLocaleString()
          : "Unknown date",
        `${entry.memberCount} players`,
        `${entry.communityCount} community`,
        entry.duration !== null ? fmtDuration(entry.duration) : "Unknown length",
        `ID ${entry.gameId}`
      ],
      flagged: included,
      flagLabel: "Marked for import",
      note: REJECT_LABELS[entry.rejectedFor] || entry.rejectedFor,
      buttonLabel: label,
      buttonClass: included ? "" : "primary",
      action: included ? "clear" : "include",
      disabled: !overridable && !included
    });
  }).join("");
}

// --- 5. Backup -------------------------------------------------------------

function initExportSection() {
  document.getElementById("adminExportBtn")?.addEventListener("click", () => {
    try {
      const { players, matches } = downloadDataBackup();
      setStatus(
        "adminExportStatus",
        `Downloaded ${players} players and ${matches} matches.`
      );
    } catch (err) {
      console.error("[admin]", err);
      setStatus("adminExportStatus", `Export failed: ${err.message}`, true);
    }
  });
}

// --- shared row rendering + delegated actions -----------------------------

function matchRow({
  id,
  title,
  meta,
  flagged,
  flagLabel,
  note,
  buttonLabel,
  buttonClass,
  action,
  disabled = false
}) {
  const metaLine = meta.filter(Boolean).map(escapeHtml).join(" · ");
  const noteLine = note
    ? `<div class="small danger-text">${escapeHtml(note)}</div>`
    : "";
  const flagLine = flagged
    ? `<div class="small"><strong>${escapeHtml(flagLabel)}</strong></div>`
    : "";

  // The roster is rendered on demand rather than upfront: 40 rows x 8 players
  // is a lot of DOM for something usually only wanted on one match, and the
  // recorded-game view needs a full rating replay to show Elo deltas.
  return `
    <article class="admin-match ${flagged ? "is-flagged" : ""}">
      <div class="admin-match-head">
        <div class="admin-match-body">
          <strong>${escapeHtml(title)}</strong>
          <div class="muted small">${metaLine}</div>
          ${noteLine}
          ${flagLine}
        </div>
        <div class="admin-match-actions">
          <button
            class="btn admin-match-toggle"
            data-match-details="${escapeHtml(id)}"
            aria-expanded="false"
          >Players</button>
          <button
            class="btn ${buttonClass}"
            data-match-action="${escapeHtml(action)}"
            data-match-id="${escapeHtml(id)}"
            ${disabled ? "disabled" : ""}
          >${escapeHtml(buttonLabel)}</button>
        </div>
      </div>
      <div class="admin-match-details" data-details-for="${escapeHtml(id)}" hidden></div>
    </article>
  `;
}

// Rating deltas need a full replay of match history (~360ms), so it is computed
// the first time a roster is opened and reused afterwards. Invalidated whenever
// the underlying data changes.
let cachedRatingChanges = null;
let cachedRatingChangesFor = null;

function ratingChangesForHistory() {
  const history = state.fullHistory || [];
  if (cachedRatingChanges && cachedRatingChangesFor === history) {
    return cachedRatingChanges;
  }
  cachedRatingChanges = buildMatchRatingChanges(state.players, history);
  cachedRatingChangesFor = history;
  return cachedRatingChanges;
}

function onMatchDetailsClick(event) {
  const toggle = event.target.closest("[data-match-details]");
  if (!toggle) return;

  const id = toggle.dataset.matchDetails;
  const panel = toggle
    .closest(".admin-match")
    ?.querySelector(`[data-details-for="${CSS.escape(id)}"]`);
  if (!panel) return;

  if (!panel.hidden) {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Players";
    return;
  }

  // Rendered once, then kept, so reopening is instant.
  if (!panel.dataset.loaded) {
    panel.innerHTML = `<p class="muted small">Loading...</p>`;
    panel.hidden = false;
    // setTimeout, not requestAnimationFrame: rAF does not run in a hidden or
    // background tab, which would leave this stuck on "Loading..." forever.
    // Yielding at all is only so the placeholder paints before the replay.
    window.setTimeout(() => {
      try {
        panel.innerHTML = toggle.closest("#adminRejectedList")
          ? renderFeedRoster(id)
          : renderRecordedRoster(id);
        panel.dataset.loaded = "1";
      } catch (err) {
        console.error("[admin]", err);
        panel.innerHTML = `<p class="small danger-text">Could not load players.</p>`;
      }
    }, 0);
  }

  panel.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "Hide players";
}

// Recorded games: the same teams, civs and Elo deltas the History page shows.
function renderRecordedRoster(id) {
  const match = (state.fullHistory || []).find(m => overrideKey(m) === String(id));
  if (!match) return `<p class="muted small">This match is no longer loaded.</p>`;

  const changes = ratingChangesForHistory().get(matchRatingKey(match));
  const evil = match.evilAssign || [];
  const good = match.goodAssign || [];

  if (!evil.length && !good.length) {
    return `<p class="muted small">No team data was recorded for this match.</p>`;
  }

  return `
    <div class="admin-match-teams">
      ${rosterTeam("Evil", evil, changes, match.winner === "evil")}
      ${rosterTeam("Good", good, changes, match.winner === "good")}
    </div>
  `;
}

function rosterTeam(label, assignments, changes, won) {
  const rows = assignments.map(assignment => {
    const name = assignment.name || assignment.playerName || "Unknown";
    const player = (state.players || []).find(p => (
      (assignment.profileId && p.profileId &&
        String(assignment.profileId) === String(p.profileId)) ||
      p.name === name
    ));
    const delta = player ? changes?.get(String(player.id)) : undefined;
    const nameHtml = player
      ? `<a class="player-link" href="./profile.html?playerId=${encodeURIComponent(player.id)}">${escapeHtml(name)}</a>`
      : escapeHtml(name);
    const deltaHtml = Number.isFinite(delta)
      ? `<strong class="rating-delta ${delta > 0 ? "positive" : delta < 0 ? "negative" : ""}">${delta > 0 ? "+" : ""}${delta}</strong>`
      : `<small class="muted">unrated</small>`;

    return `
      <div class="assignment-row">
        <span>${nameHtml}</span>
        <span class="assignment-rating">
          <span class="muted">${escapeHtml(assignment.civName || assignment.civId || "")}</span>
          ${deltaHtml}
        </span>
      </div>
    `;
  }).join("");

  return `
    <section class="team ${label.toLowerCase()}-team">
      <h4>${escapeHtml(label)}${won ? " · won" : ""}</h4>
      ${rows || `<p class="muted small">No players recorded.</p>`}
    </section>
  `;
}

// Discarded games: no ratings exist yet, so show who was in the lobby and
// which of them the roster recognises. That is the thing worth knowing before
// deciding to include a game.
function renderFeedRoster(id) {
  const entry = (cachedRejected || []).find(e => String(e.gameId) === String(id));
  if (!entry) return `<p class="muted small">This game is no longer loaded.</p>`;
  if (!entry.roster?.length) {
    return `<p class="muted small">The feed listed no players for this game.</p>`;
  }

  const rows = entry.roster
    .slice()
    .sort((a, b) => Number(b.isCommunity) - Number(a.isCommunity))
    .map(member => `
      <div class="assignment-row">
        <span>${escapeHtml(member.name)}</span>
        <span class="assignment-rating">
          <span class="muted">${escapeHtml(member.civName || "")}</span>
          <small class="muted">${member.isCommunity ? "community" : "guest"}</small>
        </span>
      </div>
    `).join("");

  return `
    <section class="team">
      <h4>In this game (${entry.roster.length})</h4>
      ${rows}
    </section>
  `;
}

function onMatchListClick(event) {
  const button = event.target.closest("[data-match-action]");
  if (!button) return;

  const { matchAction, matchId } = button.dataset;
  const inRejectedList = Boolean(button.closest("#adminRejectedList"));
  const statusId = inRejectedList
    ? "adminRejectedStatus"
    : "adminHistoryStatus";

  button.disabled = true;
  runWrite(statusId, "Saving override...", async () => {
    if (matchAction === "clear") {
      await clearMatchOverride(matchId);
      return `Override cleared for match ${matchId}.`;
    }
    const mode = matchAction === "include" ? INCLUDE : EXCLUDE;
    await setMatchOverride(matchId, mode);
    return mode === INCLUDE
      ? `Match ${matchId} will be imported on the next check.`
      : `Match ${matchId} no longer counts towards Elo.`;
  }).finally(() => {
    button.disabled = false;
    if (inRejectedList && cachedRejected) renderRejectedList(cachedRejected);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
