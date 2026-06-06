import { state } from "../core/state.js";
import { initializeRatingModes } from "../elo/ratingModes.js";

export async function loadLocalData() {
  const dataUrl = new URL("./lotr-local-data.json", import.meta.url);
  const res = await fetch(dataUrl, {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Failed to load local data: ${res.status}`);
  }

  const data = await res.json();

  state.history = data.history || data.fullHistory?.slice(0, 100) || [];
  state.fullHistory = data.fullHistory || data.history || [];
  initializeRatingModes(data.players || [], state.fullHistory);

  console.log("[LOCAL DATA] loaded", {
    players: state.players.length,
    history: state.history.length,
    fullHistory: state.fullHistory.length
  });

  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));

  return data;
}
