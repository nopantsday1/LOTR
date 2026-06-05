export function fmtDuration(seconds) {
  if (!seconds) return "—";

  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  }

  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function byName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""));
}
