import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Notification, Page } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { toast } from "@/stores/toast";

export interface NotificationListParams {
  page: number;
  page_size: number;
  sort: string;
  unread?: boolean;
}

export const notificationKeys = {
  all: ["notifications"] as const,
  unreadCount: ["notifications", "unread-count"] as const,
  list: (params: NotificationListParams) => ["notifications", "list", params] as const,
};

/** 45s sits inside the spec's 30–60s polling window — no websockets yet. */
export const NOTIFICATIONS_POLL_MS = 45_000;

/** Nothing notification-shaped is fetched until the session is known and signed in. */
function useNotificationsEnabled(): boolean {
  const booted = useAuth((state) => state.booted);
  const user = useAuth((state) => state.user);
  return booted && user !== null;
}

export function useNotifications(
  params: NotificationListParams,
  options?: { enabled?: boolean },
) {
  const enabled = useNotificationsEnabled();
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () =>
      api.get<Page<Notification>>("/notifications", {
        page: params.page,
        page_size: params.page_size,
        sort: params.sort,
        unread: params.unread ? true : undefined,
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    enabled: enabled && (options?.enabled ?? true),
  });
}

export function useUnreadCount() {
  const enabled = useNotificationsEnabled();
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    staleTime: 10_000,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    enabled,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Notification>(`/notifications/${id}/read`),
    onSuccess: () => {
      // One invalidation covers the list *and* the bell count (prefix match).
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not mark that as read.", {
        tone: "negative",
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>("/notifications/read-all"),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      toast(
        data.updated > 0 ? "All notifications marked as read." : "Nothing was unread.",
        { tone: "positive" },
      );
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not mark all as read.", {
        tone: "negative",
      });
    },
  });
}
