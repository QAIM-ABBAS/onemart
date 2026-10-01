import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { ProductListItem } from "@/lib/types";
import { useQuickAdd } from "@/hooks/useQuickAdd";
import { useWishlist } from "@/hooks/useWishlist";

import { Price, QuantityStepper } from "@/components/ui/Price";
import { Skeleton } from "@/components/ui/States";

const canHover = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

function FallbackImage({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="grid h-full w-full place-items-center bg-mist">
      <span className="font-display text-4xl font-semibold text-forest/25 select-none">
        {initials}
      </span>
    </div>
  );
}

function WishlistButton({ productId, name }: { productId: number; name: string }) {
  const wishlist = useWishlist();
  const saved = wishlist.has(productId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        wishlist.toggle(productId);
      }}
      className={cn(
        "absolute end-2 top-2 z-20 grid size-8 place-items-center rounded-full border border-line bg-surface/95 text-ink-soft transition-all",
        "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        saved ? "text-sale" : "hover:text-sale",
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" />
      </svg>
    </button>
  );
}

function StockBar({ sold, stock }: { sold: number; stock: number }) {
  const safeStock = Math.max(stock, sold, 1);
  const pct = Math.min(100, Math.round((sold / safeStock) * 100));
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist">
        <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
      <p className="label mt-1.5 text-ink-soft">
        Sold <span className="num">{sold}</span>/<span className="num">{stock}</span>
      </p>
    </div>
  );
}

export interface ProductCardProps {
  item: ProductListItem;
  className?: string;
  deal?: { sold: number; stock: number };
}

export function ProductCard({ item, className, deal }: ProductCardProps) {
  const quickAdd = useQuickAdd();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [hoverable] = useState(canHover);

  const discount =
    item.compare_at_price && item.compare_at_price > item.price
      ? Math.round(((item.compare_at_price - item.price) / item.compare_at_price) * 100)
      : 0;

  async function addToCart() {
    setAdding(true);
    try {
      await quickAdd(item, qty);
      setQty(1);
    } finally {
      setAdding(false);
    }
  }

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col border border-line bg-surface transition-shadow duration-200",
        "hover:shadow-card focus-within:z-30 hover:z-30",
        className,
      )}
    >
      <div className="relative">
        <Link
          to={`/p/${item.slug}`}
          aria-label={item.name}
          className="block aspect-[4/3] overflow-hidden bg-mist"
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              width={400}
              height={300}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <FallbackImage name={item.name} />
          )}
        </Link>

        {discount > 0 ? (
          <span className="label absolute start-2 top-2 z-10 bg-sale px-2 py-1 text-paper">
            Save {discount}%
          </span>
        ) : null}

        {!item.in_stock ? (
          <span className="label absolute inset-x-0 bottom-0 z-10 bg-ink/85 py-1.5 text-center text-paper">
            Out of stock
          </span>
        ) : null}

        <WishlistButton productId={item.id} name={item.name} />
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <p className="label text-ink-soft">{item.brand ?? item.category}</p>
        <h3 className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-snug font-medium">
          <Link
            to={`/p/${item.slug}`}
            className="transition-colors hover:text-leaf focus-visible:text-leaf"
          >
            {item.name}
          </Link>
        </h3>

        <div className="mt-auto pt-2.5">
          <div className="flex items-end justify-between gap-2">
            <Price value={item.price} compareAt={item.compare_at_price} size="md" />
            {item.variant_count > 1 ? (
              <span className="shrink-0 text-[0.6875rem] text-ink-soft">
                {item.variant_count} options
              </span>
            ) : null}
          </div>
          {deal ? <StockBar sold={deal.sold} stock={deal.stock} /> : null}
        </div>

        {!hoverable && item.in_stock ? (
          <button
            type="button"
            onClick={() => void addToCart()}
            disabled={adding}
            className="label mt-3 h-9 w-full bg-forest text-paper transition-colors hover:bg-ink disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add to basket"}
          </button>
        ) : null}
      </div>

      {item.in_stock && hoverable ? (
        <div className="absolute inset-x-0 top-full z-40 hidden border border-line bg-surface p-3.5 shadow-panel group-focus-within:block group-hover:block">
          <div className="flex items-center justify-between gap-3">
            <QuantityStepper
              compact
              value={qty}
              onChange={setQty}
              min={1}
              max={99}
              className="shrink-0"
            />
            <span className="num text-sm text-ink-soft">
              Total: <span className="font-semibold text-ink">{money(item.price * qty)}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => void addToCart()}
            disabled={adding}
            className="label mt-3 h-10 w-full bg-forest text-paper transition-colors hover:bg-ink disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add to basket"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="h-full border border-line bg-surface">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2.5 p-3.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-5 w-24 mt-3" />
      </div>
    </div>
  );
}

export function ProductGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 4 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 md:grid-cols-3",
        columns === 4 ? "xl:grid-cols-4" : "",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProductGridSkeleton({
  count = 8,
  columns = 4,
  className,
}: {
  count?: number;
  columns?: 4 | 3;
  className?: string;
}) {
  return (
    <ProductGrid columns={columns} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </ProductGrid>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  href,
  linkLabel = "See all",
  className,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 border-b border-ink/15 pb-3", className)}>
      <div>
        {eyebrow ? <p className="label text-leaf">{eyebrow}</p> : null}
        <h2 className="mt-1.5 text-2xl sm:text-[1.75rem]">{title}</h2>
      </div>
      {href ? (
        <Link
          to={href}
          className="label border-b border-ink/30 pb-0.5 text-ink transition-colors hover:border-leaf hover:text-leaf"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
