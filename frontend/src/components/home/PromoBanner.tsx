import { useEffect } from "react";
import { Link } from "react-router-dom";

import { BannerPicture } from "@/components/banner/BannerPicture";
import { trackClick, trackImpression } from "@/lib/bannerTrack";
import type { Banner } from "@/lib/types";

/** The single `home_mid_strip` creative — sits beside the hero carousel. */
export function PromoBanner({ banner }: { banner: Banner }) {
  useEffect(() => {
    trackImpression(banner.id);
  }, [banner.id]);

  return (
    <section
      aria-label={banner.title}
      className="relative flex h-full min-h-[190px] flex-col justify-between overflow-hidden rounded-md bg-brand-700 p-6 text-surface shadow-panel sm:p-7"
    >
      <div className="relative z-10 max-w-[62%]">
        {banner.eyebrow ? (
          <p className="label text-surface/60">{banner.eyebrow}</p>
        ) : null}
        <p className="mt-2 font-display text-[1.6rem] leading-[1.05] font-semibold tracking-tight sm:text-3xl lg:text-[2rem]">
          {banner.title}
        </p>
        {banner.subtitle ? (
          <p className="mt-2 hidden text-[0.8125rem] leading-relaxed text-surface/75 sm:block">
            {banner.subtitle}
          </p>
        ) : null}
        <Link
          to={banner.href}
          onClick={() => trackClick(banner.id)}
          className="label mt-4 inline-flex h-9 items-center rounded-md bg-canvas px-4 text-ink shadow-button transition hover:-translate-y-px hover:bg-brand-50 hover:shadow-lift"
        >
          {banner.cta_label ?? "Shop now"}
        </Link>
      </div>
      <div className="pointer-events-none absolute -end-4 -bottom-6 w-32 opacity-90 sm:-end-2 sm:w-40">
        <BannerPicture
          banner={banner}
          alt=""
          width={200}
          height={200}
          className="photo-lift h-auto w-full object-contain"
        />
      </div>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(90deg,var(--color-warning)_0_14px,transparent_14px_28px)]"
      />
    </section>
  );
}
