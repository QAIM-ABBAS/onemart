import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAddToCart } from "@/hooks/queries/cart";
import { useProduct } from "@/hooks/queries/catalog";
import { pushRecent } from "@/hooks/useRecentlyViewed";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";

import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/Icon";
import { Price, QuantityStepper } from "@/components/ui/Price";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/States";

export function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = useProduct(slug);
  const addToCart = useAddToCart();

  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variants = useMemo(() => product.data?.variants ?? [], [product.data]);

  useEffect(() => {
    if (variantId === null && variants.length > 0) {
      const def = variants.find((v) => v.is_default) ?? variants[0];
      setVariantId(def.id);
    }
  }, [variants, variantId]);

  useEffect(() => {
    setImageIndex(0);
    setQty(1);
    setAdded(false);
    setError(null);
    setVariantId(null);
  }, [slug]);

  useEffect(() => {
    const data = product.data;
    if (!data) return;
    pushRecent({
      id: data.id,
      slug: data.slug,
      name: data.name,
      thumbnail: data.images[0]?.url ?? null,
      price: data.price,
    });
  }, [product.data]);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 2500);
    return () => clearTimeout(t);
  }, [added]);

  if (product.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="h-4 w-72" />
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          <div>
            <Skeleton className="aspect-square w-full" />
            <div className="mt-3 flex gap-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="size-20" />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (product.isError || !product.data) {
    const is404 = product.error instanceof ApiError && product.error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState
          error={product.error}
          onRetry={is404 ? undefined : () => void product.refetch()}
        />
        <div className="mt-6 text-center">
          <Link to="/products" className="text-sm text-brand-600 underline-offset-4 hover:underline">
            Browse all products
          </Link>
        </div>
      </div>
    );
  }

  const p = product.data;
  const selected = variants.find((v) => v.id === variantId) ?? null;
  const selectedAvailable = selected?.available ?? 0;
  const maxQty = Math.max(1, Math.min(selectedAvailable, 99));
  const outOfStock = !p.in_stock || selectedAvailable <= 0;

  async function handleAdd() {
    if (!selected) return;
    setError(null);
    try {
      await addToCart.mutateAsync({ variant_id: selected.id, quantity: qty });
      setAdded(true);
      setQty(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this item to your cart.");
    }
  }

  const images = p.images.length > 0 ? p.images : [];
  const activeImage = images[imageIndex]?.url ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:py-10">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem] text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-ink hover:underline underline-offset-2">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              to={`/products?category=${p.category.slug}`}
              className="hover:text-ink hover:underline underline-offset-2"
            >
              {p.category.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink">{p.name}</li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-14">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2 border border-line">
            {activeImage ? (
              <img
                src={activeImage}
                alt={p.images[imageIndex]?.alt ?? p.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <span className="font-display text-6xl font-semibold text-brand-700/25">
                  {p.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
              </div>
            )}
            {p.compare_at_price && p.compare_at_price > p.price ? (
              <span className="label absolute left-3 top-3 inline-flex items-center rounded-full bg-deal px-3 py-1 text-surface shadow-button">
                Save {Math.round(((p.compare_at_price - p.price) / p.compare_at_price) * 100)}%
              </span>
            ) : null}
          </div>
          {images.length > 1 ? (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={cn(
                    "size-20 shrink-0 overflow-hidden rounded-md bg-surface-2 transition",
                    i === imageIndex
                      ? "shadow-card ring-2 ring-brand-600/40"
                      : "shadow-pressed hover:shadow-card",
                  )}
                >
                  <img src={img.url} alt={img.alt ?? ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="label text-ink-muted">{p.brand?.name ?? p.category.name}</p>
            {p.is_featured ? <Badge tone="info">Featured</Badge> : null}
          </div>
          <h1 className="mt-2 text-3xl sm:text-[2.4rem]">{p.name}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Price
              value={selected?.price ?? p.price}
              compareAt={selected?.compare_at_price ?? p.compare_at_price}
              size="xl"
            />
            {outOfStock ? (
              <Badge tone="negative">Out of stock</Badge>
            ) : selectedAvailable <= 10 ? (
              <Badge tone="warning">Only {selectedAvailable} left</Badge>
            ) : (
              <Badge tone="positive">In stock</Badge>
            )}
          </div>

          {variants.length > 0 ? (
            <div className="mt-6">
              <p className="label text-ink-muted">
                {Object.keys(selected?.attributes ?? {}).length > 0
                  ? Object.keys(selected!.attributes)[0].replace(/\b\w/g, (c) => c.toUpperCase())
                  : "Size / pack"}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {variants.map((v) => {
                  const vAvailable = v.available ?? 0;
                  const active = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariantId(v.id)}
                      aria-pressed={active}
                      className={cn(
                        "relative flex min-w-28 flex-col items-start gap-0.5 rounded-md border border-line px-3.5 py-2.5 text-left transition",
                        active
                          ? "bg-surface ring-2 ring-brand-600/40"
                          : "bg-surface hover:bg-surface-2",
                        vAvailable <= 0 && "opacity-55",
                      )}
                    >
                      <span
                        className={cn(
                          "text-sm",
                          active ? "font-semibold text-ink" : "font-medium text-ink-muted",
                        )}
                      >
                        {v.name}
                      </span>
                      <span className="num text-[0.8125rem] text-ink-muted">
                        {new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: "INR",
                          maximumFractionDigits: 2,
                        }).format(v.price)}
                      </span>
                      {vAvailable <= 0 ? (
                        <span className="label mt-0.5 text-danger">Sold out</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={qty}
              min={1}
              max={maxQty}
              disabled={outOfStock}
              onChange={setQty}
            />
            <Button
              size="lg"
              className="flex-1 sm:min-w-52"
              disabled={outOfStock || !selected}
              loading={addToCart.isPending}
              onClick={() => void handleAdd()}
            >
              {added ? (
                <>
                  <CheckIcon width={16} height={16} />
                  Added to cart
                </>
              ) : outOfStock ? (
                "Out of stock"
              ) : (
                "Add to cart"
              )}
            </Button>
          </div>

          {error ? <InlineError className="mt-3">{error}</InlineError> : null}
          {added ? (
            <p className="mt-3 text-sm text-brand-600">
              Added to your cart.{" "}
              <Link to="/cart" className="underline underline-offset-2">
                Go to cart →
              </Link>
            </p>
          ) : null}

          <dl className="mt-7 divide-y divide-line rounded-md bg-surface px-5 py-1 text-sm border border-line">
            <div className="flex gap-4 py-3">
              <dt className="label w-32 shrink-0 pt-0.5 text-ink-muted">SKU</dt>
              <dd className="num">{selected?.sku ?? "—"}</dd>
            </div>
            <div className="flex gap-4 py-3">
              <dt className="label w-32 shrink-0 pt-0.5 text-ink-muted">Delivery</dt>
              <dd>
                Cash on delivery. Free over ₹999, otherwise ₹40. Usually delivered in 1–2 days.
              </dd>
            </div>
            <div className="flex gap-4 py-3">
              <dt className="label w-32 shrink-0 pt-0.5 text-ink-muted">Category</dt>
              <dd>
                <Link
                  to={`/products?category=${p.category.slug}`}
                  className="text-brand-600 underline-offset-2 hover:underline"
                >
                  {p.category.name}
                </Link>
              </dd>
            </div>
          </dl>

          {p.description ? (
            <div className="mt-5 rounded-md bg-surface px-5 py-4 border border-line">
              <h2 className="text-lg">Description</h2>
              <p className="prose-basic mt-2.5 whitespace-pre-line text-sm">{p.description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
