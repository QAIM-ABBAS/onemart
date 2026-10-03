import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { FOOTER_LINKS } from "@/content/home";
import { useCategories } from "@/hooks/queries/catalog";
import { isStaff, useAuth } from "@/stores/auth";
import { toast } from "@/stores/toast";

import { Button } from "@/components/ui/Button";

const PAYMENTS = ["UPI", "Visa", "Mastercard", "RuPay", "Cash on delivery"] as const;

/**
 * Footer — dark chrome: brand-900 surface with brand-50 / brand-200 text.
 * Every colour comes from a design token; cards and panels elsewhere stay
 * white on the #FAF8F4 canvas.
 */
export function Footer() {
  const { data: categories } = useCategories();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const top = (categories ?? []).slice(0, 6);

  function onNewsletter(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setEmail("");
    toast("Thanks — offers are on their way to your inbox.", { tone: "positive" });
  }

  return (
    <footer className="mt-16 border-t border-brand-800 bg-brand-900 text-brand-50">
      <div className="border-b border-brand-800 bg-brand-800">
        <div className="page flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="label text-brand-200">Newsletter</p>
            <p className="mt-1.5 font-display text-xl font-semibold text-surface">
              Weekly offers, straight to your inbox
            </p>
          </div>
          <form onSubmit={onNewsletter} className="flex w-full max-w-md gap-2" noValidate>
            <label htmlFor="newsletter-email" className="sr-only">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-md border-0 bg-surface px-4 text-sm text-ink placeholder:text-ink-faint transition focus:outline-none focus:ring-2 focus:ring-brand-400/60"
            />
            <Button type="submit" className="shrink-0">
              Subscribe
            </Button>
          </form>
        </div>
      </div>

      <div className="page grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-brand-600 font-display text-sm font-semibold text-surface">
              M
            </span>
            <span className="font-display text-2xl font-semibold tracking-tight text-surface">
              OneMart
            </span>
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-brand-200">
            Everything you need, in one place — groceries, home care and daily essentials,
            delivered with cash on delivery.
          </p>
          <p className="mt-4 text-sm text-brand-200">
            <span className="label block text-surface">Support 24/7</span>
            <a href="tel:1800000000" className="num mt-1 block transition-colors hover:text-surface">
              1800 000 000
            </a>
            <a href="mailto:hello@onemart.example" className="mt-0.5 block transition-colors hover:text-surface">
              hello@onemart.example
            </a>
          </p>
        </div>

        <div>
          <p className="label text-brand-200">Shop</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/products" className="text-brand-200 transition-colors hover:text-surface">
                All products
              </Link>
            </li>
            {top.map((cat) => (
              <li key={cat.id}>
                <Link
                  to={`/products?category=${cat.slug}`}
                  className="text-brand-200 transition-colors hover:text-surface"
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {FOOTER_LINKS.map((column) => (
          <div key={column.title}>
            <p className="label text-brand-200">{column.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.href}
                    className="text-brand-200 transition-colors hover:text-surface"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.title === "Account" && user && isStaff(user) ? (
                <li>
                  <Link to="/admin/products" className="text-brand-200 transition-colors hover:text-surface">
                    Admin console
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-brand-800">
        <div className="page flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <p className="text-[0.75rem] text-brand-200">
            © {new Date().getFullYear()} OneMart. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-2">
            {PAYMENTS.map((method) => (
              <li
                key={method}
                className="label rounded-full border border-brand-700 bg-brand-800 px-2 py-1 text-[0.625rem] text-brand-200"
              >
                {method}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
