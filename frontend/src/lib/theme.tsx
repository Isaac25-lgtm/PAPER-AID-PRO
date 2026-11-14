import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "./api";
import { useAuth } from "./auth";

/**
 * Appearance: Light (Graphite), Night, or follow the device. The choice is kept in this browser (so it applies
 * before sign-in and before the first paint, via public/theme-init.js) and on the account (so it follows the
 * person to other devices).
 */
export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "paperaid.theme";
const PREFERENCE = "theme";

function readLocal(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function writeLocal(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage unavailable: the choice still applies to this page view */
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "dark" || (choice === "system" && prefersDark()) ? "dark" : "light";
}

function apply(choice: ThemeChoice): void {
  const dark = resolveTheme(choice) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#131417" : "#FFFFFF");
}

const ThemeContext = createContext<{ choice: ThemeChoice; resolved: "light" | "dark"; setChoice: (c: ThemeChoice) => void }>({
  choice: "system",
  resolved: "light",
  setChoice: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [choice, setChoiceState] = useState<ThemeChoice>(readLocal);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readLocal()));

  // Signing in on a new device adopts the account's choice.
  const remote = user?.preferences?.[PREFERENCE];
  useEffect(() => {
    if ((remote === "light" || remote === "dark" || remote === "system") && remote !== readLocal()) {
      writeLocal(remote);
      setChoiceState(remote);
    }
  }, [remote]);

  useEffect(() => {
    apply(choice);
    setResolved(resolveTheme(choice));
    if (choice !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      apply("system");
      setResolved(resolveTheme("system"));
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      writeLocal(next);
      setChoiceState(next);
      if (user) void api.patch("/me/preferences", { values: { [PREFERENCE]: next } }).catch(() => undefined);
    },
    [user],
  );

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Night", Icon: Moon },
  { value: "system", label: "Match device", Icon: Monitor },
];

/** Three-way appearance switch. `compact` shows icons only (top bars); otherwise icons with labels. */
export function ThemeSwitch({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { choice, setChoice } = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className={clsx("inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => setChoice(value)}
          className={clsx(
            "flex items-center gap-1.5 rounded-md text-xs font-medium transition",
            compact ? "p-1.5" : "px-2.5 py-1.5",
            choice === value ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
