import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { DeleteMyAccount, DownloadMyData } from "@/components/DataRights";
import { Container } from "@/components/Layout";
import { Alert, Badge, Button, Card, Input, Label, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AIStatus, User } from "@/lib/types";

function PrivacyCard() {
  const { user, refresh } = useAuth();
  const optional = useMutation({
    mutationFn: (change: Record<string, boolean>) => api.post("/me/optional-consents", change),
    onSuccess: () => refresh(),
  });
  if (!user) return null;
  const prefs = user.preferences ?? {};
  return (
    <Card className="mt-6 space-y-5 p-5 text-sm text-slate-700">
      <div>
        <h2 className="font-semibold text-slate-900">Your data and privacy</h2>
        <p className="mt-1 text-slate-600">
          You accepted the <Link className="text-brand-700 underline" to="/terms">Terms</Link> and{" "}
          <Link className="text-brand-700 underline" to="/privacy">Privacy Notice</Link> version {user.accepted_policy_version ?? "—"}.
        </p>
      </div>
      <DownloadMyData />
      <div>
        <h3 className="font-medium text-slate-900">Optional choices</h3>
        {(
          [
            ["product_emails", "Occasional product update emails"],
            ["analytics", "Anonymous usage statistics"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="mt-2 flex items-center gap-3">
            <input type="checkbox" className="h-4 w-4" checked={Boolean(prefs[`consent_${key}`])} disabled={optional.isPending} onChange={(e) => optional.mutate({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
        {optional.error && <div className="mt-2"><Alert kind="error">{errorMessage(optional.error)}</Alert></div>}
      </div>
      <DeleteMyAccount email={user.email} />
    </Card>
  );
}

export default function AccountPage() {
  const { user, refresh, resetPassword, firebaseUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [resetSent, setResetSent] = useState(false);
  const save = useMutation({ mutationFn: () => api.patch<User>("/me", { name }), onSuccess: () => void refresh() });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status") });
  const passwordUser = firebaseUser?.providerData.some((p) => p.providerId === "password");
  if (!user) return null;
  return (
    <Container className="max-w-2xl">
      <PageHeader title="Account" />
      <Card className="space-y-4 p-5">
        <div>
          <Label htmlFor="name">Display name</Label>
          <div className="flex gap-2">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button>
          </div>
          {save.isSuccess && <p className="mt-1 text-sm text-emerald-700">Saved.</p>}
          {save.error && <div className="mt-2"><Alert kind="error">{errorMessage(save.error)}</Alert></div>}
        </div>
        <div className="text-sm text-slate-700">
          <p><span className="text-slate-500">Email:</span> {user.email} {user.email_verified && <Badge tone="green">verified</Badge>}</p>
          <p><span className="text-slate-500">Role:</span> {user.role}</p>
          <p><span className="text-slate-500">Member since:</span> {new Date(user.created_at).toLocaleDateString()}</p>
        </div>
        {passwordUser && (
          <div>
            <Button variant="secondary" size="sm" disabled={resetSent} onClick={() => void resetPassword(user.email).then(() => setResetSent(true))}>
              {resetSent ? "Password reset email sent" : "Change password"}
            </Button>
          </div>
        )}
      </Card>
      <PrivacyCard />
      <Card className="mt-6 p-5 text-sm text-slate-700">
        <h2 className="mb-2 font-semibold text-slate-900">AI features</h2>
        {ai.data?.enabled ? <p>Enabled ({ai.data.provider}, {ai.data.model}).</p> : <p>Not configured on this deployment yet. All other features work normally.</p>}
      </Card>
    </Container>
  );
}
