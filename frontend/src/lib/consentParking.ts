import { useCallback, useEffect, useRef } from "react";

import { ApiError } from "./api";
import { useAuth } from "./auth";

/**
 * Autosave while the terms must be re-accepted (staging audit). A save refused with CONSENT_REQUIRED is parked
 * instead of retried on a timer: the edits stay in the queue, and `flush` runs exactly once as soon as the loaded
 * profile shows this account's consent is current (after acceptance, or straight away if the profile reload shows
 * it already was, e.g. accepted in another tab).
 *
 * Returns `park(error)`: true when the error was a consent refusal and the save is now parked.
 */
export function useConsentParking(flush: () => Promise<unknown>): (error: unknown) => boolean {
  const { user } = useAuth();
  const parked = useRef(false);
  useEffect(() => {
    if (parked.current && user && !user.needs_consent) {
      parked.current = false;
      void flush();
    }
  }, [user, flush]);
  return useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === "CONSENT_REQUIRED") {
      parked.current = true;
      return true;
    }
    return false;
  }, []);
}
