import { useCallback, useEffect, useReducer, useRef } from "react";

import { api } from "./api";
import type { Subject, Work } from "./types";

/** One database's state during a search: still searching, answered, or failed (with a retry). */
export interface DatabaseState {
  provider: string;
  state: "searching" | "done" | "failed";
  count: number;
  error: string | null;
  /** Failed on a retry after answering before: its earlier papers are still shown. */
  earlier?: boolean;
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

type ProviderOutcome = { provider: string; ok: boolean; count: number; error: string | null };
export type StreamEvent =
  | { type: "query"; query: string; corrected_from: string | null; identifier: string | null; pending: string[] }
  | { type: "results"; results: Work[]; providers: ProviderOutcome[]; pending: string[] }
  | { type: "suggestion"; query: string }
  | { type: "done" };

/** What a retry starts from: the papers and database states on screen when Retry was pressed. */
interface RetryBase {
  query: string;
  correctedFrom: string | null;
  results: Work[];
  databases: DatabaseState[];
}

interface State extends StreamedSearch {
  /** Which search attempt this state belongs to: events from any other attempt are ignored (audit SF05). */
  attempt: number;
  retry: RetryBase | null;
}

type Action =
  | { type: "reset" }
  | { type: "start"; attempt: number; query: string; retry: RetryBase | null }
  | { type: "event"; attempt: number; event: StreamEvent }
  | { type: "failed"; attempt: number; error: unknown };

const EMPTY: State = { query: "", correctedFrom: null, identifier: null, suggestion: null, results: [], databases: [], done: false, error: null, attempt: 0, retry: null };

const workKey = (work: Work) => (work.identifier ?? work.doi ?? work.title).toLowerCase();

/** Databases that answered before the retry. */
const answeredBefore = (retry: RetryBase | null) => new Map((retry?.databases ?? []).filter((d) => d.state === "done").map((d) => [d.provider, d]));

/**
 * The papers to show while retrying: the server's list for this attempt, plus every earlier paper from a database
 * that answered before but has not (yet) answered again. A database that recovers adds its papers at once; one that
 * fails this time keeps its earlier papers on screen (audit SF05).
 */
function mergeWithEarlier(retry: RetryBase, fresh: Work[], answered: Map<string, ProviderOutcome>): Work[] {
  const before = answeredBefore(retry);
  const seen = new Set(fresh.map(workKey));
  const earlier = retry.results.filter((work) => work.sources.some((source) => before.has(source) && !answered.get(source)?.ok) && !seen.has(workKey(work)));
  return [...fresh, ...earlier];
}

function reducer(state: State, action: Action): State {
  if (action.type === "reset") return EMPTY;
  if (action.type === "start") {
    const retry = action.retry;
    const before = answeredBefore(retry);
    return {
      ...EMPTY,
      attempt: action.attempt,
      retry,
      query: retry?.query ?? action.query,
      correctedFrom: retry?.correctedFrom ?? null,
      results: retry?.results ?? [],
      databases: (retry?.databases ?? []).map((d) => before.get(d.provider) ?? { ...d, state: "searching", count: 0, error: null, earlier: false }),
    };
  }
  if (action.attempt !== state.attempt) return state; // a late event from a search that has been replaced
  if (action.type === "failed") return { ...state, done: true, error: action.error };
  const event = action.event;
  const retry = state.retry;
  const before = answeredBefore(retry);
  switch (event.type) {
    case "query":
      return {
        ...state,
        query: event.query,
        correctedFrom: retry ? retry.correctedFrom : event.corrected_from,
        identifier: event.identifier,
        results: retry ? state.results : [],
        databases: event.pending.map((provider) => before.get(provider) ?? { provider, state: "searching", count: 0, error: null }),
      };
    case "results": {
      const answered = new Map(event.providers.map((p) => [p.provider, p]));
      const databases = state.databases.map((d): DatabaseState => {
        const outcome = answered.get(d.provider);
        if (!outcome) return d;
        if (outcome.ok) return { provider: d.provider, state: "done", count: outcome.count, error: null };
        const earlier = before.get(d.provider);
        // Failed now: say so (Retry appears again), and keep its earlier papers if it had answered before.
        return earlier ? { ...earlier, state: "failed", error: outcome.error, earlier: true } : { provider: d.provider, state: "failed", count: 0, error: outcome.error };
      });
      return { ...state, databases, results: retry ? mergeWithEarlier(retry, event.results, answered) : event.results };
    }
    case "suggestion":
      return { ...state, suggestion: event.query };
    case "done":
      return { ...state, done: true };
    default:
      return state;
  }
}

/**
 * Discover's search, streamed: results appear as each database answers, the page says which are still searching,
 * and `retry()` repeats the search exactly (databases that already answered reply from the server's short cache).
 * While retrying, earlier papers stay until their database has answered again. A new search, or leaving the page,
 * cancels the previous one, and its late events are ignored.
 */
export function useSearchStream(params: SearchParams | null) {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const attempts = useRef(0);
  const pendingRetry = useRef<RetryBase | null>(null);
  const [retries, bumpRetry] = useReducer((n: number) => n + 1, 0);
  const key = params ? JSON.stringify(params) : "";

  useEffect(() => {
    const retry = pendingRetry.current;
    pendingRetry.current = null;
    if (!params || params.q.trim().length < 2) {
      dispatch({ type: "reset" });
      return;
    }
    const attempt = ++attempts.current;
    const controller = new AbortController();
    dispatch({ type: "start", attempt, query: params.q, retry });
    const query = {
      q: retry?.query ?? params.q,
      subject: params.subject === "all" ? undefined : params.subject,
      year_from: params.yearFrom || undefined,
      open_access_only: params.openAccessOnly || undefined,
      exact: retry ? true : params.exact || undefined,
      limit: 25,
    };
    api.stream("/discovery/search/stream", query, (event) => dispatch({ type: "event", attempt, event: event as StreamEvent }), controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", attempt, error });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised params
  }, [key, retries]);

  const retry = useCallback(() => {
    pendingRetry.current = { query: state.query, correctedFrom: state.correctedFrom, results: state.results, databases: state.databases };
    bumpRetry();
  }, [state.query, state.correctedFrom, state.results, state.databases]);

  const { attempt: _attempt, retry: _base, ...visible } = state;
  return { ...visible, retry, searching: Boolean(params && params.q.trim().length >= 2) && !state.done };
}
