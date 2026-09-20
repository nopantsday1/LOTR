// Firestore write wrappers that honour the read-only local sandbox.
//
// These live apart from firestore.js so that modules performing writes
// (matchOverrides, adminService) do not have to import the subscription layer,
// which in turn imports them. firestore.js re-exports everything here for
// backwards compatibility with existing call sites.

import { LOCAL_SANDBOX } from "../core/config.js";
import { firestoreApi as fb } from "./firebase.js";
import { toast } from "../ui/toast.js";

function blocked(label, args) {
  console.warn(`[SANDBOX] blocked ${label}`, args);
  toast("Sandbox: blocked Firebase write");
}

export async function safeSetDoc(...args) {
  if (LOCAL_SANDBOX) return blocked("setDoc", args);
  return fb.setDoc(...args);
}

export async function safeUpdateDoc(...args) {
  if (LOCAL_SANDBOX) return blocked("updateDoc", args);
  return fb.updateDoc(...args);
}

export async function safeAddDoc(...args) {
  if (LOCAL_SANDBOX) {
    blocked("addDoc", args);
    return { id: `local-${Date.now()}` };
  }
  return fb.addDoc(...args);
}

export async function safeDeleteDoc(...args) {
  if (LOCAL_SANDBOX) return blocked("deleteDoc", args);
  return fb.deleteDoc(...args);
}
