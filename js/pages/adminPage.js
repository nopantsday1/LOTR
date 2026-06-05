import { LOCAL_SANDBOX } from "../core/config.js";
import { toast } from "../ui/toast.js";

export function initAdminPage() {
  const unlock = document.getElementById("adminUnlockBtn");
  const login = document.getElementById("adminLogin");
  const tools = document.getElementById("adminTools");
  if (!unlock) return;

  unlock.addEventListener("click", () => {
    login.hidden = true;
    tools.hidden = false;
    toast(LOCAL_SANDBOX ? "Admin unlocked locally: Firebase writes are blocked" : "Admin unlocked");
  });

  document.getElementById("recalcAllBtn")?.addEventListener("click", () => {
    toast("Move original recalcAllElos() logic into js/pages/adminPage.js or js/elo/recalculate.js");
  });
}
