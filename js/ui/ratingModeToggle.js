import { state } from "../core/state.js";
import { RATING_MODES, toggleRatingMode } from "../elo/ratingModes.js";
import { toast } from "./toast.js";

export function initRatingModeToggle() {
  const topbar = document.querySelector(".topbar");
  if (!topbar || document.getElementById("ratingModeBtn")) return;

  const button = document.createElement("button");
  button.id = "ratingModeBtn";
  button.className = "rating-mode-button";
  button.type = "button";
  button.addEventListener("click", () => {
    if (!toggleRatingMode()) return;
    updateButton(button);
    toast(`Rating mode: ${RATING_MODES[state.ratingMode].label}`);
  });

  const sync = document.getElementById("sync");
  topbar.insertBefore(button, sync || null);

  updateButton(button);
  window.addEventListener("lotr:dataChanged", () => updateButton(button));
  window.addEventListener("lotr:ratingModeChanged", () => updateButton(button));
}

function updateButton(button) {
  const mode = RATING_MODES[state.ratingMode] || RATING_MODES.original;
  const ready = Boolean(state.playerDatasets[state.ratingMode]?.length);

  button.disabled = !ready;
  button.innerHTML = `
    <span class="rating-mode-label">Ratings</span>
    <strong>${mode.label}</strong>
  `;
  button.title = ready
    ? `${mode.description}. Click to switch rating datasets.`
    : "Rating datasets are loading.";
}
