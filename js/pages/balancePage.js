import { state } from "../core/state.js";
import { splitTeams } from "../balancer/splitTeams.js";
import { toast } from "../ui/toast.js";

export function initBalancePage() {
  const picker = document.getElementById("playerPicker");
  const count = document.getElementById("selectedCount");
  const balanceBtn = document.getElementById("balanceBtn");
  const randomBtn = document.getElementById("randomSplitBtn");
  const result = document.getElementById("balanceResult");

  if (!picker) return;

  function renderPicker() {
    picker.innerHTML = "";
    const players = state.players
      .slice()
      .sort((a, b) => gameCount(b) - gameCount(a) ||
        String(a.name || "").localeCompare(String(b.name || "")));

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
    result.innerHTML = split ? renderSplit(split) : `<p class="muted">No valid assignment found.</p>`;
  }

  balanceBtn?.addEventListener("click", () => generateBalance(false));
  randomBtn?.addEventListener("click", () => generateBalance(true));

  renderPicker();
  window.addEventListener("lotr:dataChanged", () => {
    renderPicker();
    result.innerHTML = "";
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
  return `
    <section class="card team ${label.toLowerCase()}-team">
      <h2>${label} · ${team.total} effective Elo</h2>
      ${team.assignment.map(item => {
        const adjustment = Math.round(item.confidence * item.modifier);
        return `
          <div class="balance-assignment">
            <div>
              <strong>${escapeHtml(item.civ.id.toUpperCase())} · ${escapeHtml(item.player.name)}</strong>
              <div class="muted small">${escapeHtml(item.civ.name.replace(/^P\d+\s*/, ""))}</div>
            </div>
            <div class="balance-elo-details">
              <span>${item.player.mainElo} main</span>
              <span>${formatSigned(adjustment)} civ</span>
              <strong>${item.elo} effective</strong>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
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
