import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Container } from "@/components/Layout";
import { Alert, Badge, Button, Card, Input, Label, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AIStatus, User } from "@/lib/types";

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
      <Card className="mt-6 p-5 text-sm text-slate-700">
        <h2 className="mb-2 font-semibold text-slate-900">AI features</h2>
        {ai.data?.enabled ? <p>Enabled ({ai.data.provider}, {ai.data.model}).</p> : <p>Not configured on this deployment yet. All other features work normally.</p>}
      </Card>
    </Container>
  );
}
