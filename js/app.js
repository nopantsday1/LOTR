import { initFirebase } from "./data/firebase.js";
import { subscribeCoreData } from "./data/firestore.js";
import { loadSandboxSnapshot, saveSandboxSnapshot } from "./data/localSandbox.js";
import { LOCAL_SANDBOX } from "./core/config.js";
import { initNavigation } from "./ui/nav.js";
import { toast } from "./ui/toast.js";

import { loadLocalData } from "./data/localData.js";

import { initBalancePage } from "./pages/balancePage.js";
import { initHistoryPage } from "./pages/historyPage.js";
import { initPlayersPage } from "./pages/playersPage.js";
import { initLeaderboardPage } from "./pages/leaderboardPage.js";
import { initStatsPage } from "./pages/statsPage.js";
import { initAdminPage } from "./pages/adminPage.js";
import { initLivePage } from "./pages/livePage.js";
import { initProfilePage } from "./pages/profilePage.js";

function emitDataChanged() {
  window.dispatchEvent(new CustomEvent("lotr:dataChanged"));
}

function initCurrentPage() {
  initNavigation();

  const page = document.querySelector("main .page[data-page]")?.dataset.page;

  const pageInitializers = {
    balance: initBalancePage,
    history: initHistoryPage,
    players: initPlayersPage,
    leaderboard: initLeaderboardPage,
    stats: initStatsPage,
    admin: initAdminPage,
    live: initLivePage,
    profile: initProfilePage,
  };

  pageInitializers[page]?.();
}

// For production with Firebase, subscribe to live updates and optionally save a local snapshot for development
// async function main() {
//   initCurrentPage();

//   try {
//     initFirebase();

//     if (LOCAL_SANDBOX && loadSandboxSnapshot()) {
//       emitDataChanged();
//       toast("Loaded local sandbox snapshot");
//     }

//     subscribeCoreData(() => {
//       if (LOCAL_SANDBOX) saveSandboxSnapshot();
//       emitDataChanged();
//     });
//   } catch (err) {
//     console.error(err);
//     toast("Firebase failed to initialize. Static UI still loaded.", "err");
//   }
// }

// For local development without Firebase, load data from a static JSON file instead
async function main() {
  initCurrentPage();

  try {
    await loadLocalData();
    toast("Loaded local JSON data");
  } catch (err) {
    console.error(err);
    toast("Could not load local JSON data", "err");
  }
}

main();
