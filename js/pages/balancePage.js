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
    result.innerHTML = `<pre>${JSON.stringify(split, null, 2)}</pre>`;
  });

  renderPicker();
  window.addEventListener("lotr:dataChanged", renderPicker);
}
