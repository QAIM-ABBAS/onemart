import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/queries/notifications";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/stores/auth";

import { BellIcon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/States";

/** Header bell: unread badge + a dropdown of the latest 10 (poll-driven, see hooks). */
export function NotificationBell() {
  const { t } = useTranslation("nav");
  const user = useAuth((state) => state.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unread = useUnreadCount();
  const count = unread.data?.count ?? 0;
  const list = useNotifications({ page: 1, page_size: 10, sort: "newest" }, { enabled: open });
  const markRead = useMarkNotificationRead();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const openItem = (id: number, link: string | null, wasUnread: boolean) => {
    setOpen(false);
    if (wasUnread) markRead.mutate(id);
    navigate(link ?? "/notifications");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("notifications.label")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-10 items-center justify-center rounded-md border border-brand-700 bg-brand-800 text-brand-50 transition hover:bg-brand-700"
      >
        <BellIcon width={18} height={18} />
        {count > 0 ? (
          <span className="num absolute -end-1.5 -top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[0.65rem] leading-4 font-semibold text-surface">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          aria-label={t("notifications.label")}
          className="absolute end-0 top-[calc(100%+6px)] w-80 overflow-hidden rounded-md border border-line bg-surface shadow-panel sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">{t("notifications.label")}</p>
            <p className="label text-ink-muted">{count > 0 ? t("notifications.unread", { count }) : t("notifications.allRead")}</p>
          </div>

          {list.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-ink-muted">{t("notifications.error")}</p>
              <button
                type="button"
                onClick={() => void list.refetch()}
                className="label mt-2 text-brand-700 transition-colors hover:text-brand-800"
              >
                {t("notifications.retry")}
              </button>
            </div>
          ) : list.data && list.data.items.length > 0 ? (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n.id, n.link ?? null, n.read_at === null)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-surface-2",
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
                      <span
                        className={cn(
                          "block truncate text-sm",
                          n.read_at === null ? "font-semibold" : "font-medium",
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-muted">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="num mt-1 block text-xs text-ink-faint">
                        {formatDateTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium">{t("notifications.empty")}</p>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                {t("notifications.emptyBody")}
              </p>
            </div>
          )}

          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/notifications");
              }}
              className="block w-full px-4 py-3 text-center text-sm font-medium text-brand-700 transition hover:bg-surface-2"
            >
              {t("notifications.viewAll")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
