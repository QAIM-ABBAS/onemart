import { useEffect, useState } from "react";

import { useToggleWishlist, useWishlistIds } from "@/hooks/queries/wishlist";
import { rememberSave } from "@/lib/wishlistPending";
import { useAuth } from "@/stores/auth";

/**
 * Server-backed wishlist.
 *
 * `toggle()` behaves differently by audience on purpose:
 *  - signed in  → optimistic mutation against /wishlist (rollback on error)
 *  - guest      → the tap is parked locally and a sign-in prompt opens; the
 *                 parked item is replayed the moment a session appears
 *
 * The prompt itself is a tiny module-level store so any card on the page can
 * raise it, while exactly one dialog (mounted in the shell) renders it.
 */
export interface WishlistPrompt {
  id: number;
  name: string;
}

let prompt: WishlistPrompt | null = null;
const listeners = new Set<(value: WishlistPrompt | null) => void>();

function emit(value: WishlistPrompt | null): void {
  prompt = value;
  for (const listener of listeners) listener(value);
}

export function dismissWishlistPrompt(): void {
  emit(null);
}

export function useWishlistPrompt(): {
  product: WishlistPrompt | null;
  dismiss: () => void;
} {
  const [product, setProduct] = useState<WishlistPrompt | null>(prompt);
  useEffect(() => {
    listeners.add(setProduct);
    return () => {
      listeners.delete(setProduct);
    };
  }, []);
  return { product, dismiss: dismissWishlistPrompt };
}

export function useWishlist(): {
  ids: number[];
  count: number;
  signedIn: boolean;
  has: (id: number) => boolean;
  /** Returns what the heart should show next (false for a guest's prompt). */
  toggle: (productId: number, name?: string) => boolean;
  isPending: boolean;
} {
  const booted = useAuth((state) => state.booted);
  const user = useAuth((state) => state.user);
  const idsQuery = useWishlistIds();
  const mutation = useToggleWishlist();

  const signedIn = booted && user !== null;
  const ids = signedIn ? (idsQuery.data?.ids ?? []) : [];

  return {
    ids,
    count: ids.length,
    signedIn,
    has: (id: number) => ids.includes(id),
    isPending: mutation.isPending,
    toggle(productId: number, name?: string) {
      if (!signedIn) {
        const parked = { id: productId, name: name ?? "This item" };
        rememberSave(parked);
        emit(parked);
        return false;
      }
      const saved = !ids.includes(productId);
      mutation.mutate({ productId, saved });
      return saved;
    },
  };
}
