import { toast } from "./toast.js";

const THEME_STORAGE_KEY = "lotr-theme";
const THEMES = {
  dark: {
    label: "Dark",
    description: "Use the dark color theme"
  },
  light: {
    label: "Light",
    description: "Use the light color theme"
  }
};

export function initThemeToggle() {
  const topbar = document.querySelector(".topbar");
  if (!topbar || document.getElementById("themeToggleBtn")) return;

  const button = document.createElement("button");
  button.id = "themeToggleBtn";
  button.className = "theme-toggle-button";
  button.type = "button";

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const preferredTheme = window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
  let theme = THEMES[savedTheme] ? savedTheme : preferredTheme;

  button.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme, button);
    toast(`${THEMES[theme].label} theme enabled`);
  });

  const sync = document.getElementById("sync");
  topbar.insertBefore(button, sync || null);
  applyTheme(theme, button, false);
}

function applyTheme(theme, button, notify = true) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  button.innerHTML = `
    <span class="theme-toggle-label">Theme</span>
    <strong>${THEMES[theme].label}</strong>
  `;

  const nextTheme = theme === "dark" ? "light" : "dark";
  button.title = `${THEMES[theme].description}. Click to switch to ${THEMES[nextTheme].label.toLowerCase()} mode.`;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(theme === "light"));

  if (notify) {
    window.dispatchEvent(new CustomEvent("lotr:themeChanged", {
      detail: { theme }
    }));
  }
}
