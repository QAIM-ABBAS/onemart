import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ActiveFlashDeal } from "@/lib/types";

/**
 * The live flash-deal strip. Polls gently so a deal ending (or selling out)
 * disappears on its own; the whole strip is hidden when the list is empty.
 * Signed-in users get `per_user_remaining` on top of the shared payload.
 */
export function useActiveDeals(enabled = true) {
  return useQuery({
    queryKey: ["deals", "active"],
    queryFn: () => api.get<ActiveFlashDeal[]>("/deals/active"),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled,
  });
}
