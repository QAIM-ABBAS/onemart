import { useCallback, useMemo } from "react";

import { DEAL_ENDS_AT, DEAL_SLOTS } from "@/content/home";
import { useHome } from "@/hooks/queries/catalog";
import { useAuth } from "@/stores/auth";

import { ProductCard, ProductCardSkeleton } from "@/components/catalog/ProductCard";
import { CountdownPill } from "@/components/ui/CountdownPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ErrorState } from "@/components/ui/States";

import { SignupPromoCard } from "./SignupPromoCard";

export function TopSaver() {
  const home = useHome();
  const user = useAuth((state) => state.user);

  const refetch = useCallback(() => {
    void home.refetch();
  }, [home]);

  const deals = useMemo(() => {
    const all = home.data?.featured ?? [];
    const slots = user ? DEAL_SLOTS.length + 1 : DEAL_SLOTS.length;
    return all.slice(0, slots).map((item, index) => {
      const slot = DEAL_SLOTS[index % DEAL_SLOTS.length];
      return { item, deal: { sold: slot.sold, stock: slot.sold + item.available } };
    });
  }, [home.data, user]);

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : home.isError ? (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        ) : deals.length === 0 ? (
          <div className="border border-dashed border-line-strong bg-surface/70 px-6 py-12 text-center">
            <p className="label text-ink-soft">No deals right now</p>
            <p className="mt-2 text-sm text-ink-soft">
              Today's offers are being restocked — check back soon.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {deals.map(({ item, deal }) => (
              <ProductCard key={item.id} item={item} deal={deal} />
            ))}
            {user ? null : <SignupPromoCard className="col-span-2 md:col-span-1" />}
          </div>
        )}
      </div>
    </section>
  );
}
