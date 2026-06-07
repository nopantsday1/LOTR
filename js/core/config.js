// Firebase is the default in development too. Add ?localSandbox=1 to the URL
// only when an isolated, read-only local JSON session is intentionally needed.
export const LOCAL_SANDBOX =
  new URLSearchParams(location.search).get("localSandbox") === "1";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDDrsJEQ0OOESWLYmyNJWGaWhFAm0fDUVg",
  authDomain: "lotr-9a2f2.firebaseapp.com",
  projectId: "lotr-9a2f2",
  storageBucket: "lotr-9a2f2.firebasestorage.app",
  messagingSenderId: "348198417891",
  appId: "1:348198417891:web:70334fb06dacf508ee1cd6"
};

export const DEFAULT_ADMIN_PASS = "admin123";
