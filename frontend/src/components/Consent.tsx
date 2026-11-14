import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Card } from "./ui";

const REQUIRED = [
  { key: "terms", label: <>I agree to the <PolicyLink to="/terms">Terms of Service</PolicyLink>.</> },
  { key: "privacy", label: <>I have read the <PolicyLink to="/privacy">Privacy Notice</PolicyLink> and understand how my data is used.</> },
  {
    key: "ai_processing",
    label: <>I understand that when I use AI features, my question and excerpts from the papers I select are sent to an AI provider to produce the answer (<PolicyLink to="/ai-notice">AI Use Notice</PolicyLink>).</>,
  },
  { key: "age_18", label: <>I am 18 years of age or older.</> },
] as const;

const OPTIONAL = [
  { key: "product_emails", label: "Email me occasional product updates (optional)." },
  { key: "analytics", label: "Help improve PaperAid Pro with anonymous usage statistics (optional)." },
] as const;

type Key = (typeof REQUIRED)[number]["key"] | (typeof OPTIONAL)[number]["key"];

function PolicyLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">
      {children}
    </Link>
  );
}

/** Shown before anything else until the account has accepted the current policy version. Every choice is recorded. */
export function ConsentGate() {
  const { user, refresh, signOut } = useAuth();
  const [choices, setChoices] = useState<Record<Key, boolean>>({
    terms: false,
    privacy: false,
    ai_processing: false,
    age_18: false,
    product_emails: false,
    analytics: false,
  });
  const accept = useMutation({ mutationFn: () => api.post("/me/consent", choices), onSuccess: () => refresh() });
  const ready = REQUIRED.every((item) => choices[item.key]);
  const updated = Boolean(user?.accepted_policy_version);
  const toggle = (key: Key) => setChoices((current) => ({ ...current, [key]: !current[key] }));
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-brand-700" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{updated ? "Our terms have been updated" : "Before you start"}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {updated
                ? "Please review the updated documents and confirm to continue."
                : "Please review and confirm the following. You can download or delete your data at any time from your Account page."}
            </p>
          </div>
        </div>
        <form
          className="mt-6 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) accept.mutate();
          }}
        >
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required</legend>
            {REQUIRED.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 hover:border-brand-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={choices[item.key]} onChange={() => toggle(item.key)} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2 pt-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optional — off unless you choose</legend>
            {OPTIONAL.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={choices[item.key]} onChange={() => toggle(item.key)} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
          {accept.error && <Alert kind="error">{errorMessage(accept.error)}</Alert>}
          <div className="flex items-center justify-between pt-3">
            <Button type="button" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
            <Button type="submit" disabled={!ready} loading={accept.isPending}>Agree and continue</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
