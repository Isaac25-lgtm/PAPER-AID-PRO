import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui";

// ----------------------------------------------------------------------------- Firebase + API test doubles
type Listener = (user: { uid: string } | null) => Promise<void> | void;
const firebase = vi.hoisted(() => ({ listener: null as Listener | null, currentUser: null as { uid: string } | null }));
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
  },
}));
const meResponses = vi.hoisted(() => ({ queue: [] as { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  setTokenGetter: vi.fn(),
  api: {
    get: () => new Promise((resolve, reject) => meResponses.queue.push({ resolve, reject })),
    patch: vi.fn(),
  },
}));

const { AuthProvider, useAuth } = await import("@/lib/auth");
const { ApiError } = await import("@/lib/api");

function Who() {
  const { user, accountConflict } = useAuth();
  return <p>{accountConflict ? "conflict" : user ? `signed in as ${user.email}` : "nobody"}</p>;
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

    await signInAs("bob"); // a different account signed in elsewhere
    expect(client.getQueryData(["library", null, null])).toBeUndefined();
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
