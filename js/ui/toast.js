export function toast(message, type = "ok") {
  const el = document.getElementById("toast");
  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("on");

  setTimeout(() => el.classList.remove("on"), 2800);
}

export function syncStatus(status) {
  const el = document.getElementById("sync");
  if (!el) return;
  el.className = `sync ${status}`;
}
