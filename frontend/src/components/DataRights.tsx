import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Input, Modal } from "./ui";

/**
 * Data rights: download everything, or delete the account. Available on the Account page and also before the
 * current notices are accepted or after removal from the tester list (the API serves these to any signed-in account).
 */
export function DownloadMyData() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setError(null);
    setExporting(true);
    try {
      await downloadFile("/me/export", "paperaid-my-data.zip");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      <h3 className="font-medium text-slate-900">Download my data</h3>
      <p className="mt-0.5 text-slate-600">A ZIP with your documents (Word and structured, with version history), library and collections (BibTeX, CSL-JSON), research conversations, every PDF you uploaded and your consent history.</p>
      <Button className="mt-2" size="sm" variant="secondary" loading={exporting} onClick={() => void download()}>Download my data</Button>
      {error && <div className="mt-2"><Alert kind="error">{error}</Alert></div>}
    </div>
  );
}

export function DeleteMyAccount({ email }: { email: string }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const leave = async () => {
    await signOut();
    navigate("/", { replace: true });
  };
  const remove = useMutation({
    mutationFn: () => api.delete<{ status?: string; message?: string } | undefined>("/me", { confirm_email: typed }),
    onSuccess: async (result) => {
      // 202: the account is closed and locked, but part of the deletion is still finishing. Say so before leaving.
      if (result?.status === "pending") setPending(result.message ?? "Your account is closed. Removing the rest of your data will finish automatically.");
      else await leave();
    },
  });
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <h3 className="font-medium text-red-900">Delete my account</h3>
      <p className="mt-0.5 text-red-900/80">Permanently deletes your sign-in, documents, library, research conversations and uploaded PDFs. This cannot be undone. Download your data first if you want a copy.</p>
      <Button className="mt-3" size="sm" variant="danger" onClick={() => setOpen(true)}>Delete my account…</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account permanently?">
        {pending ? (
          <div className="space-y-3 text-sm">
            <Alert kind="info" title="Account closed">{pending}</Alert>
            <div className="flex justify-end"><Button onClick={() => void leave()}>Sign out</Button></div>
          </div>
        ) : (
        <div className="space-y-3 text-sm">
          <p>Type your email address <strong>{email}</strong> to confirm. Everything is deleted and cannot be recovered.</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirm email address" autoComplete="off" />
          {remove.error && <Alert kind="error">{errorMessage(remove.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} disabled={typed.trim().toLowerCase() !== email.toLowerCase()} onClick={() => remove.mutate()}>Delete everything</Button>
          </div>
        </div>
        )}
      </Modal>
    </div>
  );
}

/** Collapsed data-rights panel for screens where the person cannot (yet) use the rest of the app. */
export function DataRightsPanel({ email }: { email: string }) {
  return (
    <details className="mt-6 rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
      <summary className="cursor-pointer font-medium text-slate-900">Download or delete your data without continuing</summary>
      <div className="mt-4 space-y-4">
        <DownloadMyData />
        <DeleteMyAccount email={email} />
      </div>
    </details>
  );
}
