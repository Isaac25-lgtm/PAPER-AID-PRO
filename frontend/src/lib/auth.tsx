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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError, setTokenGetter } from "./api";
import { auth } from "./firebase";
import type { User } from "./types";

interface AuthState {
  firebaseUser: FirebaseUser | null;
  user: User | null;
  loading: boolean;
  notInvited: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  resendVerification(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

setTokenGetter(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));

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

  const loadProfile = useCallback(async () => {
    setNotInvited(false);
    if (!auth.currentUser) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.get<User>("/me"));
    } catch (error) {
      setUser(null);
      if (error instanceof ApiError && error.code === "NOT_INVITED") setNotInvited(true);
    }
  }, []);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (next) => {
        setFirebaseUser(next);
        await loadProfile();
        setLoading(false);
      }),
    [loadProfile],
  );

  const value = useMemo<AuthState>(
    () => ({
      firebaseUser,
      user,
      loading,
      notInvited,
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
    [firebaseUser, user, loading, notInvited, loadProfile, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
