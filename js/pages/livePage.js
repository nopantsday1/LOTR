import { importNewMatches } from "../services/matchImportService.js";
import { fetchLobbyJson } from "../services/matchesService.js";
import { toast } from "../ui/toast.js";

export function initLivePage() {
  const button = document.getElementById("livePollNowBtn");
  const status = document.getElementById("liveStatus");
  if (!button) return;

  async function poll() {
    button.disabled = true;

    try {
      const [data, importResult] = await Promise.all([
        fetchLobbyJson(),
        importNewMatches(),
      ]);
      const imported = importResult.added
        ? ` · ${importResult.added} new match${importResult.added === 1 ? "" : "es"} recorded`
        : "";

      status.textContent =
        `Last checked: ${new Date().toLocaleTimeString()} · ` +
        `${data.matches?.length || 0} lobbies${imported}`;
    } catch (error) {
      console.error(error);
      toast("Failed to check live match data", "err");
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", poll);
}
