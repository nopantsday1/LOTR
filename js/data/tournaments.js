// Firestore access for the `tournaments` collection.
//
// The collection is tiny (a handful of documents a year), so the listener reads
// all of it. It is only opened on the two tournament pages.

import { LOCAL_SANDBOX } from "../core/config.js";
import { state } from "../core/state.js";
import {
  TOURNAMENT_COLLECTION,
  normalizeTournament
} from "../core/tournaments.js";
import { firestoreApi as fb } from "./firebase.js";
import { safeAddDoc, safeDeleteDoc, safeSetDoc } from "./writes.js";

// app.js creates the Firestore instance after page modules initialise, and
// announces it with this event.
function whenDbReady() {
  if (state.db) return Promise.resolve(state.db);
  return new Promise(resolve => {
    window.addEventListener("lotr:dbReady", () => resolve(state.db), {
      once: true
    });
  });
}

// Calls onChange(list) with every tournament, or onError(error). In the local
// sandbox there is no database, so it reports an empty list.
export function subscribeTournaments(onChange, onError) {
  if (LOCAL_SANDBOX) {
    queueMicrotask(() => onChange([]));
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  whenDbReady().then(db => {
    if (cancelled) return;
    unsubscribe = fb.onSnapshot(
      fb.collection(db, TOURNAMENT_COLLECTION),
      snap => {
        const list = snap.docs.map(d => {
          const data = d.data();
          const { tournament } = normalizeTournament(data);
          return {
            id: d.id,
            ...tournament,
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0
          };
        });
        onChange(list);
      },
      error => {
        console.warn("[tournaments]", error?.code || error);
        onError?.(error);
      }
    );
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

// Creates when `id` is empty, otherwise replaces that document.
export async function saveTournament(id, input, previous) {
  const { tournament, errors } = normalizeTournament(input);
  if (errors.length) throw new Error(errors.join(" "));

  const now = Date.now();
  const data = {
    ...tournament,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };

  if (id) {
    await safeSetDoc(fb.doc(state.db, TOURNAMENT_COLLECTION, id), data);
    return id;
  }
  const ref = await safeAddDoc(fb.collection(state.db, TOURNAMENT_COLLECTION), data);
  return ref?.id;
}

export async function deleteTournament(id) {
  if (!id) return;
  await safeDeleteDoc(fb.doc(state.db, TOURNAMENT_COLLECTION, id));
}

export function describeTournamentError(error) {
  if (error?.code === "permission-denied") {
    return (
      "Firestore refused this. Publish the updated docs/firestore.rules " +
      "(it adds the tournaments collection) and make sure you are signed in."
    );
  }
  return error?.message || "Something went wrong.";
}
