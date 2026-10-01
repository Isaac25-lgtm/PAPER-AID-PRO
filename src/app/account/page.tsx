import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { User, Shield, ShieldAlert, Key, Mail, Calendar, ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function AccountPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  const { name, email, role, id } = session.user;
  const isAdmin = role === "ADMIN";

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Profile"
        title="Researcher Account"
        description="Manage your user role, authentication credentials, and platform authorization."
      />

      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xl">
              {name ? name[0].toUpperCase() : "U"}
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900">{name || "Researcher"}</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span>{email}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={isAdmin ? "default" : "academic"} className="text-xs px-3 py-1">
              {isAdmin ? "Role: Administrator" : "Role: Registered User"}
            </Badge>
          </div>
        </div>

        {/* Security & Access Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Shield className="h-4 w-4 text-emerald-600" />
              <span>Authentication Strategy</span>
            </div>
            <p className="text-xs text-slate-500">
              Stateless JWT with bcryptjs password hashing and NextAuth session tokens.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Key className="h-4 w-4 text-indigo-600" />
              <span>User Identifier</span>
            </div>
            <p className="text-xs font-mono text-slate-600 truncate">{id || "Active Session"}</p>
          </div>
        </div>

        {/* Role Privileges Banner */}
        {isAdmin ? (
          <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-indigo-950">Administrator Privileges Active</h4>
                <p className="text-xs text-indigo-700">
                  You have full authorization to access the Admin Console, upload manuscripts, and manage paper ingestion queues.
                </p>
              </div>
            </div>
            <Link href="/admin">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 shrink-0 gap-1.5">
                Go to Admin
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800">Standard Research Privileges</div>
            <p className="text-slate-500">
              Your account has access to all public discovery tools, personal bookmark libraries, and RAG conversation threads. Admin portal routes are restricted.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
