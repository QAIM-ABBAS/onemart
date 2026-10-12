import { useEffect } from "react";
import { Link } from "react-router-dom";

import { BannerPicture } from "@/components/banner/BannerPicture";
import { Skeleton } from "@/components/ui/States";
import { trackClick, trackImpression } from "@/lib/bannerTrack";
import { cn } from "@/lib/cn";
import type { Banner } from "@/lib/types";

/**
 * The horizontal promo strip used by the `category_header` and `cart_promo`
 * placements: copy on the left, creative on the right (creative hides on
 * phones). Renders nothing structural beyond its own box — the page decides
 * whether a slot exists, and hides it when the payload is empty.
 */
export function BannerStrip({
  banner,
  className,
}: {
  banner: Banner;
  className?: string;
}) {
  useEffect(() => {
    trackImpression(banner.id);
  }, [banner.id]);

  const brand = banner.tone === "brand";

  return (
    <section
      aria-label={banner.title}
      className={cn(
        "relative overflow-hidden rounded-md border",
        brand ? "border-brand-700 bg-brand-700 text-surface" : "border-line bg-brand-50 text-ink",
        className,
      )}
    >
      <div className="flex items-center gap-5 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          {banner.eyebrow ? (
            <p className={cn("label", brand ? "text-surface/60" : "text-brand-600")}>
              {banner.eyebrow}
            </p>
          ) : null}
          <p className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
            {banner.title}
          </p>
          {banner.subtitle ? (
            <p
              className={cn(
                "mt-1 line-clamp-2 text-sm leading-relaxed",
                brand ? "text-surface/75" : "text-ink-muted",
              )}
            >
              {banner.subtitle}
            </p>
          ) : null}
          <Link
            to={banner.href}
            onClick={() => trackClick(banner.id)}
            className={cn(
              "label mt-3 inline-flex h-9 items-center rounded-md px-4 shadow-button transition hover:-translate-y-px",
              brand
                ? "bg-canvas text-ink hover:bg-brand-50"
                : "bg-brand-700 text-surface hover:bg-brand-800",
            )}
          >
            {banner.cta_label ?? "Shop now"}
          </Link>
        </div>
        <div className="hidden w-40 shrink-0 sm:block lg:w-52">
          <BannerPicture
            banner={banner}
            alt={banner.alt ?? ""}
            width={208}
            height={120}
            className="h-24 w-full rounded object-cover lg:h-28"
          />
        </div>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-1",
          brand ? "bg-[repeating-linear-gradient(90deg,var(--color-warning)_0_14px,transparent_14px_28px)]" : "bg-brand-600",
        )}
      />
    </section>
  );
}

/** Loading placeholder with the strip's real geometry — no layout shift. */
export function BannerStripSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center gap-5 rounded-md border border-line bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="hidden h-24 w-40 shrink-0 rounded sm:block" />
    </div>
  );
}
