import { useCallback, useEffect, useState } from "react";

import { api } from "./api";
import { useAuth } from "./auth";
import { guideStore } from "./guides";

/**
 * A per-account preference (guide state, checklist visibility, defaults). Stored on the account so it follows the
 * person to every device; the browser keeps a copy so the UI is instant and works if the request fails.
 */
export function usePreference<T extends string | boolean | number>(key: string, fallback: T): [T, (value: T | null) => void] {
  const { user } = useAuth();
  const localKey = user ? `pref.${user.id}.${key}` : "";
  const read = useCallback((): T => {
    // This browser's copy is written together with every change, so it is never older than the account copy
    // loaded at sign-in; on a new device there is no local copy and the account value applies.
    const local = localKey ? guideStore.get(localKey) : null;
    if (local !== null) {
      try {
        return JSON.parse(local) as T;
      } catch {
        /* fall through to the account value */
      }
    }
    const remote = user?.preferences?.[key];
    return remote !== undefined && remote !== null ? (remote as T) : fallback;
  }, [user, key, localKey, fallback]);
  const [value, setValue] = useState<T>(read);
  useEffect(() => setValue(read()), [read]);

  const update = useCallback(
    (next: T | null) => {
      setValue(next === null ? fallback : next);
      if (!user) return;
      if (next === null) guideStore.remove(localKey);
      else guideStore.set(localKey, JSON.stringify(next));
      void api.patch("/me/preferences", { values: { [key]: next } }).catch(() => undefined);
    },
    [user, key, localKey, fallback],
  );
  return [value, update];
}
