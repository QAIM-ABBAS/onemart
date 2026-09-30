import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  AddressIn,
  AddressOut,
  CheckoutIn,
  CheckoutSummary,
  OrderDetail,
} from "@/lib/types";

export function useCheckoutSummary() {
  return useQuery({
    queryKey: ["checkout-summary"],
    queryFn: () => api.get<CheckoutSummary>("/checkout/summary"),
    staleTime: 5_000,
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
