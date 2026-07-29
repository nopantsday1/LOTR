import { LOCAL_SANDBOX } from "../core/config.js";
import { state } from "../core/state.js";
import { firestoreApi as fb } from "./firebase.js";
import { toast } from "../ui/toast.js";
import { initializeRatingModes } from "../elo/ratingModes.js";

export function subscribeCoreData(onChange) {
  const playersRef = fb.collection(state.db, "players");
  const historyRef = fb.collection(state.db, "history");
  const predictionsRef = fb.collection(state.db, "predictionResponses");
  let sourcePlayers = [];
  let playersLoaded = false;
  let fullHistoryLoaded = false;

  function publishRatingDatasets() {
    if (!playersLoaded || !fullHistoryLoaded) return;
    initializeRatingModes(sourcePlayers, state.fullHistory);
    onChange?.();
  }

  const unsubPlayers = fb.onSnapshot(playersRef, snap => {
    sourcePlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    playersLoaded = true;
    publishRatingDatasets();
  });

  const unsubHistory = fb.onSnapshot(
    fb.query(historyRef, fb.orderBy("timestamp", "desc"), fb.limit(100)),
    snap => {
      state.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (playersLoaded && fullHistoryLoaded) onChange?.();
    }
  );

  const unsubFullHistory = fb.onSnapshot(
    fb.query(historyRef, fb.orderBy("timestamp", "desc")),
    snap => {
      state.fullHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      fullHistoryLoaded = true;
      publishRatingDatasets();
    }
  );

  // Each response is deliberately kept as an immutable document. That makes
  // the community total live across browsers without trusting a client-side
  // counter.
  const unsubPredictions = fb.onSnapshot(
    predictionsRef,
    snap => {
      state.communityPredictions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      onChange?.();
    },
    error => {
      // The rest of the app can still use players and match history if the
      // optional community-prediction collection has not been allowed yet.
      console.warn("Community predictions are unavailable:", error.code);
    }
  );

  return () => {
    unsubPlayers();
    unsubHistory();
    unsubFullHistory();
    unsubPredictions();
  };
}

export async function safeSetDoc(...args) {
  if (LOCAL_SANDBOX) {
    console.warn("[SANDBOX] blocked setDoc", args);
    toast("Sandbox: blocked Firebase write");
    return;
  }
  return fb.setDoc(...args);
}

export async function safeUpdateDoc(...args) {
  if (LOCAL_SANDBOX) {
    console.warn("[SANDBOX] blocked updateDoc", args);
    toast("Sandbox: blocked Firebase write");
    return;
  }
  return fb.updateDoc(...args);
}

export async function safeAddDoc(...args) {
  if (LOCAL_SANDBOX) {
    console.warn("[SANDBOX] blocked addDoc", args);
    toast("Sandbox: blocked Firebase write");
    return { id: `local-${Date.now()}` };
  }
  return fb.addDoc(...args);
}

export async function safeDeleteDoc(...args) {
  if (LOCAL_SANDBOX) {
    console.warn("[SANDBOX] blocked deleteDoc", args);
    toast("Sandbox: blocked Firebase write");
    return;
  }
  return fb.deleteDoc(...args);
}
