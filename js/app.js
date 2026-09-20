import { initFirebase } from "./data/firebase.js";
import { subscribeCoreData } from "./data/firestore.js";
import { LOCAL_SANDBOX } from "./core/config.js";
import { initNavigation } from "./ui/nav.js";
import { initRatingModeToggle } from "./ui/ratingModeToggle.js";
import { initThemeToggle } from "./ui/themeToggle.js";
import { toast } from "./ui/toast.js";
import { startAutoMatchImport } from "./services/matchImportService.js";

import { loadLocalData } from "./data/localData.js";
import {
  fetchPrecomputedRatings,
  primeFromPrecomputed
} from "./data/precomputedRatings.js";

// Page modules are imported dynamically so a page only pays for its own code.
// Importing all eight statically meant every page downloaded and parsed the
// others -- the History page was pulling in statsPage.js (40KB), profilePage,
// balancePage and adminPage for nothing, about 2s of module loading.
const PAGE_MODULES = {
  balance: () => import("./pages/balancePage.js").then(m => m.initBalancePage),
  history: () => import("./pages/historyPage.js").then(m => m.initHistoryPage),
  players: () => import("./pages/playersPage.js").then(m => m.initPlayersPage),
  stats: () => import("./pages/statsPage.js").then(m => m.initStatsPage),
  admin: () => import("./pages/adminPage.js").then(m => m.initAdminPage),
  profile: () => import("./pages/profilePage.js").then(m => m.initProfilePage),
  predictions: () =>
    import("./pages/predictionsPage.js").then(m => m.initPredictionsPage)
};

// Which pages actually need match history.
//
// A full page load reads ~1,275 Firestore documents; the free tier allows
// 50,000 a day. Pages that only show the ladder read the 89 player documents
// and take ratings from ratings.json instead, cutting their cost by ~93%.
// Anything that renders individual matches still needs the history collection.
const HISTORY_PAGES = new Set([
  "history",
  "stats",
  "profile",
  "predictions",
  "admin"
]);

function needsHistory(page) {
  return HISTORY_PAGES.has(page);
}

function emitDataChanged() {
  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));
}

// Prediction responses only affect the Stats page, so they get their own event
// rather than making every page rebuild its ratings.
function emitPredictionsChanged() {
  window.dispatchEvent(new CustomEvent("lotr:predictionsChanged"));
}

async function initCurrentPage() {
  initNavigation();
  initRatingModeToggle();
  initThemeToggle();

  const page = document.querySelector("main .page[data-page]")?.dataset.page;
  const loadPage = PAGE_MODULES[page];
  if (!loadPage) return;

  try {
    const init = await loadPage();
    init?.();
  } catch (err) {
    console.error(`Failed to load the "${page}" page module`, err);
    toast("This page failed to load", "err");
  }
}

async function main() {
  // Awaited before any data subscription starts: page modules register their
  // lotr:dataChanged listeners here, and a late listener would miss the first
  // snapshot and render nothing.
  await initCurrentPage();

  try {
    if (LOCAL_SANDBOX) {
      await loadLocalData();
      toast("Loaded local JSON data");
      return;
    }

    // Awaited, because whether history is fetched at all depends on having a
    // usable ratings.json. It is one small static file, so the wait is short and
    // it doubles as the first paint.
    const precomputed = await fetchPrecomputedRatings();
    if (precomputed) primeFromPrecomputed(precomputed);

    const page = document.querySelector("main .page[data-page]")?.dataset.page;
    // Without a usable file there is nothing to derive ratings from, so fall
    // back to fetching history and replaying, exactly as before.
    const includeHistory = needsHistory(page) || !precomputed;

    initFirebase();
    subscribeCoreData(emitDataChanged, emitPredictionsChanged, {
      includeHistory,
      precomputedModes: precomputed?.modes || null
    });

    // The importer reads and writes match history, so it only belongs on pages
    // that already carry that cost.
    if (includeHistory) startAutoMatchImport();
  } catch (err) {
    console.error(err);
    toast(
      LOCAL_SANDBOX
        ? "Could not load local JSON data"
        : "Firebase failed to initialize",
      "err"
    );
  }
}

main();
