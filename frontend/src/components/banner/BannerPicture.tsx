import type { Banner } from "@/lib/types";

interface BannerPictureProps {
  banner: Banner;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  eager?: boolean;
}

/**
 * One banner image as desktop + mobile WebP variants. The mobile variant
 * (≤750w) only loads on small screens, so phones never pull the desktop
 * art.
 *
 * The `<picture>` itself is `display: contents` so the wrapped `<img>` is
 * the layout child — the existing hero/promo boxes size and position the
 * image directly.
 */
export function BannerPicture({
  banner,
  alt = "",
  width,
  height,
  className,
  eager = false,
}: BannerPictureProps) {
  return (
    <picture className="contents">
      {banner.image_mobile ? (
        <source media="(max-width: 640px)" srcSet={banner.image_mobile} />
      ) : null}
      <img
        src={banner.image_desktop}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        className={className}
      />
    </picture>
  );
}
