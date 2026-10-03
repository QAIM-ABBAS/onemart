import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { useCategories } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";

import { ChevronRightIcon, GridIcon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/States";

export function MegaMenu({
  open,
  onClose,
  className,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
}) {
  const categories = useCategories();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const roots = categories.data ?? [];

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-md border border-line bg-surface shadow-panel",
        className,
      )}
    >
      <div className="page grid gap-6 py-6 sm:grid-cols-2 lg:grid-cols-4">
        {categories.isLoading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-3/5" />
              </div>
            ))
          : roots.map((root) => (
              <div key={root.id}>
                <Link
                  to={`/products?category=${root.slug}`}
                  onClick={onClose}
                  className="label inline-flex items-center gap-1.5 text-brand-700 transition-colors hover:text-brand-600"
                >
                  <GridIcon width={14} height={14} />
                  {root.name}
                </Link>
                <ul className="mt-2.5 space-y-1">
                  {(root.children ?? []).map((child) => (
                    <li key={child.id}>
                      <Link
                        to={`/products?category=${child.slug}`}
                        onClick={onClose}
                        className="group flex items-center justify-between rounded-lg px-2 py-1 text-[0.8125rem] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <span>{child.name}</span>
                        <ChevronRightIcon
                          width={13}
                          height={13}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </Link>
                    </li>
                  ))}
                  {(root.children ?? []).length === 0 ? (
                    <li className="py-1 text-[0.8125rem] text-ink-muted">No subcategories</li>
                  ) : null}
                </ul>
              </div>
            ))}
        <div className="sm:col-span-2 lg:col-span-4">
          <Link
            to="/products"
            onClick={onClose}
            className="label inline-flex items-center gap-2 rounded-lg px-2 py-1 text-brand-700 transition-colors hover:bg-surface-2 hover:text-brand-600"
          >
            Browse the full catalogue
            <ChevronRightIcon width={14} height={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
