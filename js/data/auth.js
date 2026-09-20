// Firebase Authentication for the admin panel.
//
// This replaces the old client-side password check, which compared typed input
// against a constant that shipped to every visitor. Any password the browser can
// verify is a password the browser has, so that check could only ever gate the
// UI -- and the database accepted writes from anyone regardless.
//
// With Auth, Google verifies the password server-side and hands back a signed
// token. Firestore rules can then require a real admin (`request.auth != null`),
// which is the first actual trust boundary this app has had.
//
// Accounts are managed in Firebase Console > Security > Authentication > Users, so
// only people with access to the project can create an admin, change a password
// or revoke access. Nothing about admin access lives in this repository.
//
// The Auth SDK is imported dynamically and only from here, so the other eight
// pages never download it.

import { FIREBASE_CONFIG } from "../core/config.js";
import { state } from "../core/state.js";

const AUTH_SDK = "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
const APP_SDK = "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

let authPromise = null;

async function getAuth() {
  if (authPromise) return authPromise;

  authPromise = (async () => {
    const [{ getApps, getApp, initializeApp }, auth] = await Promise.all([
      import(APP_SDK),
      import(AUTH_SDK)
    ]);
    // initFirebase() has usually already created the app; reuse it so there is
    // only ever one.
    const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
    return { api: auth, instance: auth.getAuth(app) };
  })();

  return authPromise;
}

export async function signInAdmin(email, password) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("Enter your admin email address");
  if (!password) throw new Error("Enter your password");

  const { api, instance } = await getAuth();
  try {
    const credential = await api.signInWithEmailAndPassword(
      instance,
      cleanEmail,
      password
    );
    state.currentUser = credential.user;
    return credential.user;
  } catch (error) {
    throw new Error(describeAuthError(error));
  }
}

export async function signOutAdmin() {
  const { api, instance } = await getAuth();
  await api.signOut(instance);
  state.currentUser = null;
}

// Calls back with the signed-in user, or null. Firebase restores a session from
// storage asynchronously, so this fires once on load with the restored state.
export async function observeAdmin(callback) {
  const { api, instance } = await getAuth();
  return api.onAuthStateChanged(instance, user => {
    state.currentUser = user || null;
    callback(user || null);
  });
}

export async function sendAdminPasswordReset(email) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("Enter your admin email address first");

  const { api, instance } = await getAuth();
  try {
    await api.sendPasswordResetEmail(instance, cleanEmail);
  } catch (error) {
    throw new Error(describeAuthError(error));
  }
}

// Firebase error codes are not user-facing. Note that recent versions collapse
// "wrong password" and "no such user" into invalid-credential on purpose, so the
// form cannot be used to discover which admin emails exist.
function describeAuthError(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password is not correct.";
    case "auth/invalid-email":
      return "That does not look like an email address.";
    case "auth/user-disabled":
      return "That admin account has been disabled in the Firebase Console.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Could not reach Firebase. Check your connection.";
    case "auth/operation-not-allowed":
      return (
        "Email/password sign-in is not enabled for this Firebase project. " +
        "Enable it in Firebase Console > Security > Authentication > Sign-in " +
        "method."
      );
    case "auth/unauthorized-domain":
      // Only reachable for email action links and OAuth redirects; plain
      // password sign-in does not check the authorized-domain list.
      return (
        "This domain is not authorised. Add it in Firebase Console > Security " +
        "> Authentication > Settings > Authorized domains."
      );
    default:
      // The API key can carry HTTP-referrer restrictions, which reject sign-in
      // from an origin that is not on its allow-list. The code is not stable
      // enough to switch on, so match the message.
      if (/requests-from-referer/i.test(error?.message || "")) {
        return (
          `This origin (${location.origin}) is blocked by the Firebase API ` +
          "key's HTTP referrer restrictions. Add it in Google Cloud Console > " +
          "APIs & Services > Credentials, or use an unrestricted key."
        );
      }
      return error?.message || "Sign in failed.";
  }
}
