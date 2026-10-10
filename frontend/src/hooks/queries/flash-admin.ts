import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  FlashDealAdminOut,
  FlashDealItemAdminOut,
  FlashDealItemWrite,
  FlashDealWrite,
  FlashVariantRow,
  Page,
} from "@/lib/types";

export interface AdminDealQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  q?: string;
  status?: string;
}

export function useAdminDeals(params: AdminDealQueryParams) {
  return useQuery({
    queryKey: ["admin", "flash-deals", params],
    queryFn: () => api.get<Page<FlashDealAdminOut>>("/admin/flash-deals", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminDealItems(dealId: number | null) {
  return useQuery({
    queryKey: ["admin", "flash-deals", dealId, "items"],
    queryFn: () => api.get<FlashDealItemAdminOut[]>(`/admin/flash-deals/${dealId}/items`),
    enabled: dealId !== null,
  });
}

export function useSaveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: FlashDealWrite }) =>
      id
        ? api.patch<FlashDealAdminOut>(`/admin/flash-deals/${id}`, payload)
        : api.post<FlashDealAdminOut>("/admin/flash-deals", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/admin/flash-deals/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

/** "End early": closes the window now but keeps the deal for history. */
export function useEndDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<FlashDealAdminOut>(`/admin/flash-deals/${id}/end`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useAddDealItem(dealId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: FlashDealItemWrite) =>
      api.post<FlashDealItemAdminOut>(`/admin/flash-deals/${dealId}/items`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useUpdateDealItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, payload }: { itemId: number; payload: FlashDealItemWrite }) =>
      api.patch<FlashDealItemAdminOut>(`/admin/flash-deals/items/${itemId}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDeleteDealItem(dealId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => api.del<void>(`/admin/flash-deals/items/${itemId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals", dealId, "items"] });
      void qc.invalidateQueries({ queryKey: ["admin", "flash-deals"] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

/** Typeahead for the add-item dialog; flags variants a live deal claims. */
export function useVariantSearch(q: string) {
  return useQuery({
    queryKey: ["admin", "flash-deals", "variant-search", q],
    queryFn: () =>
      api.get<Page<FlashVariantRow>>("/admin/flash-deals/variant-search", {
        q,
        page_size: 8,
      }),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}
