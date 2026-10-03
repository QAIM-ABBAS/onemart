import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { STATIC_NAV } from "@/content/home";
import { useCart } from "@/hooks/queries/cart";
import { useCategories } from "@/hooks/queries/catalog";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useWishlist } from "@/hooks/useWishlist";
import { cn } from "@/lib/cn";
import { money, roleName } from "@/lib/format";
import { isStaff, useAuth } from "@/stores/auth";

import {
  BagIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  HeartIcon,
  MenuIcon,
  PhoneIcon,
} from "@/components/ui/Icon";

import { AccountMenu } from "./AccountMenu";
import { MegaMenu } from "./MegaMenu";
import { MiniCart } from "./MiniCart";
import { SearchBar } from "./SearchBar";

function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid size-9 place-items-center rounded-md bg-brand-600 text-surface font-display text-[1rem] leading-none font-semibold">
        M
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.35rem] font-semibold tracking-tight text-surface">
          OneMart
        </span>
        <span className="mt-1 hidden text-[0.625rem] tracking-[0.12em] text-brand-200 uppercase lg:block">
          Everything you need, in one place
        </span>
      </span>
    </span>
  );
}

function Hotline() {
  return (
    <a href="tel:1800000000" className="hidden items-center gap-2.5 xl:flex">
      <span className="grid size-9 place-items-center rounded-md bg-brand-800 text-brand-200">
        <PhoneIcon width={17} height={17} />
      </span>
      <span className="leading-tight whitespace-nowrap">
        <span className="num block text-sm font-semibold text-surface">1800 000 000</span>
        <span className="block text-[0.6875rem] text-brand-200">Support 24/7</span>
      </span>
    </a>
  );
}

