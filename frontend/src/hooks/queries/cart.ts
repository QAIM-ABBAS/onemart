import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CartOut } from "@/lib/types";

export function useCart() {
  return useQuery({
    queryKey: ["cart"],
    queryFn: () => api.get<CartOut>("/cart"),
    staleTime: 10_000,
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

export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>("/cart"),
    onSuccess: () => {
      qc.setQueryData<CartOut>(["cart"], (prev) =>
        prev ? { ...prev, items: [], subtotal: 0, delivery_fee: 0, total: 0, item_count: 0 } : prev,
      );
    },
  });
}
