import { useState, type FormEvent } from "react";

import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";

import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/States";

export function SignupPromoCard({ className }: { className?: string }) {
  const { register, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    const local = email.trim().split("@")[0];
    const fullName =
      local
        .replace(/[._\-+]+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase()) || "OneMart Shopper";
    setLoading(true);
    try {
      await register(email.trim(), password, fullName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-9 w-full border border-line bg-surface px-3 text-[0.8125rem] text-ink placeholder:text-ink-soft/70 focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf/40";

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden border border-line bg-accent-soft p-4",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,var(--color-forest)_0_10px,transparent_10px_20px)]"
      />
      <div className="pt-3">
        <p className="font-display text-2xl leading-none font-semibold text-forest">15% OFF</p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-soft">
          For new members — take 15% off your first order.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-2" noValidate>
        {error ? <InlineError>{error}</InlineError> : null}
        <label htmlFor="promo-email" className="sr-only">
          Email address
        </label>
        <input
          id="promo-email"
          type="email"
          required
          autoComplete="email"
          placeholder="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
        <label htmlFor="promo-password" className="sr-only">
          Password
        </label>
        <input
          id="promo-password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
        <label htmlFor="promo-confirm" className="sr-only">
          Re-type password
        </label>
        <input
          id="promo-confirm"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Re-type password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={inputClass}
        />
        <Button type="submit" block size="sm" loading={loading} className="mt-1 h-9 px-3">
          Register now
        </Button>
      </form>
    </div>
  );
}
