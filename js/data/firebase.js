import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
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
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { FIREBASE_CONFIG } from "../core/config.js";
import { state } from "../core/state.js";

export const firestoreApi = {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection,
  addDoc, getDocs, deleteDoc, query, orderBy, limit,
  writeBatch, runTransaction, increment,
};

export const authApi = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
};

export function initFirebase() {
  const app = initializeApp(FIREBASE_CONFIG);
  state.db = getFirestore(app);
  state.auth = getAuth(app);
  return { app, db: state.db, auth: state.auth };
}
