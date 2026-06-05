import { state } from "./core/state.js";

window.exportLotrData = function exportLotrData() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    players: state.players,
    history: state.history,
    fullHistoryCache: state.fullHistory || []
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "lotr-local-data.json";
  a.click();

  URL.revokeObjectURL(url);
};