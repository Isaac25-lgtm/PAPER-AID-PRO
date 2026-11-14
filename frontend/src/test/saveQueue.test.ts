import { describe, expect, it } from "vitest";

import { SaveQueue, type Fields } from "@/lib/saveQueue";

/** A fake server whose PATCH responses the test releases one at a time (to model a slow network). */
function slowServer() {
  const sent: Fields[] = [];
  const waiting: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  let active = 0;
  let maxConcurrent = 0;
  const send = (fields: Fields) =>
    new Promise<void>((resolve, reject) => {
      sent.push({ ...fields });
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      waiting.push({
        resolve: () => {
          active -= 1;
          resolve();
        },
        reject: (e) => {
          active -= 1;
          reject(e);
        },
      });
    });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { sent, waiting, send, tick, get maxConcurrent() { return maxConcurrent; } };
}

const conflictError = { status: 409 };
const isConflict = (e: unknown) => (e as { status?: number })?.status === 409;

describe("SaveQueue", () => {
  it("never sends two saves at once, even when the first PATCH is slow", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "v1" });
    const first = queue.flush();
    await server.tick();
    queue.update({ content: "v2" }); // edit while the first save is in flight
    const second = queue.flush();
    await server.tick();
    expect(server.sent).toHaveLength(1); // the second save waits for the first
    server.waiting[0]!.resolve();
    expect(await first).toBe(true);
    await server.tick();
    expect(server.sent).toEqual([{ content: "v1" }, { content: "v2" }]);
    server.waiting[1]!.resolve();
    expect(await second).toBe(true);
    expect(server.maxConcurrent).toBe(1);
    expect(queue.dirty).toBe(false);
  });

  it("coalesces rapid edits into one save", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "a" });
    queue.update({ title: "T" });
    queue.update({ content: "abc" });
    const saved = queue.flush();
    await server.tick();
    server.waiting[0]!.resolve();
    expect(await saved).toBe(true);
    expect(server.sent).toEqual([{ content: "abc", title: "T" }]);
  });

  it("reports failure so export does not proceed, and keeps the unsaved edits", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "important" });
    const attempt = queue.flush();
    await server.tick();
    server.waiting[0]!.reject(new Error("offline"));
    expect(await attempt).toBe(false); // the editor shows "Export not started" instead of exporting stale text
    expect(queue.dirty).toBe(true);
    const retry = queue.flush();
    await server.tick();
    expect(server.sent[1]).toEqual({ content: "important" });
    server.waiting[1]!.resolve();
    expect(await retry).toBe(true);
  });

  it("newer edits win over the fields of a failed save", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "old", title: "Old" });
    const attempt = queue.flush();
    await server.tick();
    queue.update({ content: "new" });
    server.waiting[0]!.reject(new Error("timeout"));
    await attempt;
    const retry = queue.flush();
    await server.tick();
    expect(server.sent[1]).toEqual({ content: "new", title: "Old" });
    server.waiting[1]!.resolve();
    await retry;
  });

  it("stops autosaving after a conflict until the user resolves it", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "mine" });
    const attempt = queue.flush();
    await server.tick();
    server.waiting[0]!.reject(conflictError);
    expect(await attempt).toBe(false);
    expect(queue.conflicted).toBe(true);
    expect(await queue.flush()).toBe(false);
    expect(server.sent).toHaveLength(1); // nothing else was sent
    queue.resolveConflict();
    const resolved = queue.flush();
    await server.tick();
    server.waiting[1]!.resolve();
    expect(await resolved).toBe(true);
  });

  it("discarding before a restore drops pending text explicitly", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "draft" });
    expect(queue.dirty).toBe(true);
    queue.discard();
    expect(queue.dirty).toBe(false);
    expect(await queue.flush()).toBe(true);
    expect(server.sent).toHaveLength(0);
  });

  it("reports in-flight state (used to warn before closing the tab)", async () => {
    const server = slowServer();
    const queue = new SaveQueue(server.send, isConflict);
    queue.update({ content: "x" });
    const saving = queue.flush();
    await server.tick();
    expect(queue.inFlight).toBe(true);
    expect(queue.dirty).toBe(false);
    server.waiting[0]!.resolve();
    await saving;
    expect(queue.inFlight).toBe(false);
  });
});
