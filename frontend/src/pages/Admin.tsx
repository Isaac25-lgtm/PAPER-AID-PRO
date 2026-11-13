import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { Container } from "@/components/Layout";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import type { AdminUser, Job, Stats } from "@/lib/types";

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "red" }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "red" ? "text-red-700" : "text-slate-900"}`}>{value}</p>
    </Card>
  );
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<Stats>("/admin/stats") });
  const users = useQuery({ queryKey: ["admin-users", q], queryFn: () => api.get<AdminUser[]>("/admin/users", { q: q || undefined }) });
  const jobs = useQuery({ queryKey: ["admin-jobs", jobStatus], queryFn: () => api.get<Job[]>("/admin/jobs", { status: jobStatus || undefined }) });
  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/jobs/${id}/retry`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["admin-jobs"] }),
  });

  return (
    <Container>
      <PageHeader title="Administration" subtitle="Platform health, users and processing jobs. All changes are audited." />
      {stats.data && (
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Users" value={stats.data.users} />
          <StatCard label="Public papers" value={stats.data.papers_public} />
          <StatCard label="Private uploads" value={stats.data.papers_private} />
          <StatCard label="With full text" value={stats.data.papers_with_full_text} />
          <StatCard label="Documents" value={stats.data.documents} />
          <StatCard label="Jobs in progress" value={stats.data.jobs_queued} />
          <StatCard label="Failed jobs (24 h)" value={stats.data.jobs_failed_24h} tone={stats.data.jobs_failed_24h ? "red" : undefined} />
          <StatCard label="AI" value={stats.data.ai_enabled ? "Enabled" : "Not configured"} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Users</h2>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name" aria-label="Search users" className="mb-3" />
          {users.isLoading && <Spinner />}
          {updateUser.error && <Alert kind="error">{errorMessage(updateUser.error)}</Alert>}
          <ul className="divide-y divide-slate-100">
            {users.data?.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{u.name ?? u.email}</p>
                  <p className="text-xs text-slate-500">{u.email} · {u.last_seen_at ? `seen ${relativeTime(u.last_seen_at)}` : "never seen"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!u.is_active && <Badge tone="red">Deactivated</Badge>}
                  <Select className="w-24 py-1" value={u.role} disabled={u.id === me?.id} aria-label={`Role for ${u.email}`} onChange={(e) => updateUser.mutate({ id: u.id, body: { role: e.target.value } })}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </Select>
                  {u.id !== me?.id && (
                    <Button size="sm" variant="ghost" onClick={() => updateUser.mutate({ id: u.id, body: { is_active: !u.is_active } })}>
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Processing jobs</h2>
            <Select className="w-36 py-1" value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} aria-label="Job status filter">
              <option value="">All</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="queued">Queued</option>
              <option value="succeeded">Succeeded</option>
            </Select>
          </div>
          {jobs.isLoading && <Spinner />}
          <ul className="divide-y divide-slate-100">
            {jobs.data?.map((j) => (
              <li key={j.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/papers/${j.paper_id}`} className="font-medium text-brand-700">Paper {j.paper_id.slice(0, 8)}</Link>
                  <Badge tone={j.status === "failed" ? "red" : j.status === "succeeded" ? "green" : "blue"}>{j.status}</Badge>
                </div>
                <p className="text-xs text-slate-500">{relativeTime(j.created_at)} · attempt {j.attempts}</p>
                {j.error && <p className="mt-1 text-xs text-red-700">{j.error}</p>}
                {j.status === "failed" && <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>Retry</Button>}
              </li>
            ))}
            {jobs.data?.length === 0 && <p className="text-sm text-slate-500">No jobs.</p>}
          </ul>
        </Card>
      </div>
    </Container>
  );
}
