/**
 * Serial autosave queue for the document editor.
 *
 * - Saves never overlap: each flush waits for the previous one, so a slow PATCH cannot race the next.
 * - Edits made while a save is in flight stay pending and go out in the next save.
 * - A failed save puts its fields back (newer edits win) and resolves `false`, so callers such as export
 *   can refuse to proceed with stale server content.
 * - After a conflict (HTTP 409) nothing is sent until the user resolves it (`resolveConflict`).
 */
export type Fields = Record<string, unknown>;

const MAX_DRAIN_ROUNDS = 10;

export interface SaveHooks {
  onStart?(): void;
  onSaved?(hasMore: boolean): void;
  onError?(error: unknown, conflict: boolean): void;
}

export class SaveQueue {
  private pending: Fields = {};
  private chain: Promise<boolean> = Promise.resolve(true);
  inFlight = false;
  conflicted = false;

  constructor(
    private readonly send: (fields: Fields) => Promise<void>,
    private readonly isConflict: (error: unknown) => boolean,
    private readonly hooks: SaveHooks = {},
  ) {}

  get dirty(): boolean {
    return Object.keys(this.pending).length > 0;
  }

  /** Record edited fields (merged into whatever is already pending). */
  update(fields: Fields): void {
    Object.assign(this.pending, fields);
  }

  /** Drop pending edits (the user chose to load or restore another version). */
  discard(): void {
    this.pending = {};
  }

  resolveConflict(): void {
    this.conflicted = false;
  }

  /**
   * Queue a save behind any running save and DRAIN: keep saving until nothing is pending (edits typed while a
   * request was in flight go out too). Resolves true only when the server has every edit made before it settles.
   * Callers that need a fixed snapshot (export, restore) should also stop editing while they wait.
   */
  flush(): Promise<boolean> {
    const drain = async (): Promise<boolean> => {
      for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
        if (!(await this.saveOnce())) return false;
        if (!this.dirty) return true;
      }
      return !this.dirty;
    };
    const next = this.chain.then(drain, drain);
    this.chain = next.catch(() => false);
    return next;
  }

  private async saveOnce(): Promise<boolean> {
    if (this.conflicted) return false;
    const fields = this.pending;
    if (!Object.keys(fields).length) return true;
    this.pending = {};
    this.inFlight = true;
    this.hooks.onStart?.();
    try {
      await this.send(fields);
      this.hooks.onSaved?.(this.dirty);
      return true;
    } catch (error) {
      this.pending = { ...fields, ...this.pending };
      const conflict = this.isConflict(error);
      this.conflicted = conflict;
      this.hooks.onError?.(error, conflict);
      return false;
    } finally {
      this.inFlight = false;
    }
  }
}
