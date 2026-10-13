import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/stores/auth";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { CheckIcon } from "@/components/ui/Icon";
import { InlineError } from "@/components/ui/States";

function AuthAside({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation("auth");
  const points =
    mode === "login"
      ? [
          t("login.aside.track"),
          t("login.aside.save"),
          t("login.aside.reorder"),
        ]
      : [
          t("register.aside.cod"),
          t("register.aside.free"),
          t("register.aside.history"),
        ];
  return (
    <aside className="hidden bg-brand-700 px-10 py-12 text-surface lg:flex lg:flex-col lg:justify-between">
      <div>
        <p className="font-display text-2xl font-semibold tracking-tight">OneMart</p>
        <p className="label mt-1 text-surface/50">{t("nav:brand.tagline")}</p>
      </div>
      <div>
        <h2 className="text-3xl leading-tight text-surface">
          {mode === "login" ? t("login.aside.title") : t("register.aside.title")}
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
        {t("auth.aside.categories")}
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
  const { t } = useTranslation("auth");
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
      setError(err instanceof ApiError ? err.message : t("login.errors.general"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 lg:py-14">
      <div className="grid overflow-hidden rounded-md bg-surface border border-line lg:grid-cols-2">
        <AuthAside mode="login" />
        <div className="px-6 py-10 sm:px-10">
          <p className="label text-brand-600">{t("login.eyebrow")}</p>
          <h1 className="mt-2 text-3xl">{t("login.title")}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t("login.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error ? <InlineError>{error}</InlineError> : null}
            <Field label={t("login.email")} htmlFor="email">
              <Input
                id="email"
                type="email"
                dir="ltr"
                required
                autoComplete="email"
                placeholder={t("login.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t("login.password")} htmlFor="password">
              <Input
                id="password"
                type="password"
                dir="ltr"
                required
                autoComplete="current-password"
                placeholder={t("login.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" block size="lg" loading={loading}>
              {t("login.submit")}
            </Button>
          </form>

          <p className="mt-6 text-sm text-ink-muted">
            {t("login.registerLink")}{" "}
            <Link
              to={`/register${window.location.search}`}
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              {t("login.registerAction")}
            </Link>
          </p>

          <div className="mt-6 rounded-md bg-surface-2/50 px-4 py-4 ">
            <p className="label text-ink-muted">{t("login.demoTitle")}</p>
            <div className="mt-2 space-y-1 text-[0.8125rem] text-ink-muted">
              <p dangerouslySetInnerHTML={{ __html: t("login.demoCustomer") }} />
              <p dangerouslySetInnerHTML={{ __html: t("login.demoAdmin") }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation("auth");
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
    if (fullName.trim().length < 2) errors.full_name = t("register.errors.fullName");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = t("register.errors.email");
    if (password.length < 8) errors.password = t("register.errors.password");
    if (password !== confirm) errors.confirm = t("register.errors.confirm");
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
          <p className="label text-brand-600">{t("register.eyebrow")}</p>
          <h1 className="mt-2 text-3xl">{t("register.title")}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t("register.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error ? <InlineError>{error}</InlineError> : null}
            <Field label={t("register.fullName")} htmlFor="full_name" error={fieldErrors.full_name}>
              <Input
                id="full_name"
                dir="auto"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                invalid={Boolean(fieldErrors.full_name)}
              />
            </Field>
            <Field label={t("register.email")} htmlFor="reg_email" error={fieldErrors.email}>
              <Input
                id="reg_email"
                type="email"
                dir="ltr"
                required
                autoComplete="email"
                placeholder={t("register.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={Boolean(fieldErrors.email)}
              />
            </Field>
            <Field
              label={t("register.password")}
              htmlFor="reg_password"
              error={fieldErrors.password}
              hint={t("register.passwordHint")}
            >
              <Input
                id="reg_password"
                type="password"
                dir="ltr"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={Boolean(fieldErrors.password)}
              />
            </Field>
            <Field label={t("register.confirmPassword")} htmlFor="confirm" error={fieldErrors.confirm}>
              <Input
                id="confirm"
                type="password"
                dir="ltr"
                required
                autoComplete="new-password"
                placeholder={t("register.confirmPlaceholder")}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                invalid={Boolean(fieldErrors.confirm)}
              />
            </Field>
            <Button type="submit" block size="lg" loading={loading}>
              {t("register.submit")}
            </Button>
          </form>

          <p className="mt-6 text-sm text-ink-muted">
            {t("register.loginLink")}{" "}
            <Link
              to={`/login${window.location.search}`}
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              {t("register.loginAction")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
