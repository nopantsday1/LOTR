import { state } from "../core/state.js";
import { splitTeams } from "../balancer/splitTeams.js";
import { toast } from "../ui/toast.js";

export function initBalancePage() {
  const picker = document.getElementById("playerPicker");
  const count = document.getElementById("selectedCount");
  const balanceBtn = document.getElementById("balanceBtn");
  const result = document.getElementById("balanceResult");

  if (!picker) return;

  function renderPicker() {
    picker.innerHTML = "";
    for (const player of state.players) {
      const button = document.createElement("button");
      button.className = "btn";
      button.textContent = player.name;
      button.dataset.id = player.id;
      button.addEventListener("click", () => {
        if (state.selectedPlayerIds.has(player.id)) state.selectedPlayerIds.delete(player.id);
        else if (state.selectedPlayerIds.size < 8) state.selectedPlayerIds.add(player.id);
        renderPicker();
      });
      if (state.selectedPlayerIds.has(player.id)) button.classList.add("primary");
      picker.append(button);
    }
    count.textContent = `${state.selectedPlayerIds.size} / 8 selected`;
  }

  balanceBtn?.addEventListener("click", () => {
    const selected = state.players.filter(p => state.selectedPlayerIds.has(p.id));
    if (selected.length !== 8) {
      toast("Select exactly 8 players", "err");
      return;
    }

    const split = splitTeams(selected);
    state.lastBalance = split;
    result.innerHTML = split ? renderSplit(split) : `<p class="muted">No valid assignment found.</p>`;
  });

  renderPicker();
  window.addEventListener("lotr:dataChanged", renderPicker);
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
