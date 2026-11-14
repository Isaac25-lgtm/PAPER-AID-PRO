import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from "@firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, ApiError, beginSession, SESSION_CHANGED, setConsentRequiredHandler, setTokenGetter } from "./api";
import { auth } from "./firebase";
import type { User } from "./types";

interface AuthState {
  firebaseUser: FirebaseUser | null;
  user: User | null;
  loading: boolean;
  notInvited: boolean;
  /** This email already belongs to an account created with a different sign-in (API 409 ACCOUNT_CONFLICT). */
  accountConflict: boolean;
  /** The profile could not be loaded (transient); the guard offers a retry when no profile is loaded yet. */
  profileError: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  resendVerification(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** How long a request waits for sign-in to be restored, or for a fresh token, before failing (never anonymously). */
export const AUTH_WAIT_MS = 15_000;

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(0, "AUTH_TIMEOUT", message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The token for a request, bound to the identity that was signed in when the request asked for it.
 * - Waits (bounded) until Firebase has restored a saved session, so a page opened directly is not fetched
 *   anonymously and shown signed out (found in the staging run). If that never settles, the request fails rather
 *   than going out anonymously.
 * - If the account changes or signs out while the token is being fetched, the request is refused instead of
 *   being sent with the previous account's token (staging audit).
 */
export async function currentToken(): Promise<string | null> {
  if (auth.authStateReady) {
    await within(auth.authStateReady(), AUTH_WAIT_MS, "Sign-in is taking longer than usual. Reload the page to try again.");
  }
  const user = auth.currentUser;
  if (!user) return null;
  const token = await within(user.getIdToken(), AUTH_WAIT_MS, "Could not refresh your sign-in. Check your connection and try again.");
  if (auth.currentUser?.uid !== user.uid) {
    throw new ApiError(0, SESSION_CHANGED, "Your sign-in changed while this was running, so it was stopped. Nothing from the previous account was kept.");
  }
  return token;
}
setTokenGetter(currentToken);

const FRIENDLY: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Use a password of at least 8 characters.",
  "auth/password-does-not-meet-requirements": "Use at least 8 characters with upper and lower case letters and a number.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/network-request-failed": "Network error. Check your connection.",
};

export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  return FRIENDLY[code] ?? (error instanceof Error ? error.message : "Authentication failed.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInvited, setNotInvited] = useState(false);
  const [accountConflict, setAccountConflict] = useState(false);
  const [profileError, setProfileError] = useState(false);
  // The identity whose data is in the cache, and a counter that lets late /me responses be discarded.
  const cachedUid = useRef<string | null | undefined>(undefined);
  const profileRequest = useRef(0);

  const loadProfile = useCallback(async () => {
    const request = ++profileRequest.current;
    const uid = auth.currentUser?.uid ?? null;
    const current = () => request === profileRequest.current && (auth.currentUser?.uid ?? null) === uid;
    setNotInvited(false);
    setAccountConflict(false);
    setProfileError(false);
    if (!uid) {
      setUser(null);
      return;
    }
    try {
      const profile = await api.get<User>("/me");
      if (current()) setUser(profile);
    } catch (error) {
      if (!current()) return; // a newer sign-in state owns the UI now
      const code = error instanceof ApiError ? error.code : "";
      if (code === "NOT_INVITED" || code === "ACCOUNT_CONFLICT") {
        setUser(null);
        setNotInvited(code === "NOT_INVITED");
        setAccountConflict(code === "ACCOUNT_CONFLICT");
        return;
      }
      // A transient failure (network, server) must not tear down the page someone is working in: keep the
      // profile already loaded and report the problem; with no profile yet, the guard offers a retry.
      setProfileError(true);
    }
  }, []);

  // If the policy changes while the app is open, the next API call says so: reload the profile (which then shows
  // the consent screen) instead of leaving pages half-loaded with errors. Throttled to one reload at a time.
  const consentReload = useRef(false);
  useEffect(() => {
    setConsentRequiredHandler(() => {
      if (consentReload.current) return;
      consentReload.current = true;
      void loadProfile().finally(() => {
        consentReload.current = false;
      });
    });
    return () => setConsentRequiredHandler(() => undefined);
  }, [loadProfile]);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (next) => {
        const uid = next?.uid ?? null;
        if (cachedUid.current !== undefined && cachedUid.current !== uid) {
          // Signed out or a different account (possibly in another tab): no private data may outlive it, and no
          // request started for the previous account may complete into this one.
          beginSession();
          queryClient.clear();
          setUser(null);
        }
        cachedUid.current = uid;
        setFirebaseUser(next);
        await loadProfile();
        setLoading(false);
      }),
    [loadProfile, queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      firebaseUser,
      user,
      loading,
      notInvited,
      accountConflict,
      profileError,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUp(name, email, password) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user);
        await credential.user.getIdToken(true);
        await loadProfile();
        if (name.trim()) await api.patch("/me", { name: name.trim() }).catch(() => undefined);
      },
      async signInWithGoogle() {
        await signInWithPopup(auth, new GoogleAuthProvider());
      },
      async signOut() {
        await firebaseSignOut(auth);
        queryClient.clear();
        setUser(null);
      },
      async resendVerification() {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      async refresh() {
        if (auth.currentUser) {
          await auth.currentUser.reload();
          await auth.currentUser.getIdToken(true);
          setFirebaseUser(auth.currentUser);
        }
        await loadProfile();
      },
    }),
    [firebaseUser, user, loading, notInvited, accountConflict, loadProfile, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
