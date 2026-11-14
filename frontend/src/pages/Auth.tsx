import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { Container } from "@/components/Layout";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { authErrorMessage, useAuth } from "@/lib/auth";

const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_SIGNIN === "true";

function GoogleButton() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signInWithGoogle();
          } catch (err) {
            setError(authErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue with Google
      </Button>
      {error && <div className="mt-2"><Alert kind="error">{error}</Alert></div>}
    </>
  );
}

function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Container className="flex max-w-md flex-col justify-center py-16">
      <Card className="p-6">
        <h1 className="mb-5 text-xl font-semibold text-slate-900">{title}</h1>
        {children}
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">{footer}</p>
    </Container>
  );
}

export function LoginPage() {
  const { signIn, firebaseUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (firebaseUser) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Sign in to PaperAid Pro" footer={<>New here? <Link className="font-medium text-brand-700" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/reset-password" className="mb-1 text-xs text-brand-700">Forgot password?</Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
      {GOOGLE_ENABLED && (
        <>
          <div className="my-4 text-center text-xs uppercase tracking-wide text-slate-400">or</div>
          <GoogleButton />
        </>
      )}
    </AuthCard>
  );
}

export function RegisterPage() {
  const { signUp, firebaseUser } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (firebaseUser) return <Navigate to="/library" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signUp(name, email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Create your account" footer={<>Already registered? <Link className="font-medium text-brand-700" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters. We’ll email you a verification link.</p>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
      {GOOGLE_ENABLED && (
        <>
          <div className="my-4 text-center text-xs uppercase tracking-wide text-slate-400">or</div>
          <GoogleButton />
        </>
      )}
      <p className="mt-4 text-xs text-slate-500">By creating an account you agree to our <Link to="/privacy" className="underline">privacy notice</Link>.</p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title="Reset your password" footer={<Link className="font-medium text-brand-700" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert kind="success" title="Check your inbox">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await resetPassword(email);
              setSent(true);
            } catch (err) {
              const code = (err as { code?: string }).code;
              if (code === "auth/user-not-found") setSent(true); // never reveal whether an account exists
              else setError(authErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