function CartButton({ onOpen }: { onOpen: () => void }) {
  const cart = useCart();
  const count = cart.data?.item_count ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open cart, ${count} item${count === 1 ? "" : "s"}`}
      className="flex h-10 items-center gap-2.5 rounded-md border border-brand-700 bg-brand-800 px-3 text-brand-50 transition hover:bg-brand-700"
    >
      <span className="relative">
        <BagIcon width={19} height={19} />
        {count > 0 ? (
          <span className="num absolute -end-2 -top-2 grid min-w-4 place-items-center rounded-full bg-surface px-1 py-0.5 text-[0.6rem] font-semibold text-ink">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </span>
      <span className="hidden text-start leading-tight lg:block">
        <span className="block text-[0.6rem] tracking-[0.1em] text-brand-200 uppercase">Basket</span>
        <span className="num block text-[0.8125rem] font-semibold">
          {money(cart.data?.total ?? 0)}
        </span>
      </span>
    </button>
  );
}

function WishlistLink() {
  const wishlist = useWishlist();
  return (
    <Link
      to="/products"
      aria-label={`Wishlist, ${wishlist.count} item${wishlist.count === 1 ? "" : "s"}`}
      className="relative hidden size-10 place-items-center rounded-md border border-brand-700 bg-brand-800 text-brand-50 transition hover:bg-brand-700 sm:grid"
    >
      <HeartIcon width={18} height={18} />
      {wishlist.count > 0 ? (
        <span className="num absolute -end-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-surface px-1 py-0.5 text-[0.6rem] font-semibold text-ink">
          {wishlist.count > 99 ? "99+" : wishlist.count}
        </span>
      ) : null}
    </Link>
  );
}

function RecentlyViewed() {
  const [open, setOpen] = useState(false);
  const items = useRecentlyViewed();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-brand-700 bg-brand-800 px-3 text-[0.8125rem] font-medium text-brand-50 transition hover:bg-brand-700"
      >
        <ClockIcon width={15} height={15} className="text-brand-200" />
        <span className="hidden lg:inline">Recently viewed</span>
        <ChevronDownIcon
          width={13}
          height={13}
          className={cn("text-brand-200 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Recently viewed products"
          className="absolute end-0 top-[calc(100%+8px)] z-50 w-80 overflow-hidden rounded-md border border-line bg-surface shadow-panel"
        >
          <p className="label px-4 pb-2.5 pt-3.5 text-ink-muted">Recently viewed</p>
          {items.length === 0 ? (
            <p className="px-4 py-5 text-sm text-ink-muted">
              Products you open will show up here for quick access.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-line">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/p/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden bg-surface-2 text-[0.6rem] font-semibold text-brand-700">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        item.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.name}</span>
                      <span className="num block text-[0.6875rem] text-ink-muted">
                        {money(item.price)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Header — box hierarchy (parent → children):
 *
 *   header            column of rows (sticky)
 *   ├─ header-bar     row: menu · brand · search · actions
 *   ├─ search-row     row: the search box, below md only
 *   └─ category-nav   row: shop button · links · recently viewed
 *
 * Each row is its own flex row, so the header is a stack of rows rather than
 * one long line. Below md the search is the one box that moves out of the top
 * row into its own row — that is what lets the header fit a phone.
 */
export function Header() {
  const { data: categories } = useCategories();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setMegaOpen(false);
    setCartOpen(false);
  }, [location.pathname, location.search]);

  const topCategories = categories ?? [];

  return (
    <header className="sticky top-0 z-40">
      <div className="border-b border-brand-800 bg-brand-900/95 backdrop-blur">
        <div className="page flex min-h-16 items-center gap-3 py-3 sm:gap-5">
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
            className="grid size-10 shrink-0 place-items-center rounded-md border border-brand-700 bg-brand-800 text-brand-50 transition hover:bg-brand-700 lg:hidden"
          >
            {mobileOpen ? <CloseIcon width={18} height={18} /> : <MenuIcon width={18} height={18} />}
          </button>

          <Link to="/" aria-label="OneMart home" className="shrink-0">
            <BrandMark />
          </Link>

          {/* flex-grow fills the leftover space in the row, min-w-0 lets the box
              shrink again, max-width keeps the field a sensible reading width */}
          <div className="hidden min-w-0 md:block md:max-w-2xl md:flex-1">
            <SearchBar />
          </div>

          <div className="ms-auto flex items-center gap-2 md:ms-0">
            <Hotline />
            <AccountMenu />
            <WishlistLink />
            <CartButton onOpen={() => setCartOpen(true)} />
          </div>
        </div>

        <div className="page pb-3 md:hidden">
          <SearchBar />
        </div>

        <nav aria-label="Main" className="relative hidden lg:block">
          <div className="page flex items-center gap-1 py-2">
            <button
              type="button"
              onClick={() => setMegaOpen((value) => !value)}
              aria-expanded={megaOpen}
              aria-haspopup="dialog"
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-[0.8125rem] font-semibold text-surface transition hover:bg-brand-700",
                megaOpen && "bg-brand-400 text-brand-900",
              )}
            >
              <MenuIcon width={16} height={16} />
              Shop by category
              <ChevronRightIcon
                width={14}
                height={14}
                className={cn("transition-transform", megaOpen && "rotate-90")}
              />
            </button>

            <ul className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto ms-2 hide-scrollbar">
              {STATIC_NAV.map((item) => (
                <li key={item.label}>
                  <NavLink
                    to={item.href}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex h-10 items-center whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-medium transition",
                        isActive
                          ? "bg-brand-800 font-semibold text-surface"
                          : "text-brand-200 hover:bg-brand-800 hover:text-surface",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
              {topCategories.slice(0, 3).map((cat) => (
                <li key={cat.id}>
                  <NavLink
                    to={`/products?category=${cat.slug}`}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex h-10 items-center whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-medium transition",
                        isActive
                          ? "bg-brand-800 font-semibold text-surface"
                          : "text-brand-200 hover:bg-brand-800 hover:text-surface",
                      )
                    }
                  >
                    {cat.name}
                  </NavLink>
                </li>
              ))}
            </ul>

            {/* the link list is the flex-grow box; this stays its natural width */}
            <div className="shrink-0 ps-3">
              <RecentlyViewed />
            </div>
          </div>

          <MegaMenu open={megaOpen} onClose={() => setMegaOpen(false)} />
        </nav>
      </div>

      {mobileOpen ? (
        <div className="border-b border-brand-800 bg-brand-900 text-brand-50 lg:hidden">
          <div className="page py-4">
            <div className="flex flex-col divide-y divide-brand-800">
              <Link to="/products" className="py-3 text-sm font-medium">
                All products
              </Link>
              {STATIC_NAV.slice(1).map((item) => (
                <Link key={item.label} to={item.href} className="py-3 text-sm font-medium">
                  {item.label}
                </Link>
              ))}
              {topCategories.map((cat) => (
                <div key={cat.id} className="py-2.5">
                  <Link
                    to={`/products?category=${cat.slug}`}
                    className="block py-1.5 text-sm font-medium"
                  >
                    {cat.name}
                  </Link>
                  {cat.children && cat.children.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 ps-3">
                      {cat.children.map((child) => (
                        <Link
                          key={child.id}
                          to={`/products?category=${child.slug}`}
                          className="py-1 text-[0.8125rem] text-brand-200"
                        >
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="py-3">
                <RecentlyViewed />
              </div>
              {user ? (
                <>
                  <Link to="/orders" className="py-3 text-sm font-medium">
                    My orders
                  </Link>
                  <p className="py-2 text-[0.8125rem] text-brand-200">
                    Signed in as {user.full_name} · {roleName(user.role)}
                  </p>
                  {isStaff(user) ? (
                    <Link to="/admin/products" className="py-3 text-sm font-medium">
                      Admin console
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="py-3 text-start text-sm font-medium text-brand-200 transition-colors hover:text-surface"
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

      <MiniCart open={cartOpen} onClose={() => setCartOpen(false)} />
    </header>
  );
}
