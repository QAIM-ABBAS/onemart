import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import type { CartOut } from "@/lib/types";

export function useCart() {
  // Wait for the session refresh before asking for the cart. Firing it while
  // the access token is still being restored resolves to the *guest* cart for a
  // signed-in customer, and with staleTime set that wrong cart is what the page
  // keeps showing (the server answers 200, so the 401-retry never kicks in).
  const booted = useAuth((state) => state.booted);
  return useQuery({
    queryKey: ["cart"],
    queryFn: () => api.get<CartOut>("/cart"),
    staleTime: 10_000,
    enabled: booted,
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { variant_id: number; quantity?: number }) =>
      api.post<CartOut>("/cart/items", input),
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
  });
}

export function useUpdateCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { item_id: number; quantity: number }) =>
      api.patch<CartOut>(`/cart/items/${input.item_id}`, { quantity: input.quantity }),
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
  });
}

export function useRemoveCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => api.del<CartOut>(`/cart/items/${itemId}`),
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
  });
}

export function useApplyCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<CartOut>("/cart/coupon", { code }),
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
  });
}

export function useRemoveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<CartOut>("/cart/coupon"),
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
  });
}

export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>("/cart"),
    onSuccess: () => {
      qc.setQueryData<CartOut>(["cart"], (prev) =>
        prev
          ? {
              ...prev,
              items: [],
              subtotal: 0,
              discount: 0,
              coupon: null,
              delivery_fee: 0,
              total: 0,
              item_count: 0,
            }
          : prev,
      );
    },
  });
}
