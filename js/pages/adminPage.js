import { DEFAULT_ADMIN_PASS, LOCAL_SANDBOX } from "../core/config.js";
import { toast } from "../ui/toast.js";

export function initAdminPage() {
  const unlock = document.getElementById("adminUnlockBtn");
  const lock = document.getElementById("adminLockBtn");
  const password = document.getElementById("adminPass");
  const error = document.getElementById("adminError");
  const login = document.getElementById("adminLogin");
  const tools = document.getElementById("adminTools");
  if (!unlock) return;

  unlock.addEventListener("click", () => {
    if (password?.value !== DEFAULT_ADMIN_PASS) {
      if (error) error.hidden = false;
      return;
    }

    if (error) error.hidden = true;
    login.hidden = true;
    tools.hidden = false;
    toast(
      LOCAL_SANDBOX
        ? "Admin preview unlocked locally"
        : "Admin preview unlocked: write tools are disabled"
    );
  });

  password?.addEventListener("input", () => {
    if (error) error.hidden = true;
  });

  lock?.addEventListener("click", () => {
    tools.hidden = true;
    login.hidden = false;
    if (password) password.value = "";
  });

  [
    "openBulkSeederBtn",
    "removeDupesBtn",
    "recalcAllBtn",
    "runImportBtn",
    "fullResetBtn",
    "addPlayerBtn"
  ].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = true;
    button.title = "Not yet ported from the original single-file application.";
  });
}
