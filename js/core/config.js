// Firebase is the default in development too. Add ?localSandbox=1 to the URL
// only when an isolated, read-only local JSON session is intentionally needed.
// Guarded so this module can also be imported by Node tooling
// (scripts/build-ratings.mjs), where there is no `location`.
export const LOCAL_SANDBOX =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("localSandbox") === "1";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDDrsJEQ0OOESWLYmyNJWGaWhFAm0fDUVg",
  authDomain: "lotr-9a2f2.firebaseapp.com",
  projectId: "lotr-9a2f2",
  storageBucket: "lotr-9a2f2.firebasestorage.app",
  messagingSenderId: "348198417891",
  appId: "1:348198417891:web:70334fb06dacf508ee1cd6"
};

// Admin access is Firebase Authentication; there is no password in this
// repository. Manage accounts in Firebase Console > Authentication > Users.
//
// The shared admin account. Set this and the sign-in form asks for a password
// only -- one common password for everyone, exactly like the old gate, except
// Firebase verifies it server-side instead of the browser comparing it against
// a constant every visitor can read.
//
// This address is a username, not a secret. Knowing it gains an attacker
// nothing: the password is never sent to the browser, and Firebase rate-limits
// repeated failures.
//
// It does not have to be a real mailbox. If it is not, reset the password from
// the Firebase Console rather than the "email me a reset link" button.
//
// Set to "" to show the email field instead, for per-person admin accounts.
export const ADMIN_EMAIL = "admin@lotr-9a2f2.web.app";

// Optional: URL of the deployed worker/lobby-proxy.js.
//
// Leave empty and everything works as it does today -- the Live and Balance
// pages read the committed lobby.json, which a scheduled job regenerates every
// ~5-15 minutes.
//
// Set it and the "check for a lobby" buttons fetch what is open *right now*.
// The browser cannot call the AoE2 API itself (it sends no CORS headers), and
// the free public CORS proxies are no longer usable: corsproxy.io now requires
// a paid API key and allorigins is down. A tiny Cloudflare Worker is the
// smallest thing that actually works. See worker/lobby-proxy.js.
//
// Example: "https://lotr-lobby-proxy.your-name.workers.dev"
export const LIVE_LOBBY_PROXY = "https://lotr-lobby-proxy.balo-malic.workers.dev";

