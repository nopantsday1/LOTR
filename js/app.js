import { initFirebase } from "./data/firebase.js";
import { subscribeCoreData } from "./data/firestore.js";
import { LOCAL_SANDBOX } from "./core/config.js";
import { initNavigation } from "./ui/nav.js";
import { initRatingModeToggle } from "./ui/ratingModeToggle.js";
import { initThemeToggle } from "./ui/themeToggle.js";
import { toast } from "./ui/toast.js";
import { startAutoMatchImport } from "./services/matchImportService.js";

import { loadLocalData } from "./data/localData.js";

import { initBalancePage } from "./pages/balancePage.js";
import { initHistoryPage } from "./pages/historyPage.js";
import { initPlayersPage } from "./pages/playersPage.js";
import { initStatsPage } from "./pages/statsPage.js";
import { initAdminPage } from "./pages/adminPage.js";
import { initLivePage } from "./pages/livePage.js";
import { initProfilePage } from "./pages/profilePage.js";
import { initPredictionsPage } from "./pages/predictionsPage.js";

function emitDataChanged() {
  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));
}

function initCurrentPage() {
  initNavigation();
  initRatingModeToggle();
  initThemeToggle();

  const page = document.querySelector("main .page[data-page]")?.dataset.page;

  const pageInitializers = {
    balance: initBalancePage,
    history: initHistoryPage,
    players: initPlayersPage,
    stats: initStatsPage,
    admin: initAdminPage,
    live: initLivePage,
    profile: initProfilePage,
    predictions: initPredictionsPage,
  };

  pageInitializers[page]?.();
}

async function main() {
  initCurrentPage();

  try {
    if (LOCAL_SANDBOX) {
      await loadLocalData();
      toast("Loaded local JSON data");
      return;
    }

    initFirebase();
    subscribeCoreData(emitDataChanged);
    startAutoMatchImport();
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
