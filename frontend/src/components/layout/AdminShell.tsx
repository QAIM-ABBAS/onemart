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
  if (mobile) {
    return cn(
      "label flex items-center gap-2 border-b-2 px-3 py-3 whitespace-nowrap",
      isActive ? "border-forest text-forest" : "border-transparent text-ink-soft hover:text-ink",
    );
  }
  return cn(
    "flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium transition-colors",
    isActive ? "bg-forest text-paper" : "text-ink hover:bg-mist",
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2.5">
              <span className="grid size-7 place-items-center bg-forest text-paper font-display text-[0.9rem] leading-none font-semibold">
                M
              </span>
              <span className="font-display text-lg font-semibold tracking-tight">OneMart</span>
            </Link>
            <span className="label border border-line-strong px-2 py-1 text-ink-soft">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden items-center gap-2 text-sm text-ink-soft hover:text-ink sm:inline-flex"
            >
              <StoreIcon width={16} height={16} />
              View storefront
            </Link>
            <span className="hidden text-sm text-ink-soft md:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="h-9 rounded-sm border border-line-strong bg-surface px-3 text-sm transition-colors hover:border-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 border-r border-line bg-surface py-4 md:block">
          <nav className="flex flex-col gap-1 px-3" aria-label="Admin">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
                <item.icon width={17} height={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <nav
            aria-label="Admin"
            className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 md:hidden"
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
