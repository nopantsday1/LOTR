import { LOCAL_SANDBOX } from "../core/config.js";
import { state } from "../core/state.js";

const PLAYERS_KEY = "lotr_sandbox_players";
const HISTORY_KEY = "lotr_sandbox_history";

export function saveSandboxSnapshot() {
  if (!LOCAL_SANDBOX) return;
  localStorage.setItem(PLAYERS_KEY, JSON.stringify(state.players));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

export function loadSandboxSnapshot() {
  if (!LOCAL_SANDBOX) return false;

  const players = localStorage.getItem(PLAYERS_KEY);
  const history = localStorage.getItem(HISTORY_KEY);
  if (!players || !history) return false;

  state.players = JSON.parse(players);
  state.history = JSON.parse(history);
  return true;
}

export function resetSandboxSnapshot() {
  localStorage.removeItem(PLAYERS_KEY);
  localStorage.removeItem(HISTORY_KEY);
  location.reload();
}

window.resetSandboxSnapshot = resetSandboxSnapshot;
