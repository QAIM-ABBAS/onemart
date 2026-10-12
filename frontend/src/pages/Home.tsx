import { lazy, Suspense } from "react";

import { useBanners } from "@/hooks/queries/banners";
import { useHome } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";

import { CategoryCarousel } from "@/components/home/CategoryCarousel";
import { FeaturedBrands } from "@/components/home/FeaturedBrands";
import { FlashStrip } from "@/components/home/FlashStrip";
import { HeroSlider } from "@/components/home/HeroSlider";
import { PromoBanner } from "@/components/home/PromoBanner";
import { ProductCardSkeleton } from "@/components/catalog/ProductCard";
import { ErrorState, Skeleton } from "@/components/ui/States";

const TopSaver = lazy(() =>
  import("@/components/home/TopSaver").then((m) => ({ default: m.TopSaver })),
);
const HomeShelves = lazy(() =>
  import("@/components/home/HomeShelves").then((m) => ({ default: m.HomeShelves })),
);

function ShelfFallback() {
  return (
    <div className="section-block">
      <Skeleton className="h-6 w-48" />
      <div className="mt-5 flex gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="w-[calc((100%-4*1rem)/5)] shrink-0">
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

const PROMISES = [
  { title: "Cash on delivery", body: "Pay when your order arrives at your door — no cards, no wallets." },
  { title: "Free delivery over ₹999", body: "A flat ₹40 delivery fee below that, shown upfront at checkout." },
  { title: "Status you can follow", body: "Every order carries a timeline — packed, shipped, delivered." },
] as const;

export function HomePage() {
  const home = useHome();
  const hero = useBanners("home_hero");
  const mid = useBanners("home_mid_strip");

  if (home.isError) {
    return (
      <div className="page py-16">
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      </div>
    );
  }

  // Homepage promo rule: one hero carousel + one mid strip + the flash strip.
  // Each slot hides itself when unbooked (empty payload) or unreachable —
  // a marketing failure never blocks the storefront.
  const heroSlides = hero.data ?? [];
  const midBanner = mid.data?.[0] ?? null;
  const bannersLoading = hero.isLoading || mid.isLoading;
  const showHero = !hero.isLoading && heroSlides.length > 0;
  const showMid = !mid.isLoading && midBanner !== null;

  return (
    <>
      <h1 className="sr-only">
        OneMart — everything you need, in one place
      </h1>

      <div className="page pt-4 sm:pt-6">
        {bannersLoading ? (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Skeleton className="h-[360px] rounded-md sm:h-[380px] lg:h-[300px]" />
            <Skeleton className="min-h-[190px] rounded-md" />
          </div>
        ) : showHero || showMid ? (
          <div className={cn("grid gap-4", showHero && showMid && "lg:grid-cols-[2fr_1fr]")}>
            {showHero ? <HeroSlider slides={heroSlides} /> : null}
            {showMid && midBanner ? <PromoBanner banner={midBanner} /> : null}
          </div>
        ) : null}

        {/* Live flash deal — hides itself when nothing is on. */}
        <FlashStrip />

        <CategoryCarousel />
        <FeaturedBrands />

        <Suspense fallback={<ShelfFallback />}>
          <TopSaver />
        </Suspense>
      </div>

      <Suspense fallback={<ShelfFallback />}>
        <HomeShelves />
      </Suspense>

      <div className="page">
        <section className="rounded-md bg-surface px-6 py-9 border border-line">
          <div className="grid gap-8 sm:grid-cols-3">
            {PROMISES.map((item) => (
              <div key={item.title}>
                <p className="label text-brand-600">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
