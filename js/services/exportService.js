import { state } from "../core/state.js";

// A full JSON snapshot of players and match history.
//
// This matters more than it looks: the database accepts writes from anyone, so a
// local backup is the only thing standing between a bad actor (or a bad script)
// and the community's entire rating history. The shape matches
// js/data/lotr-local-data.json, so an export can be dropped straight back in and
// loaded with ?localSandbox=1.
export function buildExportPayload() {
  return {
    exportedAt: new Date().toISOString(),
    // Identity, not the replayed datasets: ratings are derived from history.
    players: state.playerDatasets.original?.length
      ? state.playerDatasets.original
      : state.players,
    history: state.history,
    fullHistory: state.fullHistory || [],
    matchOverrides: [...(state.matchOverrides?.values() || [])]
  };
}

export function downloadDataBackup() {
  const payload = buildExportPayload();
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `lotr-backup-${stamp}.json`;
  link.click();

  URL.revokeObjectURL(url);

  return {
    players: payload.players.length,
    matches: payload.fullHistory.length
  };
}
