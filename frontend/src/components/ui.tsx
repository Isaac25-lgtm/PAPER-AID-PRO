import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type RefObject, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** primary = ink (the default action); accent = signal orange, used sparingly for the one main call to action. */
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm",
        {
          primary: "bg-slate-900 text-white hover:bg-slate-800",
          accent: "bg-brand-500 text-white hover:bg-brand-600",
          secondary: "border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50",
          ghost: "text-slate-700 hover:bg-slate-100",
          danger: "bg-red-600 text-white hover:bg-red-700",
        }[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const fieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(fieldClass, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(fieldClass, className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx(fieldClass, "pr-8", className)}>
      {children}
    </select>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
      {children}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-xl border border-slate-200 bg-white", className)}>{children}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function Alert({ kind = "info", title, children }: { kind?: "info" | "error" | "success" | "warning"; title?: string; children?: ReactNode }) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "info" ? Info : AlertTriangle;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={clsx("flex gap-3 rounded-lg border p-3 text-sm", {
        info: "border-slate-200 bg-slate-50 text-slate-800",
        error: "border-red-200 bg-red-50 text-red-900",
        success: "border-emerald-200 bg-emerald-50 text-emerald-900",
        warning: "border-amber-200 bg-amber-50 text-amber-900",
      }[kind])}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" | "amber" | "red" | "violet" }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
        slate: "bg-slate-100 text-slate-700",
        green: "bg-emerald-100 text-emerald-800",
        blue: "bg-slate-100 text-slate-950",
        amber: "bg-amber-100 text-amber-800",
        red: "bg-red-100 text-red-800",
        violet: "bg-slate-100 text-slate-800",
      }[tone])}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for anything that behaves as a dialog (modals, the mobile editor drawer): focus moves inside,
 * Tab/Shift+Tab stay inside, Escape closes, and focus returns to where it was when the dialog closes.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const firstInBody = dialog?.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE})`);
    (firstInBody ?? focusables()[0] ?? dialog)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (!dialog.contains(current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);
}

/** Accessible dialog: focus moves into it, Tab/Shift+Tab stay inside, Escape closes, focus returns afterwards. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-20" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx("w-full rounded-xl border border-slate-200 bg-white shadow-2xl focus:outline-none", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5" data-modal-body>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-slate-950">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
