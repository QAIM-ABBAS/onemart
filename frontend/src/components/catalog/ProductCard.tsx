import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { ProductListItem } from "@/lib/types";
import { cn } from "@/lib/cn";

import { Price } from "@/components/ui/Price";
import { Skeleton } from "@/components/ui/States";

function imageFor(item: ProductListItem): string | null {
  if (item.thumbnail) return item.thumbnail;
  return null;
}

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

export function ProductCard({ item, className }: { item: ProductListItem; className?: string }) {
  const img = imageFor(item);
  return (
    <Link
      to={`/p/${item.slug}`}
      className={cn(
        "group flex h-full flex-col bg-surface transition-colors hover:bg-mist/40",
        className,
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-mist">
        {img ? (
          <img
            src={img}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <FallbackImage name={item.name} />
        )}
        {!item.in_stock ? (
          <span className="label absolute inset-x-0 bottom-0 bg-ink/85 py-1.5 text-center text-paper">
            Out of stock
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="label text-ink-soft">
          {item.brand ?? item.category}
        </p>
        <h3 className="line-clamp-2 font-sans text-sm font-medium leading-snug tracking-normal text-ink">
          {item.name}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <Price value={item.price} compareAt={item.compare_at_price} size="md" />
          {item.variant_count > 1 ? (
            <span className="shrink-0 text-[0.6875rem] text-ink-soft">
              {item.variant_count} options
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-surface">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2.5 p-4">
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
        "grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3",
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
