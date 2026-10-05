import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { forgetSave, readPendingSaves, replaySave } from "@/lib/wishlistPending";
import type { Page, WishlistIds, WishlistItem, WishlistToggle } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { toast } from "@/stores/toast";

export interface WishlistListParams {
  page: number;
  page_size: number;
  sort: string;
  q?: string;
  in_stock?: boolean;
}

export const wishlistKeys = {
  all: ["wishlist"] as const,
  ids: ["wishlist", "ids"] as const,
  list: (params: WishlistListParams) => ["wishlist", "list", params] as const,
};

/** Nothing wishlist-shaped is fetched until the session is known and signed in. */
function useWishlistEnabled(): boolean {
  const booted = useAuth((state) => state.booted);
  const user = useAuth((state) => state.user);
  return booted && user !== null;
}

export function useWishlistIds() {
  const enabled = useWishlistEnabled();
  return useQuery({
    queryKey: wishlistKeys.ids,
    queryFn: () => api.get<WishlistIds>("/wishlist/ids"),
    staleTime: 30_000,
    enabled,
  });
}

export function useWishlistList(params: WishlistListParams) {
  const enabled = useWishlistEnabled();
  return useQuery({
    queryKey: wishlistKeys.list(params),
    queryFn: () =>
      api.get<Page<WishlistItem>>("/wishlist", {
        page: params.page,
        page_size: params.page_size,
        sort: params.sort,
        q: params.q,
        in_stock: params.in_stock ? true : undefined,
      }),
    staleTime: 15_000,
    enabled,
  });
}

/**
 * Heart toggle with an optimistic flip: the heart changes immediately, and a
 * failed request rolls the cache back to exactly what it was.
 */
export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, saved }: { productId: number; saved: boolean }) =>
      saved
        ? api.post<WishlistToggle>(`/wishlist/${productId}`)
        : api.del<WishlistToggle>(`/wishlist/${productId}`),
    onMutate: async ({ productId, saved }) => {
      await qc.cancelQueries({ queryKey: wishlistKeys.ids });
      const previous = qc.getQueryData<WishlistIds>(wishlistKeys.ids);
      qc.setQueryData<WishlistIds>(wishlistKeys.ids, (prev) => {
        if (!prev) return prev;
        const has = prev.ids.includes(productId);
        const ids = saved
          ? has
            ? prev.ids
            : [productId, ...prev.ids]
          : prev.ids.filter((id) => id !== productId);
        const count = saved
          ? has
            ? prev.count
            : prev.count + 1
          : has
            ? Math.max(prev.count - 1, 0)
            : prev.count;
        return { ids, count };
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) qc.setQueryData(wishlistKeys.ids, context.previous);
      toast(error instanceof Error ? error.message : "Could not update your wishlist.", {
        tone: "negative",
      });
    },
    onSuccess: (data) => {
      // The server's running total wins over our guess.
      qc.setQueryData<WishlistIds>(wishlistKeys.ids, (prev) =>
        prev ? { ...prev, count: data.count } : prev,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: wishlistKeys.all });
    },
  });
}

/**
 * Replays the taps a guest parked in localStorage as soon as a session
 * exists. Runs once per session: each item is forgotten only after the
 * server accepted it, so a failed replay retries next time.
 */
export function useReplayPendingWishlist(): void {
  const booted = useAuth((state) => state.booted);
  const user = useAuth((state) => state.user);
  const qc = useQueryClient();

  useEffect(() => {
    if (!booted || !user) return;
    let cancelled = false;

    void (async () => {
      const pending = readPendingSaves();
      if (pending.length === 0) return;
      const saved: string[] = [];
      for (const item of pending) {
        const ok = await replaySave(item);
        if (!ok) break; // keep the rest parked; the next session retries
        forgetSave(item.id);
        saved.push(item.name);
      }
      if (cancelled || saved.length === 0) return;
      await qc.invalidateQueries({ queryKey: wishlistKeys.all });
      toast(
        saved.length === 1
          ? `${saved[0]} was added to your wishlist.`
          : `${saved.length} saved items were added to your wishlist.`,
        { tone: "positive" },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [booted, user, qc]);
}
