import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  BlockedDateOut,
  DeliveryBoard,
  DeliverySlotOut,
  Page,
  ZoneAdminOut,
  ZoneTemplateOut,
  ZoneTemplateWrite,
  ZoneWrite,
} from "@/lib/types";

export interface AdminZoneQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  q?: string;
  is_active?: boolean;
}

export function useAdminZones(params: AdminZoneQueryParams) {
  return useQuery({
    queryKey: ["admin", "delivery", "zones", params],
    queryFn: () => api.get<Page<ZoneAdminOut>>("/admin/delivery/zones", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: ZoneWrite }) =>
      id
        ? api.patch<ZoneAdminOut>(`/admin/delivery/zones/${id}`, payload)
        : api.post<ZoneAdminOut>("/admin/delivery/zones", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "delivery"] });
      // The public grid/quote depend on which zones exist.
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
      void qc.invalidateQueries({ queryKey: ["checkout-summary"] });
    },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (zoneId: number) => api.del<void>(`/admin/delivery/zones/${zoneId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "delivery"] });
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
      void qc.invalidateQueries({ queryKey: ["checkout-summary"] });
    },
  });
}

export function useZoneTemplates(zoneId: number | null) {
  return useQuery({
    queryKey: ["admin", "delivery", "templates", zoneId],
    queryFn: () =>
      api.get<ZoneTemplateOut[]>(`/admin/delivery/zones/${zoneId}/templates`),
    enabled: zoneId !== null,
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    // Templates are immutable rows (weekday + window is the unique key):
    // "editing" is delete + create, so this is create-only.
    mutationFn: ({ zoneId, payload }: { zoneId: number; payload: ZoneTemplateWrite }) =>
      api.post<ZoneTemplateOut>(`/admin/delivery/zones/${zoneId}/templates`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["admin", "delivery", "templates", vars.zoneId],
      });
      // Generation recipes changed — the concrete slot window may follow.
      void qc.invalidateQueries({ queryKey: ["admin", "delivery", "slots", vars.zoneId] });
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { zoneId: number; id: number }) =>
      api.del<void>(`/admin/delivery/templates/${id}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["admin", "delivery", "templates", vars.zoneId],
      });
    },
  });
}

export interface AdminSlotQueryParams {
  page?: number;
  page_size?: number;
  date_from?: string;
  date_to?: string;
  state?: string;
}

export function useAdminSlots(zoneId: number | null, params: AdminSlotQueryParams) {
  return useQuery({
    queryKey: ["admin", "delivery", "slots", zoneId, params],
    queryFn: () =>
      api.get<Page<DeliverySlotOut>>(`/admin/delivery/zones/${zoneId}/slots`, {
        ...params,
      }),
    enabled: zoneId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useGenerateSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      zoneId,
      date_from,
      days,
    }: {
      zoneId: number;
      date_from: string;
      days: number;
    }) =>
      api.post<{ created: number }>(`/admin/delivery/zones/${zoneId}/generate`, {
        date_from,
        days,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["admin", "delivery", "slots", vars.zoneId] });
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
    },
  });
}

export function useBlockedDates(zoneId: number | null) {
  return useQuery({
    queryKey: ["admin", "delivery", "blocked", zoneId],
    queryFn: () =>
      api.get<BlockedDateOut[]>(`/admin/delivery/zones/${zoneId}/blocked-dates`),
    enabled: zoneId !== null,
  });
}

export function useBlockDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      zoneId,
      date,
      reason,
    }: {
      zoneId: number;
      date: string;
      reason?: string;
    }) =>
      api.post<BlockedDateOut>(`/admin/delivery/zones/${zoneId}/blocked-dates`, {
        date,
        reason,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["admin", "delivery", "blocked", vars.zoneId],
      });
      void qc.invalidateQueries({ queryKey: ["admin", "delivery", "slots", vars.zoneId] });
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
    },
  });
}

export function useUnblockDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, date }: { zoneId: number; date: string }) =>
      api.post<void>(`/admin/delivery/zones/${zoneId}/unblock-date`, { date }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["admin", "delivery", "blocked", vars.zoneId],
      });
      void qc.invalidateQueries({ queryKey: ["admin", "delivery", "slots", vars.zoneId] });
      void qc.invalidateQueries({ queryKey: ["delivery-slots"] });
    },
  });
}

export function useDeliveryBoard(zoneId: number | null, date: string) {
  return useQuery({
    queryKey: ["admin", "delivery", "board", zoneId, date],
    queryFn: () =>
      api.get<DeliveryBoard>("/admin/delivery/board", {
        zone_id: zoneId as number,
        date,
      }),
    enabled: zoneId !== null,
    // The board is a live view of today's work — keep it fresh while open.
    refetchInterval: 30_000,
  });
}
