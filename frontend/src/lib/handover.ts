/**
 * A research question (and, from Deep research, the papers saved for it) handed from one research mode to the
 * other. It is held in memory only, so the question never appears in the address bar, the browser history, a
 * reload or a referrer (audit SF02). It belongs to one account: it is dropped when the sign-in changes, and a
 * different account never receives it. The receiving page reads it once.
 */
export type HandoverTarget = "ask" | "deep";

export interface Handover {
  question: string;
  paperIds: string[];
}

let pending: (Handover & { userId: string; target: HandoverTarget }) | null = null;

export function handOver(userId: string, target: HandoverTarget, handover: Handover): void {
  pending = { userId, target, question: handover.question, paperIds: [...handover.paperIds] };
}

/** What was handed to this page for this account, without consuming it (safe in a state initializer). */
export function peekHandover(userId: string | undefined, target: HandoverTarget): Handover | null {
  if (!pending || !userId || pending.userId !== userId || pending.target !== target) return null;
  return { question: pending.question, paperIds: [...pending.paperIds] };
}

/** Consume the handover for this page (call once the page has taken it). */
export function clearHandover(target?: HandoverTarget): void {
  if (!target || pending?.target === target) pending = null;
}
