import type { Editor } from "@tiptap/react";
import { createContext, useContext } from "react";

/**
 * A document position that follows later edits (each transaction's mapping), so an insertion requested at one
 * moment lands in the same place when a delayed response arrives. `deleted` is true if the text around it was
 * removed in the meantime.
 */
export interface TrackedPosition {
  readonly pos: number;
  readonly deleted: boolean;
  stop(): void;
}

export function trackPosition(editor: Editor, start: number): TrackedPosition {
  let pos = start;
  let deleted = false;
  const onTransaction = ({ transaction }: { transaction: { mapping: { mapResult: (p: number) => { pos: number; deleted: boolean } } } }) => {
    const result = transaction.mapping.mapResult(pos);
    pos = result.pos;
    deleted = deleted || result.deleted;
  };
  editor.on("transaction", onTransaction);
  return {
    get pos() {
      return pos;
    },
    get deleted() {
      return deleted;
    },
    stop: () => editor.off("transaction", onTransaction),
  };
}

/**
 * One gate for every operation that changes the draft from outside the keyboard (citations from panels, rewrites,
 * PDF quotes). Export and restore `pause()` it: operations already in flight finish first (so their edits are saved
 * before the export or replaced knowingly by the restore), and nothing new can change the text until `resume()`.
 */
export class EditGate {
  private state: "open" | "draining" | "locked" = "open";
  private inflight = new Set<Promise<unknown>>();

  /** Run an operation that will change the draft. Refused while an export or restore holds the gate. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state !== "open") return Promise.reject(new Error("Editing is paused while the document is exported or restored. Try again in a moment."));
    const promise = operation();
    this.inflight.add(promise);
    const done = () => this.inflight.delete(promise);
    promise.then(done, done);
    return promise;
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  /** Wait for in-flight operations, then hold the gate. */
  async pause(): Promise<void> {
    this.state = "draining";
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
    this.state = "locked";
  }

  resume(): void {
    this.state = "open";
  }
}

export const EditGateContext = createContext<EditGate>(new EditGate());

export function useEditGate(): EditGate {
  return useContext(EditGateContext);
}
