import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Banner, BannerPlacement } from "@/lib/types";

/**
 * Storefront banners for one placement. An empty list is the "hide this
 * slot" signal — callers show a skeleton while loading and render nothing
 * once it lands, so an unbooked placement never leaves an empty header.
 *
 * `retry: false`: a marketing widget failing must degrade to "no banner",
 * not stall the page behind retry backoff. The server already caches each
 * payload for 60s, which matches staleTime.
 */
export function useBanners(placement: BannerPlacement, category?: string | null) {
  const needsCategory = placement === "category_header";
  return useQuery({
    queryKey: ["banners", placement, category ?? null],
    queryFn: () =>
      api.get<Banner[]>("/banners", {
        placement,
        category: category ?? undefined,
      }),
    // A category header without a category is meaningless — don't fetch.
    enabled: !needsCategory || Boolean(category),
    staleTime: 60_000,
    retry: false,
  });
}
