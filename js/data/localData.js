import { state } from "../core/state.js";

export async function loadLocalData() {
  const res = await fetch("/js/data/lotr-local-data.json", {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Failed to load local data: ${res.status}`);
  }

  const data = await res.json();

  state.players = data.players || [];
  state.history = data.history || data.fullHistory?.slice(0, 100) || [];
  state.fullHistory = data.fullHistory || data.history || [];

  console.log("[LOCAL DATA] loaded", {
    players: state.players.length,
    history: state.history.length,
    fullHistory: state.fullHistory.length
  });

  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));

  return data;
}