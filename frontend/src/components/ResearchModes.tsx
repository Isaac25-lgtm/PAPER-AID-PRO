import clsx from "clsx";
import { FlaskConical, Globe } from "lucide-react";
import { NavLink } from "react-router";

/** The two ways to research, side by side on both pages, so the difference is always visible. */
const MODES = [
  { to: "/research", icon: FlaskConical, title: "My papers", body: "Ask across papers already in your library" },
  { to: "/research/deep", icon: Globe, title: "Deep research", body: "Search the scholarly databases and the web for new sources" },
];

export function ResearchModes() {
  return (
    <nav aria-label="Research mode" className="mb-6 grid gap-2 sm:grid-cols-2">
      {MODES.map(({ to, icon: Icon, title, body }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            clsx(
              "flex items-start gap-3 rounded-xl border p-3 transition",
              isActive ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={clsx("mt-0.5 h-5 w-5 shrink-0", isActive ? "text-brand-700" : "text-slate-500")} />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{title}</span>
                <span className="block text-sm text-slate-600">{body}</span>
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
