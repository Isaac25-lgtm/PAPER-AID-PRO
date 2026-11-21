import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { AIStatus } from "./types";

/** Whether AI features work for this account right now. Controls that need AI are hidden or explained while it
 * is off, instead of offering a button that can only fail. `known` is false until the status has loaded. */
export function useAIEnabled(): { enabled: boolean; known: boolean } {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status"), staleTime: 10 * 60_000 });
  return { enabled: Boolean(status.data?.enabled), known: status.isSuccess };
}

export const AI_OFF_NOTE = "This turns on once AI is connected for your account.";
