import { state } from "../core/state.js";
import { splitTeamOptions } from "../balancer/splitTeams.js";
import { toast } from "../ui/toast.js";
import {
  assignmentPenalty,
  ratingBreakdown
} from "../elo/elo.js";

export function initBalancePage() {
  const picker = document.getElementById("playerPicker");
  const count = document.getElementById("selectedCount");
  const balanceBtn = document.getElementById("balanceBtn");
  const resetTeamsBtn = document.getElementById("resetTeamsBtn");
  const result = document.getElementById("balanceResult");
  const topSplits = document.getElementById("topSplits");
  const search = document.getElementById("balancePlayerSearch");
  const searchMeta = document.getElementById("balanceSearchMeta");
  let balanceOptions = [];
  let selectionLocked = false;

  if (!picker) return;

  function renderPicker() {
    picker.innerHTML = "";
    const query = normalizeSearch(search?.value);
    const players = state.players
      .filter(player => matchesPlayerSearch(player, query))
      .slice()
      .sort((a, b) => gameCount(b) - gameCount(a) ||
        String(a.name || "").localeCompare(String(b.name || "")));

    if (searchMeta) {
      searchMeta.textContent = query
        ? `${players.length} ${players.length === 1 ? "player" : "players"} found`
        : `${players.length} players available`;
    }

    if (!players.length) {
      picker.innerHTML = `<p class="player-search-empty muted">No players match your search.</p>`;
    }

    for (const group of EXPERIENCE_GROUPS) {
      const groupedPlayers = players.filter(player => group.includes(gameCount(player)));
      if (!groupedPlayers.length) continue;

      const section = document.createElement("section");
      section.className = "player-experience-group";
      section.innerHTML = `
        <div class="experience-heading">
          <strong>${group.label}</strong>
          <span>${groupedPlayers.length} players</span>
        </div>
        <div class="experience-player-grid"></div>
      `;

      const grid = section.querySelector(".experience-player-grid");
      for (const player of groupedPlayers) {
        const button = document.createElement("button");
        button.className = "btn player-picker-button";
        button.textContent = player.name || "Unknown";
        button.dataset.id = player.id;
        button.disabled = selectionLocked;
        button.addEventListener("click", () => {
          if (selectionLocked) return;
          if (state.selectedPlayerIds.has(player.id)) state.selectedPlayerIds.delete(player.id);
          else if (state.selectedPlayerIds.size < 8) state.selectedPlayerIds.add(player.id);
          clearBalanceResult();
          renderPicker();
        });
        if (state.selectedPlayerIds.has(player.id)) button.classList.add("primary");
        grid.append(button);
      }

      picker.append(section);
    }
    count.textContent = `${state.selectedPlayerIds.size} / 8 selected`;
    renderBalanceControls();
  }

  function generateBalance() {
    if (selectionLocked) return;

    const selected = state.players.filter(p => state.selectedPlayerIds.has(p.id));
    if (selected.length !== 8) {
      toast("Select exactly 8 players", "err");
      return;
    }

    balanceOptions = splitTeamOptions(selected, { count: 3 });
    state.lastBalance = balanceOptions[0] || null;
    selectionLocked = Boolean(state.lastBalance);
    renderBalanceOptions();
    renderBalanceResult();
    renderPicker();
  }

  function renderBalanceResult() {
    result.innerHTML = state.lastBalance
      ? renderSplit(state.lastBalance)
      : `<p class="muted">No valid assignment found.</p>`;
    bindBalanceDragHandlers(result);
    result.querySelector("[data-copy-balance]")?.addEventListener("click", copyBalanceForLobby);
  }

  function renderBalanceOptions() {
    if (!topSplits) return;

    topSplits.innerHTML = balanceOptions.length
      ? renderOptionPicker(balanceOptions, state.lastBalance)
      : "";

    topSplits.querySelectorAll("[data-balance-option]").forEach(button => {
      button.addEventListener("click", () => {
        const option = balanceOptions[Number(button.dataset.balanceOption)];
        if (!option) return;

        state.lastBalance = option;
        renderBalanceOptions();
        renderBalanceResult();
      });
    });
    topSplits.querySelector("[data-copy-balance]")?.addEventListener("click", copyBalanceForLobby);
  }

  async function copyBalanceForLobby() {
    if (!state.lastBalance) return;

    try {
      await copyText(formatBalanceForLobby(state.lastBalance));
      toast("Teams copied for lobby chat");
    } catch {
      toast("Could not copy teams", "err");
    }
  }

  function clearBalanceResult() {
    state.lastBalance = null;
    balanceOptions = [];
    result.innerHTML = "";
    if (topSplits) topSplits.innerHTML = "";
  }

  function resetTeams() {
    state.selectedPlayerIds.clear();
    selectionLocked = false;
    clearBalanceResult();
    renderPicker();
  }

  function renderBalanceControls() {
    if (balanceBtn) balanceBtn.hidden = selectionLocked;
    if (resetTeamsBtn) resetTeamsBtn.hidden = !selectionLocked;
    if (search) search.disabled = selectionLocked;
  }

  function bindBalanceDragHandlers(container) {
    container.querySelectorAll(".balance-assignment").forEach(row => {
      row.addEventListener("dragstart", event => {
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify({
          side: row.dataset.side,
          index: Number(row.dataset.index)
        }));
      });

      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        container.querySelectorAll(".balance-assignment.drag-over")
          .forEach(item => item.classList.remove("drag-over"));
      });

      row.addEventListener("dragover", event => {
        event.preventDefault();
        row.classList.add("drag-over");
        event.dataTransfer.dropEffect = "move";
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", event => {
        event.preventDefault();
        row.classList.remove("drag-over");

        const source = parseDragSource(event.dataTransfer.getData("application/json"));
        const target = {
          side: row.dataset.side,
          index: Number(row.dataset.index)
        };

        if (!source || !target.side || !Number.isInteger(target.index)) return;
        if (source.side === target.side && source.index === target.index) return;

        swapBalancePlayers(state.lastBalance, source, target);
        state.lastBalance.manualAdjusted = true;
        renderBalanceOptions();
        renderBalanceResult();
      });
    });
  }

  balanceBtn?.addEventListener("click", generateBalance);
  resetTeamsBtn?.addEventListener("click", resetTeams);
  search?.addEventListener("input", renderPicker);

  renderPicker();
  window.addEventListener("lotr:dataChanged", () => {
    selectionLocked = false;
    renderPicker();
    clearBalanceResult();
    renderBalanceControls();
  });
}

