import { useCallback, useMemo } from "react";

import { DEAL_ENDS_AT, DEAL_SLOTS } from "@/content/home";
import { useHome } from "@/hooks/queries/catalog";

import { ProductCard, ProductCardSkeleton } from "@/components/catalog/ProductCard";
import { CountdownPill } from "@/components/ui/CountdownPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ErrorState } from "@/components/ui/States";

export function TopSaver() {
  const home = useHome();

  const refetch = useCallback(() => {
    void home.refetch();
  }, [home]);

  const deals = useMemo(() => {
    const all = home.data?.featured ?? [];
    const slots = DEAL_SLOTS.length + 1;
    return all.slice(0, slots).map((item, index) => {
      const slot = DEAL_SLOTS[index % DEAL_SLOTS.length];
      return { item, deal: { sold: slot.sold, stock: slot.sold + item.available } };
    });
  }, [home.data]);

  const headingId = "top-saver-heading";

  return (
    <section aria-labelledby={headingId} className="section-block">
      <SectionHeader
        id={headingId}
        title="Top saver today"
        href="/products?featured=1"
        linkLabel="All offers"
      >
        <CountdownPill endsAt={DEAL_ENDS_AT} onExpire={refetch} className="ms-1" />
      </SectionHeader>

      <div className="mt-5">
        {home.isLoading ? (
          <div className="card-grid">
            {Array.from({ length: 5 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : home.isError ? (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        ) : deals.length === 0 ? (
          <div className="rounded-md bg-surface-2/50 px-6 py-12 text-center shadow-pressed">
            <p className="label text-ink-muted">No deals right now</p>
            <p className="mt-2 text-sm text-ink-muted">
              Today's offers are being restocked — check back soon.
            </p>
          </div>
        ) : (
          <div className="card-grid">
            {deals.map(({ item, deal }) => (
              <ProductCard key={item.id} item={item} deal={deal} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
