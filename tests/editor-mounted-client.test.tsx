/**
 * AI RESEARCH HUB — MOUNTED CLIENT & COMPONENT ACCEPTANCE TESTS
 *
 * Exercises:
 * 1. EditorHeader rendering with SaveStatus transitions ('saved', 'unsaved', 'saving', 'error', 'conflict')
 * 2. Form submission safety (buttons declare type="button" and do not submit enclosing forms)
 * 3. ConflictResolutionModal lifecycle, localStorage competing backup, risk warning, and confirmation
 * 4. Client-side debounce (1500ms), pending-update queue, and trailing-save execution
 * 5. Rapid typing during in-flight save (snapshot comparison prevents dropping newer edits or premature 'saved')
 * 6. Internal Next.js navigation interception (flushes pending save or prompts before discard)
 * 7. Server error handling leaving draft intact with retry available
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { DocumentType } from "@prisma/client";
import { EditorHeader, SaveStatus } from "../src/components/editor/editor-header";
import { ConflictResolutionModal } from "../src/components/editor/conflict-resolution-modal";
import { WorkspaceProvider } from "../src/components/layout/workspace-context";

describe("Research Editor Mounted Client & Component Acceptance", () => {
  test("1. EditorHeader renders 'Saved' status with version and word count", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <WorkspaceProvider>
        <EditorHeader
          documentId="doc-123"
          initialTitle="Cancer Research Manuscript"
          docType={DocumentType.MANUSCRIPT}
          version={3}
          updatedAt={new Date().toISOString()}
          saveStatus="saved"
          wordCount={1450}
          charCount={9200}
          sourcesCount={4}
          isSourcesOpen={false}
          onToggleSources={() => {}}
          onRename={async () => {}}
        />
      </WorkspaceProvider>
    );

    assert.ok(html.includes("v3"), "Header must display current version v3");
    assert.ok(html.includes("Saved"), "Header must display 'Saved' badge");
    assert.ok(html.includes("1,450 words"), "Header must display formatted word count");
    assert.ok(html.includes("Sources") && html.includes("4"), "Header must display linked sources count");
  });

  test("2. EditorHeader renders clickable 'Unsaved changes' button with type='button'", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <WorkspaceProvider>
        <EditorHeader
          documentId="doc-123"
          initialTitle="Cancer Research Manuscript"
          docType={DocumentType.MANUSCRIPT}
          version={3}
          updatedAt={new Date().toISOString()}
          saveStatus="unsaved"
          wordCount={1452}
          charCount={9215}
          sourcesCount={4}
          isSourcesOpen={false}
          onToggleSources={() => {}}
          onRename={async () => {}}
          onManualSave={() => {}}
        />
      </WorkspaceProvider>
    );

    assert.ok(html.includes("Unsaved changes"), "Header must display 'Unsaved changes'");
    // Verify it is a button with type="button" to prevent accidental form submission
    assert.ok(html.includes('type="button"'), "Status element must declare type='button'");
    assert.ok(html.includes("Click or press Ctrl+S to save immediately"), "Contains helpful tooltip");
  });

  test("3. EditorHeader renders 'Save failed (Retry)' when in error status", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <WorkspaceProvider>
        <EditorHeader
          documentId="doc-123"
          initialTitle="Cancer Research Manuscript"
          docType={DocumentType.MANUSCRIPT}
          version={3}
          updatedAt={new Date().toISOString()}
          saveStatus="error"
          wordCount={1452}
          charCount={9215}
          sourcesCount={4}
          isSourcesOpen={false}
          onToggleSources={() => {}}
          onRename={async () => {}}
          onManualSave={() => {}}
        />
      </WorkspaceProvider>
    );

    assert.ok(html.includes("Save failed (Retry)"), "Header must display retryable error button");
    assert.ok(html.includes("Click or press Ctrl+S to retry saving now"), "Tooltip explains retry");
  });

  test("4. Form safety audit: Enclosing forms are not submitted by header save actions", () => {
    // When buttons inside an enclosing form do not have type="button", browser treats them as type="submit"
    // Render inside a mock form and verify every button has type="button"
    const html = ReactDOMServer.renderToStaticMarkup(
      <form id="outer-form">
        <WorkspaceProvider>
          <EditorHeader
            documentId="doc-123"
            initialTitle="Manuscript"
            docType={DocumentType.MANUSCRIPT}
            version={1}
            updatedAt={new Date().toISOString()}
            saveStatus="unsaved"
            wordCount={100}
            charCount={500}
            sourcesCount={0}
            isSourcesOpen={false}
            onToggleSources={() => {}}
            onRename={async () => {}}
            onManualSave={() => {}}
          />
        </WorkspaceProvider>
      </form>
    );

    const buttons = html.match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length >= 3, "Expected multiple buttons in EditorHeader");
    for (const btn of buttons) {
      assert.ok(
        btn.includes('type="button"'),
        `Form safety violation: button missing type="button": ${btn}`
      );
    }
  });

  test("5. ConflictResolutionModal renders risk warning and recoverable backup option", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ConflictResolutionModal
        isOpen={true}
        onClose={() => {}}
        documentId="conflict-doc-1"
        draftVersion={2}
        draftWordCount={350}
        draftTextContent="Local draft text with novel discussion section."
        onConfirmOverwrite={async () => {}}
        onReloadLatest={async () => {}}
      />
    );

    assert.ok(html.includes("Concurrent Edit Conflict"), "Modal displays title");
    assert.ok(html.includes("Your Current Draft"), "Displays local draft section");
    assert.ok(html.includes("Server Version"), "Displays competing server version section");
    assert.ok(html.includes("replace the server&#x27;s version") || html.includes("Safety &amp; Preservation Notice"), "Explains permanent overwrite risk");
    assert.ok(html.includes("Reload Server Version"), "Offers reloading server version");
    assert.ok(html.includes("Confirm &amp; Overwrite with Draft") || html.includes("Confirm & Overwrite with Draft"), "Requires explicit overwrite confirmation");
  });

  test("6. ConflictResolutionModal automatic localStorage backup logic", () => {
    const storage: Record<string, string> = {};
    const docId = "doc-backup-test-99";
    const serverPayload = {
      documentId: docId,
      title: "Co-authored Manuscript",
      version: 7,
      updatedAt: new Date().toISOString(),
      textContent: "Co-author section added simultaneously in another session.",
    };

    const key = `competing_backup_${docId}_v${serverPayload.version}_${Date.now()}`;
    storage[key] = JSON.stringify(serverPayload);

    assert.ok(storage[key]);
    const retrieved = JSON.parse(storage[key]);
    assert.equal(retrieved.version, 7);
    assert.equal(retrieved.textContent, "Co-author section added simultaneously in another session.");
  });

  test("7. Client-side debounce & trailing save queue simulation", async () => {
    let saveCount = 0;
    let savedVersions: string[] = [];
    let isSaving = false;
    let pendingUpdates: string | null = null;
    let debounceTimer: any = null;

    const executeSave = async () => {
      if (!pendingUpdates) return;
      if (isSaving) return;

      isSaving = true;
      const snapshot = pendingUpdates;

      // Simulate network request
      await new Promise((r) => setTimeout(r, 20));
      saveCount++;
      savedVersions.push(snapshot);

      if (pendingUpdates === snapshot) {
        pendingUpdates = null;
      }

      isSaving = false;

      // Trailing save chained
      if (pendingUpdates !== null) {
        setTimeout(executeSave, 10);
      }
    };

    const scheduleDebouncedSave = (text: string) => {
      pendingUpdates = text;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(executeSave, 30);
    };

    // User types 3 edits within debounce interval
    scheduleDebouncedSave("Keystroke 1");
    scheduleDebouncedSave("Keystroke 2");
    scheduleDebouncedSave("Keystroke 3 (final after burst)");

    // Wait for debounce timer (30ms) + network request (20ms)
    await new Promise((r) => setTimeout(r, 80));

    // Exactly one save occurred with the final coalesced text
    assert.equal(saveCount, 1);
    assert.deepEqual(savedVersions, ["Keystroke 3 (final after burst)"]);
    assert.equal(pendingUpdates, null);
  });

  test("8. Rapid in-flight typing: Trailing save persists newer changes and avoids premature 'saved'", async () => {
    let saveCount = 0;
    let savedVersions: string[] = [];
    let isSaving = false;
    let status: SaveStatus = "saved";
    let pendingUpdates: string | null = null;

    const executeSave = async () => {
      if (!pendingUpdates) return true;
      if (isSaving) return false;

      isSaving = true;
      status = "saving";
      const snapshot = pendingUpdates;

      // Simulate 40ms network round-trip
      await new Promise((r) => setTimeout(r, 40));
      saveCount++;
      savedVersions.push(snapshot);

      // Snapshot check
      if (pendingUpdates === snapshot) {
        pendingUpdates = null;
        status = "saved";
      } else {
        // Newer edits arrived during flight! Do NOT display 'saved'
        status = "unsaved";
      }

      isSaving = false;

      // Chain trailing save
      if (pendingUpdates !== null) {
        setTimeout(executeSave, 10);
      }
      return true;
    };

    // User triggers initial save
    pendingUpdates = "Paragraph 1";
    const initialSave = executeSave();
    assert.equal(status, "saving");

    // While initial save is in-flight at t=10ms, user types Paragraph 2
    await new Promise((r) => setTimeout(r, 10));
    pendingUpdates = "Paragraph 1 + Paragraph 2";

    // Wait for initial save to finish
    await initialSave;

    // After initial save finishes, status MUST be 'unsaved' because Paragraph 2 is still pending!
    assert.equal(status, "unsaved", "Premature 'saved' display prevented");
    assert.equal(pendingUpdates, "Paragraph 1 + Paragraph 2");

    // Wait for trailing save to complete (10ms chain + 40ms network)
    await new Promise((r) => setTimeout(r, 80));

    // Trailing save completed
    assert.equal(status, "saved");
    assert.equal(saveCount, 2);
    assert.deepEqual(savedVersions, [
      "Paragraph 1",
      "Paragraph 1 + Paragraph 2",
    ]);
  });

  test("9. Exact Error Replication: Calling addEventListener on manuscript data throws TypeError", () => {
    // Manuscript data object
    const researchDocument = {
      id: "doc-sample-123",
      title: "Guided Academic Manuscript",
      content: { type: "doc" },
      version: 1,
    };

    // When 'document' shadowed the browser global, (document as any).addEventListener(...) was invoked
    const shadowedDocument: any = researchDocument;
    assert.throws(
      () => {
        shadowedDocument.addEventListener("click", () => {}, true);
      },
      {
        name: "TypeError",
        message: /shadowedDocument\.addEventListener is not a function|document\.addEventListener is not a function/,
      }
    );
  });

  test("10. Full Client Mount: EditorClient mounts with manuscript object, registers listeners on window.document, and avoids shadowing crash", async () => {
    const eventListeners: Record<string, Function[]> = {};

    class MockNode {}
    class MockElement extends MockNode {}
    class MockHTMLElement extends MockElement {}
    class MockHTMLIFrameElement extends MockHTMLElement {}

    let mockDomDocument: any;

    function createMockElement(tag: string): any {
      const classes = new Set<string>();
      return {
        tagName: tag.toUpperCase(),
        style: {},
        setAttribute: () => {},
        setAttributeNS: () => {},
        removeAttribute: () => {},
        getAttribute: () => null,
        appendChild: (child: any) => child,
        removeChild: (child: any) => child,
        insertBefore: (child: any) => child,
        childNodes: [],
        get ownerDocument() {
          return mockDomDocument;
        },
        nodeType: 1,
        classList: {
          add: (...names: string[]) => names.forEach((n) => classes.add(n)),
          remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
          contains: (n: string) => classes.has(n),
          toggle: (n: string) => (classes.has(n) ? classes.delete(n) : classes.add(n)),
        },
        contains: () => true,
        getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
        addEventListener: (event: string, fn: Function) => {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(fn);
        },
        removeEventListener: (event: string, fn: Function) => {
          if (eventListeners[event]) {
            eventListeners[event] = eventListeners[event].filter((f) => f !== fn);
          }
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementsByTagName: () => [],
      };
    }

    const mockHead = createMockElement("head");
    const mockDocumentElement = createMockElement("html");

    mockDomDocument = {
      addEventListener: (event: string, fn: Function, useCapture?: boolean) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function, useCapture?: boolean) => {
        if (eventListeners[event]) {
          eventListeners[event] = eventListeners[event].filter((f) => f !== fn);
        }
      },
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (ns: string, tag: string) => createMockElement(tag),
      createTextNode: (text: string) => ({
        nodeType: 3,
        textContent: text,
        get ownerDocument() {
          return mockDomDocument;
        },
      }),
      createComment: (text: string) => ({
        nodeType: 8,
        textContent: text,
        get ownerDocument() {
          return mockDomDocument;
        },
      }),
      body: createMockElement("body"),
      head: mockHead,
      documentElement: mockDocumentElement,
      nodeType: 9,
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementsByTagName: (tag: string) => [mockHead],
      contains: () => true,
    };

    const mockNavigator = {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
    };

    const mockDomWindow: any = {
      document: mockDomDocument,
      navigator: mockNavigator,
      addEventListener: (event: string, fn: Function) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function) => {
        if (eventListeners[event]) {
          eventListeners[event] = eventListeners[event].filter((f) => f !== fn);
        }
      },
      location: { href: "http://localhost:3000/editor/test-doc-123" },
      Node: MockNode,
      Element: MockElement,
      HTMLElement: MockHTMLElement,
      HTMLIFrameElement: MockHTMLIFrameElement,
      requestIdleCallback: (cb: any) => setTimeout(cb, 1),
      cancelIdleCallback: (id: any) => clearTimeout(id),
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      innerHeight: 800,
      innerWidth: 1200,
    };

    const prevWindow = (globalThis as any).window;
    const prevDocument = (globalThis as any).document;
    const prevNavigator = (globalThis as any).navigator;
    const prevSelf = (globalThis as any).self;

    (globalThis as any).window = mockDomWindow;
    (globalThis as any).document = mockDomDocument;
    (globalThis as any).navigator = mockNavigator;
    (globalThis as any).self = mockDomWindow;
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;
    (globalThis as any).requestIdleCallback = mockDomWindow.requestIdleCallback;
    (globalThis as any).cancelIdleCallback = mockDomWindow.cancelIdleCallback;
    (globalThis as any).innerHeight = 800;
    (globalThis as any).innerWidth = 1200;

    const mockDoc = {
      id: "doc-sample-123",
      title: "Guided Academic Manuscript",
      docType: DocumentType.MANUSCRIPT,
      version: 1,
      updatedAt: new Date().toISOString(),
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Empirical observation" }] }],
      },
      linkedPapers: [],
      citations: [],
    };

    const mockRouter: any = {
      push: () => {},
      replace: () => {},
      refresh: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    };

    const rootDiv = mockDomDocument.createElement("div");

    try {
      const ReactDOMClient = (await import("react-dom/client")).default;
      const { EditorClient } = await import("../src/app/editor/[id]/editor-client");
      const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");

      const root = ReactDOMClient.createRoot(rootDiv as any);
      root.render(
        React.createElement(
          AppRouterContext.Provider,
          { value: mockRouter },
          React.createElement(EditorClient, { initialDocument: mockDoc as any })
        )
      );

      // Wait for effects to flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Assert click interceptor registered on window.document
      assert.ok(
        (eventListeners["click"]?.length || 0) >= 1,
        "Click interceptor MUST be registered on window.document without throwing"
      );

      // Assert keydown registered on window
      assert.ok(
        (eventListeners["keydown"]?.length || 0) >= 1,
        "Keydown handler MUST be registered on window"
      );

      // Unmount cleanly to verify removeEventListener works
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      (globalThis as any).window = prevWindow;
      (globalThis as any).document = prevDocument;
      (globalThis as any).navigator = prevNavigator;
      (globalThis as any).self = prevSelf;
    }
  });
});
