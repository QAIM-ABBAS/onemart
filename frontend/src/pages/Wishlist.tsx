import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Stars } from "@/components/reviews/Stars";
import { useAddToCart } from "@/hooks/queries/cart";
import { useToggleWishlist, useWishlistList } from "@/hooks/queries/wishlist";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { WishlistItem } from "@/lib/types";
import { toast } from "@/stores/toast";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select } from "@/components/ui/Form";
import { HeartIcon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Price } from "@/components/ui/Price";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";

const PAGE_SIZE = 12;

const SORT_OPTIONS = [
  { value: "recent", label: "Recently saved" },
  { value: "oldest", label: "Oldest saved" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name", label: "Name A–Z" },
];

/** Live stock state, same three tints the product page uses. */
function StockBadge({ item }: { item: WishlistItem }) {
  if (!item.in_stock) return <Badge tone="negative">Out of stock</Badge>;
  if (item.available <= 10) return <Badge tone="warning">Only {item.available} left</Badge>;
  return <Badge tone="positive">In stock</Badge>;
}

function WishlistCard({
  item,
  onRemove,
  onAddToCart,
}: {
  item: WishlistItem;
  onRemove: () => void;
  onAddToCart: () => void;
}) {
  return (
    <article className="group relative flex h-full flex-col rounded-md border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="relative">
        <Link
          to={`/p/${item.slug}`}
          aria-label={item.name}
          className="block aspect-square overflow-hidden rounded-t-md bg-surface-2"
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="grid h-full w-full place-items-center font-display text-4xl text-brand-700/25">
              {item.name
                .split(/\s+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
          )}
        </Link>

        {item.discount_percent ? (
          <span className="label absolute start-2 top-2 rounded-xs bg-deal px-2 py-0.5 text-surface">
            {item.discount_percent}% off
          </span>
        ) : null}

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name} from wishlist`}
          className="absolute end-2 top-2 z-10 grid size-8 place-items-center rounded-full border border-line bg-surface/95 text-danger transition hover:shadow-lift"
        >
          <HeartIcon width={16} height={16} fill="currentColor" />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-lg leading-snug font-bold text-ink">
          <Link
            to={`/p/${item.slug}`}
            className="transition-colors hover:text-brand-600 focus-visible:text-brand-600"
          >
            {item.name}
          </Link>
        </h3>

        {item.rating_count > 0 ? (
          <div className="mt-2 flex items-center gap-1.5">
            <Stars rating={item.rating_avg} size={13} />
            <span className="num text-[0.6875rem] text-ink-muted">
              {item.rating_avg.toFixed(1)} ({item.rating_count})
            </span>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-baseline gap-2">
          <Price value={item.price} compareAt={item.compare_at_price} />
          <StockBadge item={item} />
        </div>

        {/* The price is already on the row above — this line is unit meta. */}
        <p className="num mt-1 text-[0.8125rem] text-ink-muted">
          {item.in_stock ? `${item.available} in stock` : "\u00a0"}
        </p>

        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button
            className="flex-1 min-w-32"
            disabled={!item.in_stock}
            onClick={onAddToCart}
          >
            {item.in_stock ? "Add to cart" : "Out of stock"}
          </Button>
          <Link to={`/p/${item.slug}`}>
            <Button variant="secondary">View</Button>
          </Link>
        </div>
      </div>
    </article>
  );
}

function CardSkeleton() {
  return (
    <div className="h-full rounded-md border border-line bg-surface">
      <Skeleton className="aspect-square rounded-t-md" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}

export function WishlistPage() {
  const [sp, setSp] = useSearchParams();
  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "recent",
    q: sp.get("q") ?? undefined,
    in_stock: sp.get("in_stock") === "1",
  };
  const wishlist = useWishlistList(params);
  const remove = useToggleWishlist();
  const addToCart = useAddToCart();
  const navigate = useNavigate();
  // The product whose options the customer still has to pick.
  const [picking, setPicking] = useState<WishlistItem | null>(null);

  const hasFilters = Boolean(params.q) || params.in_stock;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  async function addVariant(item: WishlistItem, variantId: number) {
    try {
      await addToCart.mutateAsync({ variant_id: variantId, quantity: 1 });
      toast(`Added ${item.name} to your cart.`, {
        tone: "positive",
        action: { label: "Go to cart", onClick: () => navigate("/cart") },
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add that to your cart.", {
        tone: "negative",
      });
    }
  }

  function handleAdd(item: WishlistItem) {
    if (item.variants.length > 1) {
      setPicking(item);
      return;
    }
    const variant = item.variants[0];
    if (!variant) return;
    if (variant.available <= 0) {
      toast("That option is out of stock right now.", { tone: "negative" });
      return;
    }
    void addVariant(item, variant.id);
  }

  const items = wishlist.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-brand-600">Your account</p>
          <h1 className="mt-1.5 text-3xl">Wishlist</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {wishlist.data
              ? `${wishlist.data.total} saved item${wishlist.data.total === 1 ? "" : "s"}`
              : "Everything you have saved for later."}
          </p>
        </div>

        {/* The fields are `w-full` by design, so their footprint is set by a
            wrapper — `cn` is a plain joiner, a width class on the field itself
            would lose to `fieldBase`'s `w-full` in the stylesheet. */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-2">
          <Checkbox
            label="In stock only"
            checked={params.in_stock}
            onChange={(e) => update({ in_stock: e.target.checked ? "1" : undefined })}
            className="px-1 text-ink-muted"
          />
          <div className="w-44">
            <Input
              type="search"
              value={params.q ?? ""}
              onChange={(e) => update({ q: e.target.value || undefined })}
              placeholder="Search saved items"
              aria-label="Search your wishlist"
              className="h-9 text-sm"
            />
          </div>
          <div className="w-48">
            <Select
              value={params.sort}
              onChange={(e) => update({ sort: e.target.value })}
              aria-label="Sort wishlist"
              className="h-9 text-sm"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {wishlist.isLoading ? (
          <div className="card-grid-fill">
            {Array.from({ length: 8 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : wishlist.isError ? (
          <ErrorState error={wishlist.error} onRetry={() => void wishlist.refetch()} />
        ) : items.length > 0 ? (
          <>
            <div className="card-grid-fill">
              {items.map((item) => (
                <WishlistCard
                  key={item.id}
                  item={item}
                  onRemove={() => remove.mutate({ productId: item.product_id, saved: false })}
                  onAddToCart={() => handleAdd(item)}
                />
              ))}
            </div>
            <Pagination
              className="mt-6"
              page={wishlist.data!.page}
              pages={wishlist.data!.pages}
              total={wishlist.data!.total}
              pageSize={wishlist.data!.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : hasFilters ? (
          <EmptyState
            title="No saved items match"
            body="Try a different search, or show everything that is in stock."
            action={
              <Button variant="secondary" onClick={() => setSp(new URLSearchParams())}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Nothing saved yet"
            body="Tap the heart on any product and it will wait for you here — with its current price and stock."
            action={
              <Link to="/products">
                <Button>Browse products</Button>
              </Link>
            }
          />
        )}
      </div>

      <Modal
        open={picking !== null}
        onClose={() => setPicking(null)}
        title="Choose an option"
        description={picking ? picking.name : undefined}
      >
        {picking ? (
          <div className="flex flex-wrap gap-2">
            {picking.variants.map((variant) => {
              const soldOut = variant.available <= 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => {
                    void addVariant(picking, variant.id);
                    setPicking(null);
                  }}
                  className={cn(
                    "flex min-w-32 flex-col items-start gap-0.5 rounded-md border border-line px-3.5 py-2.5 text-left transition",
                    soldOut ? "bg-surface opacity-55" : "bg-surface hover:bg-surface-2",
                  )}
                >
                  <span className="text-sm font-medium text-ink">{variant.name}</span>
                  <span className="num text-[0.8125rem] text-ink-muted">
                    {money(variant.price)}
                  </span>
                  {soldOut ? <span className="label mt-0.5 text-danger">Sold out</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
