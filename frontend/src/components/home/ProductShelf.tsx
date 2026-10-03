import { useState, type ReactNode } from "react";

import { useProducts, type ProductQueryParams } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";
import type { CategoryNode } from "@/lib/types";

import { ProductCard, ProductCardSkeleton } from "@/components/catalog/ProductCard";
import { Carousel, useCarousel } from "@/components/ui/Carousel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ErrorState } from "@/components/ui/States";

export interface ShelfTab {
  label: string;
  slug?: string;
}

const ITEM_WIDTH =
  "w-[64%] shrink-0 snap-start sm:w-[46%] md:w-[31%] lg:w-[calc((100%-4*1rem)/5)]";

export function shelfTabsFromCategories(
  categories: CategoryNode[] | undefined,
  limit = 6,
): ShelfTab[] {
  return (categories ?? []).slice(0, limit).map((cat) => ({ label: cat.name, slug: cat.slug }));
}

interface ProductShelfProps {
  title: string;
  href: string;
  sort: string;
  tabs?: ShelfTab[];
  query?: Partial<ProductQueryParams>;
  strip?: boolean;
  headingExtra?: ReactNode;
}

export function ProductShelf({
  title,
  href,
  sort,
  tabs = [],
  query,
  strip = false,
  headingExtra,
}: ProductShelfProps) {
  const [active, setActive] = useState(0);
  const { ref, scrollBy, canPrev, canNext } = useCarousel<HTMLDivElement>();

  const current = tabs[active];
  const params: ProductQueryParams = {
    page: 1,
    page_size: 12,
    sort,
    category: current?.slug,
    ...query,
  };
  const products = useProducts(params);

  const showSkeleton = products.isLoading && !products.data;
  const items = products.data?.items ?? [];

  return (
    <section
      aria-labelledby={`shelf-${title.replace(/\s+/g, "-").toLowerCase()}`}
      className={cn(strip && "bg-surface-2/60")}
    >
      <div className="page section-block">
        <SectionHeader
          id={`shelf-${title.replace(/\s+/g, "-").toLowerCase()}`}
          title={title}
          href={href}
          onPrev={() => scrollBy(-1)}
          onNext={() => scrollBy(1)}
          canPrev={canPrev}
          canNext={canNext}
        >
          {tabs.length > 0 ? (
            <div
              role="tablist"
              aria-label={`${title} categories`}
              className="order-3 flex w-full items-center gap-1.5 overflow-x-auto hide-scrollbar rounded-md bg-surface p-1 border border-line sm:order-none sm:w-auto"
            >
              {tabs.map((tab, i) => (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => setActive(i)}
                  className={cn(
                    "label h-8 shrink-0 rounded-lg px-3 transition-colors",
                    i === active
                      ? "bg-surface border border-line text-brand-700 font-semibold"
                      : "text-ink-muted hover:bg-surface-2",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          {headingExtra}
        </SectionHeader>

        <div className="mt-5">
          {products.isError && !items.length ? (
            <ErrorState error={products.error} onRetry={() => void products.refetch()} />
          ) : showSkeleton ? (
            <div className="flex gap-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={ITEM_WIDTH}>
                  <ProductCardSkeleton />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-md bg-surface-2/50 px-6 py-12 text-center shadow-pressed">
              <p className="label text-ink-muted">Nothing here yet</p>
              <p className="mt-2 text-sm text-ink-muted">
                No products in this shelf right now — try another category.
              </p>
            </div>
          ) : (
            <div className={cn("relative", products.isFetching && "opacity-60 transition-opacity")}>
              <Carousel
                containerRef={ref}
                ariaLabel={title}
                className="pb-28"
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    scrollBy(-1);
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    scrollBy(1);
                  }
                }}
              >
                {items.map((item) => (
                  <div key={item.id} className={ITEM_WIDTH}>
                    <ProductCard item={item} />
                  </div>
                ))}
              </Carousel>
              <span className="sr-only" aria-live="polite">
                {products.isFetching ? "Updating products" : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
