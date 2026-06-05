import { fetchLobbyJson } from "../services/matchesService.js";
import { toast } from "../ui/toast.js";

export function initLivePage() {
  const button = document.getElementById("livePollNowBtn");
  const status = document.getElementById("liveStatus");
  if (!button) return;

  async function poll() {
    try {
      const data = await fetchLobbyJson();
      status.textContent = `Last checked: ${new Date().toLocaleTimeString()} · ${data.matches?.length || 0} lobbies`;
    } catch (err) {
      console.error(err);
      toast("Failed to read lobby.json", "err");
    }
  }

  button.addEventListener("click", poll);
}
