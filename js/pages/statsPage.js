import { state } from "../core/state.js";

export function initStatsPage() {
  const gamesPerDay = document.getElementById("gamesPerDay");
  if (!gamesPerDay) return;

  function render() {
    gamesPerDay.textContent = `${state.history.length} recorded matches loaded. Move original stats functions here.`;
  }

  render();
  window.addEventListener("lotr:dataChanged", render);
}
