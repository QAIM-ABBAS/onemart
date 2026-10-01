import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { FOOTER_LINKS } from "@/content/home";
import { useCategories } from "@/hooks/queries/catalog";
import { isStaff, useAuth } from "@/stores/auth";
import { toast } from "@/stores/toast";

import { Button } from "@/components/ui/Button";

const PAYMENTS = ["UPI", "Visa", "Mastercard", "RuPay", "Cash on delivery"] as const;

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
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="border-b border-line bg-accent-soft">
        <div className="page flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="label text-forest">Newsletter</p>
            <p className="mt-1.5 font-display text-xl font-semibold">
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
              className="h-11 w-full border border-line-strong bg-surface px-3.5 text-sm placeholder:text-ink-soft/70 focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf/40"
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
            <span className="grid size-8 place-items-center bg-forest font-display text-sm font-semibold text-paper">
              M
            </span>
            <span className="font-display text-2xl font-semibold tracking-tight">OneMart</span>
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Everything you need, in one place — groceries, home care and daily essentials,
            delivered with cash on delivery.
          </p>
          <p className="mt-4 text-sm text-ink-soft">
            <span className="label block text-ink">Support 24/7</span>
            <a href="tel:1800000000" className="num mt-1 block hover:text-leaf">
              1800 000 000
            </a>
            <a href="mailto:hello@onemart.example" className="mt-0.5 block hover:text-leaf">
              hello@onemart.example
            </a>
          </p>
        </div>

        <div>
          <p className="label text-ink-soft">Shop</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/products" className="text-ink-soft transition-colors hover:text-leaf">
                All products
              </Link>
            </li>
            {top.map((cat) => (
              <li key={cat.id}>
                <Link
                  to={`/products?category=${cat.slug}`}
                  className="text-ink-soft transition-colors hover:text-leaf"
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {FOOTER_LINKS.map((column) => (
          <div key={column.title}>
            <p className="label text-ink-soft">{column.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.href}
                    className="text-ink-soft transition-colors hover:text-leaf"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.title === "Account" && user && isStaff(user) ? (
                <li>
                  <Link to="/admin/products" className="text-ink-soft hover:text-leaf">
                    Admin console
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="page flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <p className="text-[0.75rem] text-ink-soft">
            © {new Date().getFullYear()} OneMart. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-2">
            {PAYMENTS.map((method) => (
              <li
                key={method}
                className="label border border-line-strong px-2 py-1 text-[0.625rem] text-ink-soft"
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
