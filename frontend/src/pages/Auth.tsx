import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/stores/auth";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { CheckIcon } from "@/components/ui/Icon";import { InlineError } from "@/components/ui/States";

function AuthAside({ mode }: { mode: "login" | "register" }) {
  const points =
    mode === "login"
      ? [
          "Track every order with a live status timeline",
          "Save delivery addresses for one-tap checkout",
          "Reorder your regulars in seconds",
        ]
      : [
          "Cash on delivery — pay when your order arrives",
          "Free delivery on orders over ₹999",
          "Order history and statuses in one place",
        ];
  return (
    <aside className="hidden bg-brand-700 px-10 py-12 text-surface lg:flex lg:flex-col lg:justify-between">
      <div>
        <p className="font-display text-2xl font-semibold tracking-tight">OneMart</p>
        <p className="label mt-1 text-surface/50">Everything you need, in one place.</p>
      </div>
      <div>
        <h2 className="text-3xl leading-tight text-surface">
          {mode === "login" ? "Welcome back to your hypermarket." : "Your daily shop, sorted."}
        </h2>
        <ul className="mt-7 space-y-4">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-sm text-surface/75">
              <CheckIcon width={17} height={17} className="mt-0.5 shrink-0 text-surface" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[0.8125rem] text-surface/50">
        Groceries · Home care · Personal care · Daily essentials
      </p>
    </aside>
  );
}

function useSafeNext() {
  const [sp] = useSearchParams();
  const raw = sp.get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function LoginPage() {
  const { login, user, booted } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const next = useSafeNext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (booted && user) navigate(next, { replace: true });
  }, [booted, user, navigate, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.removeQueries({ queryKey: ["checkout-summary"] });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign you in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 lg:py-14">
      <div className="grid overflow-hidden rounded-md bg-surface border border-line lg:grid-cols-2">
        <AuthAside mode="login" />
        <div className="px-6 py-10 sm:px-10">
          <p className="label text-brand-600">Sign in</p>
          <h1 className="mt-2 text-3xl">Welcome back</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to your account to track orders and check out faster.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error ? <InlineError>{error}</InlineError> : null}
            <Field label="Email address" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" block size="lg" loading={loading}>
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-sm text-ink-muted">
            New to OneMart?{" "}
            <Link
              to={`/register${window.location.search}`}
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>

          <div className="mt-6 rounded-md bg-surface-2/50 px-4 py-4 ">
            <p className="label text-ink-muted">Demo accounts</p>
            <div className="mt-2 space-y-1 text-[0.8125rem] text-ink-muted">
              <p>
                Customer: <span className="num">demo@onemart.test</span> ·{" "}
                <span className="num">Demo@1234</span>
              </p>
              <p>
                Admin: <span className="num">admin@onemart.test</span> ·{" "}
                <span className="num">Admin@1234</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { register, user, booted } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const next = useSafeNext();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (booted && user) navigate(next, { replace: true });
  }, [booted, user, navigate, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errors: Record<string, string> = {};
    if (fullName.trim().length < 2) errors.full_name = "Enter your full name";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address";
    if (password.length < 8) errors.password = "Use at least 8 characters";
    if (password !== confirm) errors.confirm = "Passwords do not match";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      await register(email.trim(), password, fullName.trim());
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.removeQueries({ queryKey: ["checkout-summary"] });
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = err.fieldErrors();
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        setError(err.message);
      } else {
        setError("Could not create your account. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 lg:py-14">
      <div className="grid overflow-hidden rounded-md bg-surface border border-line lg:grid-cols-2">
        <AuthAside mode="register" />
        <div className="px-6 py-10 sm:px-10">
          <p className="label text-brand-600">Create account</p>
          <h1 className="mt-2 text-3xl">Join OneMart</h1>
          <p className="mt-2 text-sm text-ink-muted">
            One account for orders, addresses and delivery updates.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error ? <InlineError>{error}</InlineError> : null}
            <Field label="Full name" htmlFor="full_name" error={fieldErrors.full_name}>
              <Input
                id="full_name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                invalid={Boolean(fieldErrors.full_name)}
              />
            </Field>
            <Field label="Email address" htmlFor="reg_email" error={fieldErrors.email}>
              <Input
                id="reg_email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={Boolean(fieldErrors.email)}
              />
            </Field>
            <Field
              label="Password"
              htmlFor="reg_password"
              error={fieldErrors.password}
              hint="At least 8 characters"
            >
              <Input
                id="reg_password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={Boolean(fieldErrors.password)}
              />
            </Field>
            <Field label="Confirm password" htmlFor="confirm" error={fieldErrors.confirm}>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                invalid={Boolean(fieldErrors.confirm)}
              />
            </Field>
            <Button type="submit" block size="lg" loading={loading}>
              Create account
            </Button>
          </form>

          <p className="mt-6 text-sm text-ink-muted">
            Already have an account?{" "}
            <Link
              to={`/login${window.location.search}`}
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
