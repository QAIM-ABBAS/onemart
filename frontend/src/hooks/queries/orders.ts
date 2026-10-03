import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { OrderDetail, OrderListItem, Page } from "@/lib/types";

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