const EXPERIENCE_GROUPS = [
  { label: "50+ games", includes: games => games >= 50 },
  { label: "20-49 games", includes: games => games >= 20 && games < 50 },
  { label: "5-19 games", includes: games => games >= 5 && games < 20 },
  { label: "Under 5 games", includes: games => games < 5 }
];

function gameCount(player) {
  return Number(player.gamesPlayed ?? ((player.wins || 0) + (player.losses || 0)));
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

function renderSplit(split) {
  const lobbyString = formatBalanceForLobby(split);

  return `
    ${renderTeam("Evil", split.evil, split.manualAdjusted)}
    ${renderTeam("Good", split.good, split.manualAdjusted)}
    ${split.manualAdjusted
      ? `<div class="manual-balance-note">Manual balance, dragging has been used.</div>`
      : ""}
    <section class="card balance-score">
      <div class="balance-score-heading">
        <h3>Balance Score</h3>
      </div>
      <div>Effective Elo gap: <strong>${split.diff}</strong></div>
      <div>Assignment penalties: <strong>${split.assignmentPenalty}</strong></div>
      <div>Total score: <strong>${split.score}</strong></div>
      <div class="lobby-copy-string">${escapeHtml(lobbyString)}</div>
    </section>
  `;
}

function renderOptionPicker(options, selected) {
  return `
    <div class="balance-options-bar">
      <div class="balance-option-tabs" role="tablist" aria-label="Balance options">
        ${options.map((option, index) => `
          <button
            type="button"
            class="balance-option-tab ${option === selected ? "selected" : ""}"
            data-balance-option="${index}"
            role="tab"
            aria-selected="${option === selected ? "true" : "false"}"
          >
            <span>Option ${index + 1}</span>
          </button>
        `).join("")}
      </div>
      <button type="button" class="btn" data-copy-balance>Copy for Lobby</button>
    </div>
  `;
}

function renderTeam(label, team, manualAdjusted = false) {
  const side = label.toLowerCase();
  return `
    <section class="card team ${side}-team ${manualAdjusted ? "manual" : ""}">
      <h2>${label} · ${team.total} effective Elo</h2>
      ${sortedTeamAssignments(team).map(({ item, index }) => {
        return `
          <div
            class="balance-assignment"
            draggable="true"
            data-side="${side}"
            data-index="${index}"
            title="Drag onto another player to swap positions"
          >
            <div class="balance-drag-handle" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
            <div class="balance-player-main">
              <strong><span class="balance-civ-slot">${escapeHtml(item.civ.id.toUpperCase())}</span> ${escapeHtml(item.player.name)}</strong>
              <span>${escapeHtml(item.civ.name.replace(/^P\d+\s*/, ""))}</span>
            </div>
            <strong class="balance-effective-elo">${item.elo}</strong>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function sortedTeamAssignments(team) {
  return team.assignment
    .map((item, index) => ({ item, index }))
    .sort((a, b) => civOrder(a.item) - civOrder(b.item));
}

function civOrder(item) {
  return Number(item.civ.id.slice(1));
}

function parseDragSource(value) {
  try {
    const source = JSON.parse(value);
    if (!source?.side || !Number.isInteger(source.index)) return null;
    return source;
  } catch {
    return null;
  }
}

function swapBalancePlayers(split, source, target) {
  if (!split) return;

  const sourceTeam = split[source.side];
  const targetTeam = split[target.side];
  const sourceItem = sourceTeam?.assignment?.[source.index];
  const targetItem = targetTeam?.assignment?.[target.index];
  if (!sourceItem || !targetItem) return;

  sourceTeam.assignment[source.index] = buildAssignmentItem(targetItem.player, sourceItem.civ);
  targetTeam.assignment[target.index] = buildAssignmentItem(sourceItem.player, targetItem.civ);
  recalculateSplit(split);
}

function buildAssignmentItem(player, civ) {
  const rating = ratingBreakdown(player, civ.id);

  return {
    player,
    civ,
    mainElo: rating.mainElo,
    elo: rating.balancerElo,
    civBias: rating.civBias,
    hardCivPenalty: rating.hardCivPenalty,
    penalty: assignmentPenalty(player, civ.id, [])
  };
}

function recalculateSplit(split) {
  recalculateTeam(split.evil);
  recalculateTeam(split.good);
  split.diff = Math.abs(split.evil.total - split.good.total);
  split.assignmentPenalty = split.evil.penalty + split.good.penalty;
  split.score = split.diff + split.assignmentPenalty;
  split.signature = balanceSignature(split);
  split.teamSignature = balanceTeamSignature(split);
}

function recalculateTeam(team) {
  team.total = team.assignment.reduce((sum, item) => sum + item.elo, 0);
  team.penalty = team.assignment.reduce((sum, item) => sum + item.penalty, 0);
}

function balanceSignature(split) {
  return [
    ...split.evil.assignment.map(item => `evil:${item.civ.id}:${item.player.id}`),
    ...split.good.assignment.map(item => `good:${item.civ.id}:${item.player.id}`)
  ].sort().join("|");
}

function balanceTeamSignature(split) {
  return [
    `evil:${split.evil.assignment.map(item => item.player.id).sort().join(",")}`,
    `good:${split.good.assignment.map(item => item.player.id).sort().join(",")}`
  ].join("|");
}

function formatBalanceForLobby(split) {
  return [...split.evil.assignment, ...split.good.assignment]
    .sort((a, b) => Number(a.civ.id.slice(1)) - Number(b.civ.id.slice(1)))
    .map(item => `${item.civ.id.toUpperCase()} ${item.player.name}`)
    .join("  ");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny clipboard permission.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed");
  } finally {
    textarea.remove();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}
