import { Link } from "react-router-dom";

import { useCategories } from "@/hooks/queries/catalog";
import type { CategoryNode } from "@/lib/types";

import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { Carousel, useCarousel } from "@/components/ui/Carousel";
import { ChevronRightIcon } from "@/components/ui/Icon";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/States";

function buildTiles(nodes: CategoryNode[]): CategoryNode[] {
  const roots = nodes.slice();
  const children = nodes.flatMap((node) => node.children ?? []);
  const seen = new Set<number>();
  const merged: CategoryNode[] = [];
  for (const node of [...roots, ...children]) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    merged.push(node);
  }
  return merged.slice(0, 12);
}

export function CategoryCarousel() {
  const categories = useCategories();
  const { ref, scrollBy, canPrev, canNext } = useCarousel<HTMLDivElement>();

  const tiles = buildTiles(categories.data ?? []);

  return (
    <section aria-labelledby="categories-heading" className="section-block">
      <SectionHeader
        id="categories-heading"
        title="Browse by category"
        href="/products"
        linkLabel="All categories"
        onPrev={() => scrollBy(-1)}
        onNext={() => scrollBy(1)}
        canPrev={canPrev}
        canNext={canNext}
      />

      <div className="mt-5">
        {categories.isLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[124px] w-[108px] shrink-0 rounded-md" />
            ))}
          </div>
        ) : (
          <Carousel containerRef={ref} ariaLabel="Product categories">
            {tiles.map((cat) => (
              <Link
                key={cat.id}
                to={`/products?category=${cat.slug}`}
                className="group flex h-[124px] w-[108px] shrink-0 snap-start flex-col items-center justify-center gap-2.5 rounded-md bg-surface px-2 text-center border border-line transition duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:-translate-y-0.5 focus-visible:shadow-lift"
              >
                <CategoryIcon
                  slug={cat.slug}
                  name={cat.name}
                  size={42}
                  className="text-brand-700 transition-colors group-hover:text-brand-600"
                />
                <span className="line-clamp-2 text-[0.6875rem] leading-tight font-medium text-ink">
                  {cat.name}
                </span>
              </Link>
            ))}
            <Link
              to="/products"
              className="flex h-[124px] w-[108px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-md bg-surface-2/70 text-center shadow-pressed transition duration-200 hover:-translate-y-0.5 hover:bg-surface hover:shadow-lift"
            >
              <span className="label text-ink-muted">See all</span>
              <ChevronRightIcon width={16} height={16} className="text-ink-muted" />
            </Link>
          </Carousel>
        )}
      </div>
    </section>
  );
}
