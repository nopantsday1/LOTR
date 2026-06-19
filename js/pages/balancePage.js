import { state } from "../core/state.js";
import { splitTeams } from "../balancer/splitTeams.js";
import { toast } from "../ui/toast.js";
import {
  assignmentPenalty,
  civModifier,
  confidenceWeight,
  effectiveCivElo,
  hardCivLowEloPenalty,
  preferenceBonus,
  uncertaintyPenalty
} from "../elo/elo.js";

export function initBalancePage() {
  const picker = document.getElementById("playerPicker");
  const count = document.getElementById("selectedCount");
  const balanceBtn = document.getElementById("balanceBtn");
  const randomBtn = document.getElementById("randomSplitBtn");
  const result = document.getElementById("balanceResult");
  const search = document.getElementById("balancePlayerSearch");
  const searchMeta = document.getElementById("balanceSearchMeta");

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
        button.addEventListener("click", () => {
          if (state.selectedPlayerIds.has(player.id)) state.selectedPlayerIds.delete(player.id);
          else if (state.selectedPlayerIds.size < 8) state.selectedPlayerIds.add(player.id);
          renderPicker();
        });
        if (state.selectedPlayerIds.has(player.id)) button.classList.add("primary");
        grid.append(button);
      }

      picker.append(section);
    }
    count.textContent = `${state.selectedPlayerIds.size} / 8 selected`;
  }

  function generateBalance(random = false) {
    const selected = state.players.filter(p => state.selectedPlayerIds.has(p.id));
    if (selected.length !== 8) {
      toast("Select exactly 8 players", "err");
      return;
    }

    const split = splitTeams(selected, {
      random,
      previousSignature: state.lastBalance?.signature,
      previousTeamSignature: state.lastBalance?.teamSignature
    });
    state.lastBalance = split;
    renderBalanceResult();
  }

  function renderBalanceResult() {
    result.innerHTML = state.lastBalance
      ? renderSplit(state.lastBalance)
      : `<p class="muted">No valid assignment found.</p>`;
    bindBalanceDragHandlers(result);
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
        renderBalanceResult();
      });
    });
  }

  balanceBtn?.addEventListener("click", () => generateBalance(false));
  randomBtn?.addEventListener("click", () => generateBalance(true));
  search?.addEventListener("input", renderPicker);

  renderPicker();
  window.addEventListener("lotr:dataChanged", () => {
    renderPicker();
    result.innerHTML = "";
    state.lastBalance = null;
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
  return `
    ${renderTeam("Evil", split.evil)}
    ${renderTeam("Good", split.good)}
    <section class="card balance-score">
      <h3>Balance Score</h3>
      <div>Effective Elo gap: <strong>${split.diff}</strong></div>
      <div>Assignment penalties: <strong>${split.assignmentPenalty}</strong></div>
      <div>Total score: <strong>${split.score}</strong></div>
      <div class="muted small">
        ${split.selectionMode === "random" ? "Broad random" : "Balanced random"} pick
        · best possible score ${split.bestScore}
        · ${split.eligibleCount} eligible variations
      </div>
    </section>
  `;
}

function renderTeam(label, team) {
  const side = label.toLowerCase();
  return `
    <section class="card team ${side}-team">
      <h2>${label} · ${team.total} effective Elo</h2>
      ${team.assignment.map((item, index) => {
        const adjustment = Math.round(item.confidence * item.modifier);
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
            <div>
              <strong>${escapeHtml(item.civ.id.toUpperCase())} · ${escapeHtml(item.player.name)}</strong>
              <div class="muted small">${escapeHtml(item.civ.name.replace(/^P\d+\s*/, ""))} · drag to swap</div>
            </div>
            <div class="balance-elo-details">
              <span>${Math.round(Number(item.player.mainElo || 0))} main</span>
              <span>${formatSigned(adjustment)} civ</span>
              <strong>${item.elo} effective</strong>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
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
  return {
    player,
    civ,
    elo: effectiveCivElo(player, civ.id),
    modifier: civModifier(player, civ.id),
    confidence: confidenceWeight(player, civ.id),
    preferenceBonus: preferenceBonus(player, civ.id),
    uncertaintyPenalty: uncertaintyPenalty(player, civ.id),
    hardCivPenalty: hardCivLowEloPenalty(player, civ.id),
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

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
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
