import { cn } from "@/lib/cn";

import { ChevronLeftIcon, ChevronRightIcon } from "./Icon";

function pageWindow(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onChange,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-4", className)}
    >
      <p className="text-[0.8125rem] text-ink-muted num">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1 rounded-md bg-surface p-1.5 border border-line">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="grid size-9 place-items-center rounded-lg text-ink transition hover:bg-surface-2 disabled:opacity-35"
        >
          <ChevronLeftIcon width={16} height={16} />
        </button>
        {pageWindow(page, pages).map((entry, i) =>
          entry === "gap" ? (
            <span key={`gap-${i}`} className="px-1.5 text-ink-muted text-sm select-none">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-current={entry === page ? "page" : undefined}
              onClick={() => onChange(entry)}
              className={cn(
                "num min-w-9 h-9 px-2 rounded-lg text-sm transition",
                entry === page
                  ? "bg-surface font-semibold text-brand-700 border border-line"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="grid size-9 place-items-center rounded-lg text-ink transition hover:bg-surface-2 disabled:opacity-35"
        >
          <ChevronRightIcon width={16} height={16} />
        </button>
      </div>
    </nav>
  );
}
