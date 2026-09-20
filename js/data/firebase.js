import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../core/config.js";
import { state } from "../core/state.js";

export const firestoreApi = {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection,
  addDoc, getDocs, deleteDoc, query, orderBy, limit,
  writeBatch, runTransaction, increment,
};

// The Firebase Auth SDK is deliberately not imported. Nothing in the app signs
// in -- there is no authentication anywhere (see DEPLOYMENT.md) -- so loading it
// only cost every visitor an extra CDN download of a module that was never
// called. Restoring auth means re-adding the import here alongside the sign-in
// UI that actually uses it.

export function initFirebase() {
  const app = initializeApp(FIREBASE_CONFIG);
  state.db = createFirestore(app);
  return { app, db: state.db };
}

// This is a multi-page app: every tab click is a full page load that re-fetches
// players, the whole match history and the overrides. Measured cold, that wait
// was ~1.9s before any rating work could even start.
//
// The persistent cache keeps those documents in IndexedDB, so a repeat page load
// serves them locally and the listener fires almost immediately, then updates
// again if the server has newer data. The multi-tab manager is required because
// people do open the site in several tabs; without it the second tab fails to
// acquire the persistence lease.
//
// Persistence is unavailable in private windows and when storage is blocked, so
// a failure falls back to the in-memory default rather than breaking the app.
function createFirestore(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  } catch (err) {
    console.warn("Firestore persistence unavailable; using memory cache:", err?.code || err);
    return getFirestore(app);
  }
}
