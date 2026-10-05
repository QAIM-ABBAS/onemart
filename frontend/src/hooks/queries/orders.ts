import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { OrderDetail, OrderListItem, Page } from "@/lib/types";
import { toast } from "@/stores/toast";

export interface OrderQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  status?: string;
}

export function useOrders(params: OrderQueryParams) {
  return useQuery({
    queryKey: ["orders", params],
    queryFn: () => api.get<Page<OrderListItem>>("/orders", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(orderId: number | string | undefined) {
  return useQuery({
    // String(...) so a caller passing a number still hits the same entry that
    // useUpdateOrderStatus writes to (see admin.ts).
    queryKey: ["order", orderId == null ? "" : String(orderId)],
    queryFn: () => api.get<OrderDetail>(`/orders/${orderId}`),
    enabled: orderId !== undefined && orderId !== "",
  });
}

/**
 * Customer cancellation. The endpoint only accepts it while the order is
 * Pending/Confirmed, so a 409 means someone moved it in the meantime —
 * refetch in that case so the page shows the real state.
 */
export function useCancelOrder(orderId: number | string) {
  const qc = useQueryClient();
  const key = ["order", String(orderId)];
  return useMutation({
    mutationFn: () => api.post<OrderDetail>(`/orders/${orderId}/cancel`),
    onSuccess: (data) => {
      // The response *is* the fresh order (history included), so the timeline
      // updates without a round trip; the list summary may change too.
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      toast("Order cancelled.", { tone: "positive" });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not cancel this order.", {
        tone: "negative",
      });
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}
