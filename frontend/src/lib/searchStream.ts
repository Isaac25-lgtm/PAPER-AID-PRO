import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import type { Subject, Work } from "./types";

/** One database's state during a search: still searching, answered, or failed (with a retry). */
export interface DatabaseState {
  provider: string;
  state: "searching" | "done" | "failed";
  count: number;
  error: string | null;
}

export interface StreamedSearch {
  /** What is being searched (the corrected words when a misspelling was corrected). */
  query: string;
  /** The words as typed, when they were corrected. */
  correctedFrom: string | null;
  /** "doi" | "pmid" | "pmcid" | "arxiv" when the box held an identifier, looked up exactly. */
  identifier: string | null;
  /** In exact mode, a spelling the person may have meant (offered, never applied). */
  suggestion: string | null;
  results: Work[];
  databases: DatabaseState[];
  done: boolean;
  error: unknown;
}

export interface SearchParams {
  q: string;
  subject: Subject;
  yearFrom: string;
  openAccessOnly: boolean;
  exact: boolean;
}

type Event =
  | { type: "query"; query: string; corrected_from: string | null; identifier: string | null; pending: string[] }
  | { type: "results"; results: Work[]; providers: { provider: string; ok: boolean; count: number; error: string | null }[]; pending: string[] }
  | { type: "suggestion"; query: string }
  | { type: "done" };

const EMPTY: StreamedSearch = { query: "", correctedFrom: null, identifier: null, suggestion: null, results: [], databases: [], done: false, error: null };

/**
 * Discover's search, streamed: results appear as each database answers, the page says which are still searching,
 * and `retry()` repeats the search (databases that already answered reply from the server's short cache, so only the
 * failed ones are asked again). A new search, or leaving the page, cancels the previous one.
 */
export function useSearchStream(params: SearchParams | null) {
  const [state, setState] = useState<StreamedSearch>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  // A retry searches exactly the words already shown, and keeps saying what they were corrected from. What was
  // already found stays on screen while the failed databases are asked again (Silver, 25 November 2026).
  const retryOf = useRef<{ query: string; correctedFrom: string | null; results: Work[]; databases: DatabaseState[] } | null>(null);
  const key = params ? JSON.stringify(params) : "";

  useEffect(() => {
    if (!params || params.q.trim().length < 2) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    const retrying = retryOf.current;
    retryOf.current = null;
    // Databases that answered before a retry: they keep their answer (and their results stay shown) until the
    // retried search has heard from all of them again; only the failed ones go back to "searching".
    const kept = new Map((retrying?.databases ?? []).filter((d) => d.state === "done").map((d) => [d.provider, d]));
    const again = (d: DatabaseState): DatabaseState => kept.get(d.provider) ?? { ...d, state: "searching", count: 0, error: null };
    setState(
      retrying
        ? { ...EMPTY, query: retrying.query, correctedFrom: retrying.correctedFrom, results: retrying.results, databases: retrying.databases.map(again) }
        : { ...EMPTY, query: params.q },
    );
    const query = {
      q: retrying?.query ?? params.q,
      subject: params.subject === "all" ? undefined : params.subject,
      year_from: params.yearFrom || undefined,
      open_access_only: params.openAccessOnly || undefined,
      exact: retrying ? true : params.exact || undefined,
      limit: 25,
    };
    const onEvent = (raw: unknown) => {
      const event = raw as Event;
      setState((current) => {
        switch (event.type) {
          case "query":
            return {
              ...current,
              query: event.query,
              correctedFrom: retrying ? retrying.correctedFrom : event.corrected_from,
              identifier: event.identifier,
              results: retrying ? current.results : [],
              databases: event.pending.map((provider) => again({ provider, state: "searching", count: 0, error: null })),
            };
          case "results": {
            const answered = new Map(event.providers.map((p) => [p.provider, p]));
            const databases = current.databases.map((d) => {
              const p = answered.get(d.provider);
              if (!p || (!p.ok && kept.has(d.provider))) return d; // a database that answered before never turns "failed"
              return { provider: d.provider, state: p.ok ? "done" : "failed", count: p.count, error: p.error } as DatabaseState;
            });
            // The server's list replaces the one shown once it includes every database that had answered before.
            const complete = [...kept.keys()].every((name) => answered.get(name)?.ok);
            return { ...current, results: complete ? event.results : current.results, databases };
          }
          case "suggestion":
            return { ...current, suggestion: event.query };
          case "done":
            return { ...current, done: true };
          default:
            return current;
        }
      });
    };
    api.stream("/discovery/search/stream", query, onEvent, controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState((current) => ({ ...current, done: true, error }));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised params
  }, [key, attempt]);

  const retry = useCallback(() => {
    retryOf.current = { query: state.query, correctedFrom: state.correctedFrom, results: state.results, databases: state.databases };
    setAttempt((n) => n + 1);
  }, [state.query, state.correctedFrom, state.results, state.databases]);

  return { ...state, retry, searching: Boolean(params && params.q.trim().length >= 2) && !state.done };
}
