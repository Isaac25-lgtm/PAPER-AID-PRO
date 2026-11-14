import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Container } from "@/components/Layout";
import { Alert, Badge, Button, Card, Input, Label, Modal, PageHeader } from "@/components/ui";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AIStatus, User } from "@/lib/types";

function PrivacyCard() {
  const { user, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const optional = useMutation({
    mutationFn: (change: Record<string, boolean>) => api.post("/me/optional-consents", change),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: () => api.delete("/me", { confirm_email: typed }),
    onSuccess: async () => {
      await signOut();
      navigate("/", { replace: true });
    },
  });
  if (!user) return null;
  const prefs = user.preferences ?? {};
  const download = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await downloadFile("/me/export", "paperaid-my-data.zip");
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };
  return (
    <Card className="mt-6 space-y-5 p-5 text-sm text-slate-700">
      <div>
        <h2 className="font-semibold text-slate-900">Your data and privacy</h2>
        <p className="mt-1 text-slate-600">
          You accepted the <Link className="text-brand-700 underline" to="/terms">Terms</Link> and{" "}
          <Link className="text-brand-700 underline" to="/privacy">Privacy Notice</Link> version {user.accepted_policy_version ?? "—"}.
        </p>
      </div>
      <div>
        <h3 className="font-medium text-slate-900">Download my data</h3>
        <p className="mt-0.5 text-slate-600">A ZIP with your documents (Word), library (BibTeX), research conversations, uploads and consent history.</p>
        <Button className="mt-2" size="sm" variant="secondary" loading={exporting} onClick={() => void download()}>Download my data</Button>
        {exportError && <div className="mt-2"><Alert kind="error">{exportError}</Alert></div>}
      </div>
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
      </div>
      <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
        <h3 className="font-medium text-red-900">Delete my account</h3>
        <p className="mt-0.5 text-red-900/80">Permanently deletes your sign-in, documents, library, research conversations and uploaded PDFs. This cannot be undone. Download your data first if you want a copy.</p>
        <Button className="mt-3" size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>Delete my account…</Button>
      </div>
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete your account permanently?">
        <div className="space-y-3 text-sm">
          <p>Type your email address <strong>{user.email}</strong> to confirm. Everything is deleted immediately and cannot be recovered.</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirm email address" autoComplete="off" />
          {remove.error && <Alert kind="error">{errorMessage(remove.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} disabled={typed.trim().toLowerCase() !== user.email.toLowerCase()} onClick={() => remove.mutate()}>Delete everything</Button>
          </div>
        </div>
      </Modal>
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
