import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DEAL_ENDS_AT, DEAL_SLOTS } from "@/content/home";
import { useHome } from "@/hooks/queries/catalog";
import { useDirection } from "@/hooks/useDirection";

import { ProductCard, ProductCardSkeleton } from "@/components/catalog/ProductCard";
import { Carousel, useCarousel } from "@/components/ui/Carousel";
import { CountdownPill } from "@/components/ui/CountdownPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ErrorState } from "@/components/ui/States";

import { SHELF_ITEM_WIDTH } from "./ProductShelf";

export function TopSaver() {
  const { t } = useTranslation("home");
  const home = useHome();
  const { ref, scrollBy, canPrev, canNext } = useCarousel<HTMLDivElement>();
  const { isRTL } = useDirection();

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
        title={t("topsaver.title")}
        href="/products?featured=1"
        linkLabel={t("topsaver.all")}
        onPrev={() => scrollBy(-1)}
        onNext={() => scrollBy(1)}
        canPrev={canPrev}
        canNext={canNext}
      >
        <CountdownPill endsAt={DEAL_ENDS_AT} onExpire={refetch} className="ms-1" />
      </SectionHeader>

      <div className="mt-5">
        {home.isLoading ? (
          <div className="flex gap-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={SHELF_ITEM_WIDTH}>
                <ProductCardSkeleton />
              </div>
            ))}
          </div>
        ) : home.isError ? (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        ) : deals.length === 0 ? (
          <div className="rounded-md bg-surface-2/50 px-6 py-12 text-center shadow-pressed">
            <p className="label text-ink-muted">{t("topsaver.empty")}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {t("topsaver.emptyBody")}
            </p>
          </div>
        ) : (
          <Carousel
            containerRef={ref}
            ariaLabel={t("topsaver.title")}
            className="pb-1"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                scrollBy(isRTL ? 1 : -1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                scrollBy(isRTL ? -1 : 1);
              }
            }}
          >
            {deals.map(({ item, deal }) => (
              <div key={item.id} className={SHELF_ITEM_WIDTH}>
                <ProductCard item={item} deal={deal} />
              </div>
            ))}
          </Carousel>
        )}
      </div>
    </section>
  );
}
