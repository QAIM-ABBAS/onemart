import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAddToCart, useRemoveCartItem } from "@/hooks/queries/cart";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { formatNumber, formatPrice } from "@/lib/format";
import type { CartOut, ProductDetail, ProductListItem } from "@/lib/types";
import { toast } from "@/stores/toast";

export function useQuickAdd() {
  const qc = useQueryClient();
  const addToCart = useAddToCart();
  const removeItem = useRemoveCartItem();

  return useCallback(
    async (item: ProductListItem, quantity = 1) => {
      const detail = await qc.fetchQuery({
        queryKey: ["product", item.slug],
        queryFn: () => api.get<ProductDetail>(`/products/${item.slug}`),
        staleTime: 60_000,
      });
      const variant = detail.variants.find((v) => v.is_default) ?? detail.variants[0];
      if (!variant) {
        toast(i18n.t("toast.noOption"), { tone: "negative" });
        return;
      }

      try {
        const cart = await addToCart.mutateAsync({ variant_id: variant.id, quantity });
        const line = cart.items.find((entry) => entry.variant_id === variant.id);
        toast(
          i18n.t("toast.addedToCart", {
            quantity: formatNumber(quantity),
            name: item.name,
            price: formatPrice(item.price * quantity),
          }),
          {
            tone: "positive",
            action: line
              ? {
                  label: i18n.t("toast.undo"),
                  onClick: () => {
                    removeItem.mutate(line.id, {
                      onSuccess: (next) => qc.setQueryData<CartOut>(["cart"], next),
                    });
                  },
                }
              : undefined,
          },
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : i18n.t("toast.addFailed"), {
          tone: "negative",
        });
      }
    },
    [addToCart, removeItem, qc],
  );
}
