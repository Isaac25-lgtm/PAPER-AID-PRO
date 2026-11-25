import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui";
import { handOver, peekHandover } from "@/lib/handover";

// ----------------------------------------------------------------------------- Firebase + API test doubles
type Listener = (user: { uid: string } | null) => Promise<void> | void;
const firebase = vi.hoisted(() => ({
  listener: null as Listener | null,
  currentUser: null as { uid: string; getIdToken?: () => Promise<string> } | null,
  ready: Promise.resolve() as Promise<void>,
}));
vi.mock("@firebase/auth", () => ({
  onIdTokenChanged: (_auth: unknown, cb: Listener) => {
    firebase.listener = cb;
    return () => undefined;
  },
  createUserWithEmailAndPassword: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({
  auth: {
    get currentUser() {
      return firebase.currentUser;
    },
    authStateReady: () => firebase.ready,
  },
}));
const meResponses = vi.hoisted(() => ({ queue: [] as { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  setTokenGetter: vi.fn(),
  setConsentRequiredHandler: vi.fn(),
  api: {
    get: () => new Promise((resolve, reject) => meResponses.queue.push({ resolve, reject })),
    patch: vi.fn(),
  },
}));

const { AuthProvider, useAuth } = await import("@/lib/auth");
const { ApiError, setConsentRequiredHandler, setTokenGetter } = await import("@/lib/api");
const tokenGetter = vi.mocked(setTokenGetter).mock.calls[0]![0] as () => Promise<string | null>;

describe("request tokens", () => {
  it("waits for a saved session to be restored before deciding a request is anonymous", async () => {
    // A paper page opened directly used to be fetched anonymously and showed "Save to library" for a saved paper.
    let restore: () => void = () => undefined;
    firebase.ready = new Promise<void>((resolve) => (restore = resolve));
    firebase.currentUser = null;
    const token = tokenGetter();
    firebase.currentUser = { uid: "u1", getIdToken: async () => "restored-token" };
    restore();
    await expect(token).resolves.toBe("restored-token");
    firebase.ready = Promise.resolve();
    firebase.currentUser = null;
    await expect(tokenGetter()).resolves.toBeNull();
  });

  it("refuses A's token when B is signed in by the time it arrives (staging audit)", async () => {
    let finish: ((t: string) => void) | null = null;
    firebase.currentUser = { uid: "A", getIdToken: () => new Promise((resolve) => (finish = resolve)) };
    const token = tokenGetter();
    await vi.waitFor(() => expect(finish).not.toBeNull()); // A's token is being fetched
    firebase.currentUser = { uid: "B", getIdToken: async () => "token-of-B" };
    finish!("token-of-A");
    await expect(token).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    firebase.currentUser = null;
  });

  it("refuses the token when the person signs out during a token refresh", async () => {
    let finish: ((t: string) => void) | null = null;
    firebase.currentUser = { uid: "A", getIdToken: () => new Promise((resolve) => (finish = resolve)) };
    const token = tokenGetter();
    await vi.waitFor(() => expect(finish).not.toBeNull()); // A's token is being fetched
    firebase.currentUser = null;
    finish!("token-of-A");
    await expect(token).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  });

  it("fails (never goes out anonymously) when sign-in restoration stalls", async () => {
    vi.useFakeTimers();
    try {
      firebase.ready = new Promise<void>(() => undefined); // never settles
      firebase.currentUser = null;
      const token = tokenGetter().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await token).toMatchObject({ code: "AUTH_TIMEOUT" });
    } finally {
      vi.useRealTimers();
      firebase.ready = Promise.resolve();
    }
  });
});

function Who() {
  const { user, accountConflict, profileError } = useAuth();
  return (
    <>
      <p>{accountConflict ? "conflict" : user ? `signed in as ${user.email}` : "nobody"}</p>
      <p>{profileError ? "profile error" : "profile ok"}</p>
    </>
  );
}

function setup() {
  const client = new QueryClient();
  client.setQueryData(["library", null, null], [{ paper: { id: "private-paper" } }]);
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Who />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

async function signInAs(uid: string | null) {
  firebase.currentUser = uid ? { uid } : null;
  await act(async () => {
    void firebase.listener?.(firebase.currentUser);
    await Promise.resolve();
  });
}

describe("AuthProvider", () => {
  beforeEach(() => {
    meResponses.queue.length = 0;
    firebase.currentUser = null;
    firebase.listener = null;
  });

  it("clears cached private data when the Firebase identity changes (e.g. in another tab)", async () => {
    const client = setup();
    await signInAs("alice");
    await act(async () => meResponses.queue.shift()!.resolve({ email: "alice@example.edu" }));
    expect(await screen.findByText("signed in as alice@example.edu")).toBeInTheDocument();
    expect(client.getQueryData(["library", null, null])).toBeDefined();

    handOver("alice", "ask", { question: "Alice's unsaved question", paperIds: ["p1"] });
    await signInAs("bob"); // a different account signed in elsewhere
    expect(client.getQueryData(["library", null, null])).toBeUndefined();
    expect(peekHandover("alice", "ask")).toBeNull(); // an unsaved research question is dropped too (audit SF02)
    expect(screen.getByText("nobody")).toBeInTheDocument();

    client.setQueryData(["library", null, null], [{ paper: { id: "bob-paper" } }]);
    await signInAs(null); // signed out in another tab
    expect(client.getQueryData(["library", null, null])).toBeUndefined();
  });

  it("ignores a late profile response that belongs to a previous identity", async () => {
    setup();
    await signInAs("alice");
    const aliceRequest = meResponses.queue.shift()!;
    await signInAs("bob");
    const bobRequest = meResponses.queue.shift()!;
    await act(async () => bobRequest.resolve({ email: "bob@example.edu" }));
    await act(async () => aliceRequest.resolve({ email: "alice@example.edu" })); // arrives last
    await waitFor(() => expect(screen.getByText("signed in as bob@example.edu")).toBeInTheDocument());
  });

  it("retries a failed policy reload (bounded), then reports it, and recovers on the next successful reload", async () => {
    // Workspace audit: a failed /me after CONSENT_REQUIRED kept the old profile but hid the error, so parked
    // autosave waited for a consent screen that never came.
    setup();
    await signInAs("alice");
    await act(async () => meResponses.queue.shift()!.resolve({ email: "alice@example.edu", needs_consent: false }));
    const onConsentRequired = vi.mocked(setConsentRequiredHandler).mock.calls.at(-1)![0];
    vi.useFakeTimers();
    try {
      act(() => onConsentRequired());
      for (let attempt = 0; attempt < 3; attempt++) {
        await act(async () => meResponses.queue.shift()!.reject(new ApiError(503, "HTTP_ERROR", "Service unavailable")));
        await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      }
      expect(meResponses.queue).toHaveLength(0); // three attempts, then it stops
      expect(screen.getByText("profile error")).toBeInTheDocument(); // visible to the guard's retry banner
      expect(screen.getByText("signed in as alice@example.edu")).toBeInTheDocument(); // the page is kept
    } finally {
      vi.useRealTimers();
    }
    act(() => onConsentRequired()); // e.g. the person presses Try again or another request asks again
    await act(async () => meResponses.queue.shift()!.resolve({ email: "alice@example.edu", needs_consent: true }));
    expect(screen.getByText("profile ok")).toBeInTheDocument();
  });

  it("surfaces an account conflict instead of signing in", async () => {
    setup();
    await signInAs("new-uid");
    await act(async () =>
      meResponses.queue.shift()!.reject(new ApiError(409, "ACCOUNT_CONFLICT", "This email is already linked.")),
    );
    expect(await screen.findByText("conflict")).toBeInTheDocument();
  });
});

describe("Modal", () => {
  it("moves focus inside, keeps Tab within the dialog and restores focus on close", async () => {
    const { rerender } = render(
      <>
        <button>opener</button>
        <Modal open={false} onClose={() => undefined} title="Dialog">
          <input aria-label="first field" />
          <button>last action</button>
        </Modal>
      </>,
    );
    const opener = screen.getByText("opener");
    opener.focus();
    const ui = (open: boolean) => (
      <>
        <button>opener</button>
        <Modal open={open} onClose={() => undefined} title="Dialog">
          <input aria-label="first field" />
          <button>last action</button>
        </Modal>
      </>
    );
    rerender(ui(true));
    expect(screen.getByLabelText("first field")).toHaveFocus();
    screen.getByText("last action").focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(screen.getByLabelText("Close")).toHaveFocus(); // wrapped to the first control (Close)
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(screen.getByText("last action")).toHaveFocus();
    rerender(ui(false));
    expect(screen.getByText("opener")).toHaveFocus();
  });
});
