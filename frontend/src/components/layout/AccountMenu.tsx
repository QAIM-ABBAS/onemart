import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { cn } from "@/lib/cn";
import { roleName } from "@/lib/format";
import { isStaff, useAuth } from "@/stores/auth";

import { ChevronDownIcon, UserIcon } from "@/components/ui/Icon";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) {
    return (
      <NavLink
        to="/login"
        className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-brand-700 bg-brand-800 px-3 text-sm font-medium text-brand-50 transition hover:bg-brand-700 sm:inline-flex"
      >
        <UserIcon width={17} height={17} />
        Sign in
      </NavLink>
    );
  }

  const initials = user.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 items-center gap-2 rounded-md border border-brand-700 bg-brand-800 px-2.5 text-sm text-brand-50 transition hover:bg-brand-700"
      >
        <span className="grid size-6 place-items-center rounded-full bg-surface text-[0.65rem] font-semibold text-brand-900">
          {initials}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.full_name.split(" ")[0]}</span>
        <ChevronDownIcon
          width={14}
          height={14}
          className="hidden text-brand-200 sm:block"
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-[calc(100%+6px)] w-56 overflow-hidden rounded-md border border-line bg-surface shadow-panel"
        >
          <div className="border-b border-line bg-surface px-4 pb-3 pt-3.5">
            <p className="truncate text-sm font-medium">{user.full_name}</p>
            <p className="truncate text-[0.8125rem] text-ink-muted">{user.email}</p>
            <p className={cn("label mt-1.5 text-ink-muted")}>{roleName(user.role)}</p>
          </div>
          <div className="py-1">
            <Link
              to="/orders"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
              role="menuitem"
            >
              My orders
            </Link>
            <Link
              to="/wishlist"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
              role="menuitem"
            >
              Wishlist
            </Link>
            {isStaff(user) ? (
              <Link
                to="/admin/products"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                role="menuitem"
              >
                Admin console
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-danger transition-colors hover:bg-danger/5"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
