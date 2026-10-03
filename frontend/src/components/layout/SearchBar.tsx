import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useCategories } from "@/hooks/queries/catalog";
import { useSuggest } from "@/hooks/useSuggest";
import { cn } from "@/lib/cn";
import type { CategoryNode } from "@/lib/types";

import { SearchIcon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { Skeleton } from "@/components/ui/States";

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.children?.length ? flatten(node.children, depth + 1) : []),
  ]);
}

interface SearchBarProps {
  className?: string;
  autoFocus?: boolean;
  onComplete?: () => void;
}

export function SearchBar({ className, autoFocus, onComplete }: SearchBarProps) {
  const navigate = useNavigate();
  const categories = useCategories();
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const suggest = useSuggest(debounced);
  const options = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  function go(path: string) {
    setOpen(false);
    onComplete?.();
    navigate(path);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (term.trim()) params.set("q", term.trim());
    if (scope) params.set("category", scope);
    go(`/products${params.size ? `?${params.toString()}` : ""}`);
  }

  const showPanel = open && suggest.enabled && (suggest.loading || suggest.products.length > 0 || suggest.categories.length > 0);

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <form onSubmit={onSubmit} role="search" className="flex w-full items-stretch rounded-md bg-surface border border-line transition focus-within:shadow-lift">
        <label className="relative hidden shrink-0 items-center lg:flex">
          <span className="sr-only">Search within a category</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-11 appearance-none bg-transparent pe-8 ps-3.5 text-[0.8125rem] font-medium text-ink focus:outline-none"
            aria-label="Search within a category"
          >
            <option value="">All categories</option>
            {options.map(({ node, depth }) => (
              <option key={node.id} value={node.slug}>
                {depth > 0 ? `${"— ".repeat(depth)}${node.name}` : node.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute end-3 text-ink-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </label>

        <div className="relative m-1 flex min-w-0 flex-1 items-center rounded-lg bg-surface-2 shadow-pressed">
          <SearchIcon
            width={16}
            height={16}
            className="pointer-events-none absolute start-3 text-ink-muted"
          />
          <input
            type="search"
            value={term}
            autoFocus={autoFocus}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search for atta, dal, soap, biscuits…"
            aria-label="Search products"
            aria-expanded={showPanel}
            aria-controls="search-suggestions"
            role="combobox"
            aria-autocomplete="list"
            className="h-9 w-full bg-transparent pe-3 ps-9 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          aria-label="Search"
          className="grid w-11 shrink-0 place-items-center rounded-md bg-brand-700 text-surface shadow-button transition hover:bg-brand-800"
        >
          <SearchIcon width={17} height={17} />
        </button>
      </form>

      {showPanel ? (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-96 overflow-y-auto rounded-md border border-line bg-surface shadow-panel"
        >
          {suggest.loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              {suggest.categories.length > 0 ? (
                <div className="bg-surface py-2">
                  <p className="label px-3.5 pb-1.5 text-ink-muted">Categories</p>
                  {suggest.categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => go(`/products?category=${cat.slug}`)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      <span>{cat.name}</span>
                      <span className="num text-[0.6875rem] text-ink-muted">
                        {typeof cat.product_count === "number" ? cat.product_count : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {suggest.products.length > 0 ? (
                <div className="py-2">
                  <p className="label px-3.5 pb-1.5 text-ink-muted">Products</p>
                  {suggest.products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => go(`/p/${product.slug}`)}
                      className="flex w-full items-center gap-3 px-3.5 py-2 text-start transition-colors hover:bg-surface-2"
                    >
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden bg-surface-2 text-[0.65rem] font-semibold text-brand-700">
                        {product.thumbnail ? (
                          <img src={product.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          product.name.slice(0, 2).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{product.name}</span>
                        <span className="block text-[0.6875rem] text-ink-muted">{product.brand ?? product.category}</span>
                      </span>
                      <Price value={product.price} compareAt={product.compare_at_price} size="sm" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
