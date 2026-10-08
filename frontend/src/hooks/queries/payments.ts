import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { PaymentInitiate, PaymentStatusOut } from "@/lib/types";
import { toast } from "@/stores/toast";

/** Open (or retry) an online payment attempt for an order. */
export function useInitiatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number | string) =>
      api.post<PaymentInitiate>(`/orders/${orderId}/payments`),
    onSuccess: (_data, orderId) => {
      void qc.invalidateQueries({ queryKey: ["order", String(orderId)] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not start the payment.", {
        tone: "negative",
      });
    },
  });
}

/**
 * Status of one attempt. Polled by the return page while the gateway's answer
 * is still being applied (it also keeps that page honest if the customer
 * navigated back before the callback landed).
 */
export function usePaymentStatus(paymentId: number | string | null, enabled = true) {
  return useQuery({
    queryKey: ["payment", paymentId == null ? "" : String(paymentId)],
    queryFn: () => api.get<PaymentStatusOut>(`/payments/${paymentId}`),
    enabled: enabled && paymentId != null && paymentId !== "",
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "paid" || status === "failed" ? false : 2_000;
    },
    retry: false,
  });
}
