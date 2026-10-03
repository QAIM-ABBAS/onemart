import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { cn } from "@/lib/cn";

import {
  BoxesIcon,
  ClipboardIcon,
  FolderIcon,
  PackageIcon,
  StoreIcon,
} from "@/components/ui/Icon";
import { useAuth } from "@/stores/auth";

const NAV = [
  { to: "/admin/products", label: "Products", icon: PackageIcon },
  { to: "/admin/categories", label: "Categories", icon: FolderIcon },
  { to: "/admin/stock", label: "Stock", icon: BoxesIcon },
  { to: "/admin/orders", label: "Orders", icon: ClipboardIcon },
] as const;

function navClass(isActive: boolean, mobile = false): string {
  // Mobile chips sit on the light canvas, the desktop sidebar is brand-900
  // dark chrome — each gets its own active/inactive treatment.
  if (mobile) {
    return cn(
      "label flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 transition",
      isActive
        ? "bg-surface-2 font-semibold text-brand-700"
        : "text-ink-muted hover:bg-surface-2 hover:text-ink",
    );
  }
  return cn(
    "flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm transition",
    isActive
      ? "bg-brand-800 font-semibold text-surface"
      : "font-medium text-brand-200 hover:bg-brand-800 hover:text-surface",
  );
}

/**
 * Admin console shell — box hierarchy (parent → children):
 *
 *   shell                 column: header · body
 *   ├─ header             row: brand group … actions (justify-between)
 *   └─ body               row: sidebar · main
 *       ├─ sidebar        column of nav links (hidden below md)
 *       ├─ mobile-nav     row of nav chips (md and below only)
 *       └─ main           content box, flex-grow fills what is left
 *
 * Sidebar + main is a flex row: the sidebar keeps its own width and the main
 * box grows. Below md the sidebar box is dropped from the flow and its links
 * move into the scrolling row above the content.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-brand-700 text-surface font-display text-[0.9rem] leading-none font-semibold shadow-button ">
                M
              </span>
              <span className="font-display text-lg font-semibold tracking-tight">OneMart</span>
            </Link>
            <span className="label rounded-full bg-surface-2 px-2 py-1 text-ink-muted shadow-pressed">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden items-center gap-2 text-sm text-ink-muted hover:text-ink sm:inline-flex"
            >
              <StoreIcon width={16} height={16} />
              View storefront
            </Link>
            <span className="hidden text-sm text-ink-muted md:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm transition hover:bg-surface-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar + main: one flex row. The sidebar keeps its own width, the
          main box grows to fill whatever is left (flex-grow / flex-basis 0). */}
      <div className="mx-auto flex max-w-[1400px]">
        {/* sticky inside a flex row → self-start keeps it from being stretched */}
        <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 self-start border-e border-brand-800 bg-brand-900 py-4 md:block">
          <nav className="flex flex-col gap-1 px-3" aria-label="Admin">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
                <item.icon width={17} height={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* min-w-0 lets the content box shrink instead of widening the row */}
        <div className="min-w-0 flex-1">
          <nav
            aria-label="Admin"
            className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 md:hidden"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => navClass(isActive, true)}
              >
                <item.icon width={16} height={16} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <main className="px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
