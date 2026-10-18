"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { GraduationCap, ArrowRight, ShieldCheck, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { useSearchParams } from "next/navigation";
import { getSafeCallbackUrl } from "@/lib/auth/safe-redirect";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeCallbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"), "/dashboard");

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create account.");
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);

      // Automatically sign the user in with their new credentials
      const signInRes = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (signInRes?.ok) {
        router.push(safeCallbackUrl);
        router.refresh();
      } else {
        // Fallback to login page if auto-signin didn't redirect
        router.push(`/login${safeCallbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(safeCallbackUrl)}` : ""}`);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md bg-white border-slate-200 shadow-md">
        <CardHeader className="text-center space-y-2 p-6">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mx-auto">
            Open Access
          </div>
          <h1 className="text-xl font-bold text-slate-900">Create Your Account</h1>
          <p className="text-xs text-slate-500">
            Open academic research workspace. Personal or university email addresses welcome.
          </p>
        </CardHeader>

        <CardContent className="space-y-4 p-6 pt-0">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isSuccess && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Account created! Signing you in...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-xs font-semibold text-slate-700">
                Full Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Alex Johnson"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="email" className="text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <span className="text-[11px] text-slate-400">Personal or Work</span>
              </div>
              <Input
                id="email"
                type="email"
                placeholder="alex@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-semibold text-slate-700">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                disabled={isLoading}
              />
              <p className="text-[11px] text-slate-400">Minimum 6 characters</p>
            </div>

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 font-medium"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                <>
                  Create Account
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="flex items-center gap-2 justify-center text-[11px] text-slate-400 pt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Open to all personal and professional email accounts</span>
          </div>
        </CardContent>

        <CardFooter className="justify-center border-t border-slate-100 p-4 text-xs text-slate-500">
          <span>Already registered? </span>
          <Link
            href={`/login${safeCallbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(safeCallbackUrl)}` : ""}`}
            className="font-semibold text-indigo-600 hover:underline ml-1"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
