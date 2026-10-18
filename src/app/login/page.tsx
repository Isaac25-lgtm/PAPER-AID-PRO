"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GraduationCap, ArrowRight, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { getSafeCallbackUrl } from "@/lib/auth/safe-redirect";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeCallbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"), "/dashboard");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  // Show error passed via ?error= query param from NextAuth redirect
  React.useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError === "CredentialsSignin") {
      setError("Invalid email or password. Please try again.");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password. Please try again.");
      } else {
        router.push(safeCallbackUrl);
        router.refresh();
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
          <h1 className="text-xl font-bold text-slate-900">Sign in to Research Hub</h1>
          <p className="text-xs text-slate-500">
            Access your saved papers, AI conversations, and research notes.
          </p>
        </CardHeader>

        <CardContent className="space-y-4 p-6 pt-0">
          {/* Error alert */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="password" className="font-semibold text-slate-700">
                  Password
                </label>
                <a href="#" className="text-indigo-600 hover:underline">
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 font-medium"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="flex items-center gap-2 justify-center text-[11px] text-slate-400 pt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Secure session-based authentication</span>
          </div>
        </CardContent>

        <CardFooter className="justify-center border-t border-slate-100 p-4 text-xs text-slate-500">
          <span>Don&apos;t have an account? </span>
          <Link
            href={`/register${safeCallbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(safeCallbackUrl)}` : ""}`}
            className="font-semibold text-indigo-600 hover:underline ml-1"
          >
            Create account
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
