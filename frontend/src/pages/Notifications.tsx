import { useNavigate, useSearchParams } from "react-router-dom";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/queries/notifications";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { Notification } from "@/lib/types";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function NotificationsPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();

  const page = Math.max(Number(sp.get("page")) || 1, 1);
  const unreadOnly = sp.get("filter") === "unread";
  const sort = sp.get("sort") ?? "newest";

  const list = useNotifications({ page, page_size: PAGE_SIZE, sort, unread: unreadOnly });
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    setSp(next);
  };

  const open = (n: Notification) => {
    if (n.read_at === null) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const unreadCount = unread.data?.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-brand-600">Your account</p>
          <h1 className="mt-1.5 text-3xl">Notifications</h1>
          <p className="num mt-1 text-sm text-ink-muted">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => update({ filter: undefined, page: undefined })}
              aria-pressed={!unreadOnly}
              className={cn(
                "h-8 rounded-md px-3 text-sm transition",
                !unreadOnly
                  ? "bg-surface-2 font-semibold text-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => update({ filter: "unread", page: undefined })}
              aria-pressed={unreadOnly}
              className={cn(
                "h-8 rounded-md px-3 text-sm transition",
                unreadOnly
                  ? "bg-surface-2 font-semibold text-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              Unread
            </button>
          </div>
          <Select
            value={sort}
            onChange={(e) => update({ sort: e.target.value, page: undefined })}
            aria-label="Sort notifications"
            className="h-9 min-w-40 text-sm"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all as read
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {list.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="px-4 py-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data && list.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-4 text-start transition hover:bg-surface-2",
                      n.read_at === null && "bg-brand-50/60",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read_at === null ? "bg-brand-600" : "bg-line",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-sm",
                            n.read_at === null ? "font-semibold" : "font-medium",
                          )}
                        >
                          {n.title}
                        </span>
                        {n.read_at === null ? <span className="label text-brand-600">Unread</span> : null}
                      </span>
                      {n.body ? (
                        <span className="mt-1 block text-sm text-ink-muted">{n.body}</span>
                      ) : null}
                      <span className="num mt-1.5 block text-xs text-ink-faint">
                        {formatDateTime(n.created_at)}
                      </span>
                    </span>
                    {n.link ? <span className="label shrink-0 text-brand-600">Open →</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              className="mt-5"
              page={page}
              pages={list.data.pages}
              total={list.data.total}
              pageSize={PAGE_SIZE}
              onChange={(p) => update({ page: p })}
            />
          </>
        ) : (
          <EmptyState
            title={unreadOnly ? "You're all caught up" : "No notifications yet"}
            body={
              unreadOnly
                ? "Every notification has been read."
                : "Order updates, cancellations and store news will appear here."
            }
            action={
              unreadOnly ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ filter: undefined, page: undefined })}
                >
                  Show all notifications
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
