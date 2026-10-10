import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  AddressIn,
  AddressOut,
  CheckoutIn,
  CheckoutSummary,
  DeliverySlotOut,
  OrderDetail,
  ZoneMatchOut,
} from "@/lib/types";

export type DeliveryQuoteParams = {
  postal_code?: string;
  city?: string;
  delivery_method?: string;
};

export function useCheckoutSummary(params?: DeliveryQuoteParams) {
  const query = params ?? {};
  return useQuery({
    queryKey: ["checkout-summary", query],
    queryFn: () => api.get<CheckoutSummary>("/checkout/summary", query),
    staleTime: 5_000,
  });
}

/** Zone match for an address (checkout asks as the customer types). */
export function useZoneMatch(params?: { postal_code?: string; city?: string }) {
  const query = params ?? {};
  return useQuery({
    queryKey: ["zone-match", query],
    queryFn: () => api.get<ZoneMatchOut>("/delivery/zones/match", query),
    staleTime: 30_000,
    enabled: Boolean(query.postal_code || query.city),
  });
}

/** The bookable slot grid for a zone (full/limited/available/closed states). */
export function useDeliverySlots(zoneId?: number | null) {
  return useQuery({
    queryKey: ["delivery-slots", zoneId],
    queryFn: () =>
      api.get<DeliverySlotOut[]>("/delivery/slots", { zone_id: zoneId as number }),
    enabled: Boolean(zoneId),
    staleTime: 30_000,
  });
}

export function useAddresses() {
  return useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<AddressOut[]>("/addresses"),
  });
}

export function useAddAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddressIn) => api.post<AddressOut>("/addresses", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["addresses"] });
    },
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (addressId: number) => api.del<void>(`/addresses/${addressId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["addresses"] });
    },
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CheckoutIn) => api.post<OrderDetail>("/checkout", payload),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["checkout-summary"] });
      void qc.invalidateQueries({ queryKey: ["cart"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
