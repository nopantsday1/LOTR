import { state } from "../core/state.js";

export function initProfilePage() {
  const root = document.getElementById("profileContent");
  if (!root) return;

  function render() {
    if (!state.linkedPlayer) {
      root.textContent = "No linked player profile.";
      return;
    }

    root.innerHTML = `<pre>${JSON.stringify(state.linkedPlayer, null, 2)}</pre>`;
  }

  render();
  window.addEventListener("lotr:dataChanged", render);
}
