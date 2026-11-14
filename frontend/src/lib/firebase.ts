import { initializeApp } from "@firebase/app";
import { browserLocalPersistence, browserPopupRedirectResolver, initializeAuth } from "@firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

// The persistence is chosen when Auth is created, not changed afterwards: Firebase registers its cross-tab listener
// on the persistence it starts with, and `setPersistence()` later does not move it. Calling `getAuth()` (IndexedDB)
// and then `setPersistence(local)` left every tab deaf to sign-outs and account switches in other tabs; a tab kept
// acting as the previous account (found in the staging account-switch check). localStorage keeps existing sessions.
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
