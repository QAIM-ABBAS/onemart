import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { useCart } from "@/hooks/queries/cart";
import { useCategories } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";
import { roleName } from "@/lib/format";
import { isStaff, useAuth } from "@/stores/auth";

import {
  BagIcon,
  ChevronDownIcon,
  CloseIcon,
  MenuIcon,
  SearchIcon,
  UserIcon,
} from "@/components/ui/Icon";

function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid size-7 place-items-center bg-forest text-paper font-display text-[0.9rem] leading-none font-semibold">
        M
      </span>
      <span className="font-display text-[1.35rem] font-semibold tracking-tight text-ink">
        OneMart
      </span>
    </span>
  );
}

function SearchForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    navigate(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
  }
  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full">
      <SearchIcon
        width={16}
        height={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none"
      />
      <input
        type="search"
        value={term}
        autoFocus={autoFocus}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search for atta, dal, soap…"
        aria-label="Search products"
        className="h-10 w-full rounded-sm border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-ink-soft/70 focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf/40"
      />
    </form>
  );
}

function AccountMenu() {
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
        className="hidden items-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-3 h-10 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface sm:inline-flex"
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
        className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 text-sm transition-colors hover:border-ink"
      >
        <span className="grid size-6 place-items-center bg-forest text-paper text-[0.65rem] font-semibold">
          {initials}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.full_name.split(" ")[0]}</span>
        <ChevronDownIcon width={14} height={14} className="text-ink-soft" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] w-56 border border-line bg-surface shadow-[0_14px_36px_-14px_rgba(22,33,27,0.3)]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium">{user.full_name}</p>
            <p className="truncate text-[0.8125rem] text-ink-soft">{user.email}</p>
            <p className="label mt-1.5 text-ink-soft">{roleName(user.role)}</p>
          </div>
          <div className="py-1">
            <Link
              to="/orders"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm hover:bg-mist"
              role="menuitem"
            >
              My orders
            </Link>
            {isStaff(user) ? (
              <Link
                to="/admin/products"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm hover:bg-mist"
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
              className="block w-full px-4 py-2.5 text-left text-sm text-brick hover:bg-brick/5"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const cart = useCart();
  const { data: categories } = useCategories();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const itemCount = cart.data?.item_count ?? 0;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const topCategories = categories ?? [];

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-forest text-paper">
        <div className="mx-auto flex h-8 max-w-7xl items-center justify-between gap-4 px-4">
          <p className="label text-[0.625rem] text-paper/90">
            Everything you need, in one place.
          </p>
          <p className="label hidden text-[0.625rem] text-paper/60 sm:block">
            Free delivery over ₹999 · Cash on delivery
          </p>
        </div>
      </div>

      <div className="border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-5">
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="grid size-10 place-items-center border border-line-strong bg-surface text-ink lg:hidden"
          >
            {mobileOpen ? <CloseIcon width={18} height={18} /> : <MenuIcon width={18} height={18} />}
          </button>

          <Link to="/" aria-label="OneMart home" className="shrink-0">
            <BrandMark />
          </Link>

          <div className="mx-auto hidden w-full max-w-xl md:block">
            <SearchForm />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <AccountMenu />
            <Link
              to="/cart"
              aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
              className="relative grid size-10 place-items-center border border-line-strong bg-surface text-ink transition-colors hover:border-ink"
            >
              <BagIcon width={19} height={19} />
              {itemCount > 0 ? (
                <span className="num absolute -right-2 -top-2 grid min-w-5 place-items-center rounded-full bg-forest px-1 py-0.5 text-[0.65rem] font-semibold text-paper">
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              ) : null}
            </Link>
          </div>
        </div>

        <nav aria-label="Categories" className="hidden border-t border-line lg:block">
          <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4">
            <NavLink
              to="/products"
              end
              className={({ isActive }) =>
                cn(
                  "label border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors",
                  isActive
                    ? "border-forest text-forest"
                    : "border-transparent text-ink-soft hover:text-ink",
                )
              }
            >
              All products
            </NavLink>
            {topCategories.map((cat) => (
              <NavLink
                key={cat.id}
                to={`/products?category=${cat.slug}`}
                className={({ isActive }) =>
                  cn(
                    "label border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors",
                    isActive
                      ? "border-forest text-forest"
                      : "border-transparent text-ink-soft hover:text-ink",
                  )
                }
              >
                {cat.name}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>

      {mobileOpen ? (
        <div className="border-b border-line bg-surface lg:hidden">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <SearchForm />
            <div className="mt-4 flex flex-col divide-y divide-line border-y border-line">
              <Link to="/products" className="py-3 text-sm font-medium">
                All products
              </Link>
              {topCategories.map((cat) => (
                <div key={cat.id} className="py-2.5">
                  <Link
                    to={`/products?category=${cat.slug}`}
                    className="block py-1.5 text-sm font-medium"
                  >
                    {cat.name}
                  </Link>
                  {cat.children && cat.children.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pl-3">
                      {cat.children.map((child) => (
                        <Link
                          key={child.id}
                          to={`/products?category=${child.slug}`}
                          className="py-1 text-[0.8125rem] text-ink-soft"
                        >
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {user ? (
                <>
                  <Link to="/orders" className="py-3 text-sm font-medium">
                    My orders
                  </Link>
                  {isStaff(user) ? (
                    <Link to="/admin/products" className="py-3 text-sm font-medium">
                      Admin console
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="py-3 text-left text-sm font-medium text-brick"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link to="/login" className="py-3 text-sm font-medium">
                  Sign in / Create account
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
