import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ProductCard, ProductGrid, ProductGridSkeleton } from "@/components/catalog/ProductCard";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select } from "@/components/ui/Form";
import { SearchIcon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useCategories, useFacets, useProducts, type ProductQueryParams } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";
import type { CategoryNode } from "@/lib/types";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "bestselling", label: "Best selling" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name_asc", label: "Name: A to Z" },
  { value: "name_desc", label: "Name: Z to A" },
];

const PAGE_SIZE = 24;

function num(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

interface FilterPanelProps {
  params: ProductQueryParams;
  update: (patch: Record<string, string | undefined>) => void;
  clearAll: () => void;
}

function FilterPanel({ params, update, clearAll }: FilterPanelProps) {
  const categories = useCategories();
  const facets = useFacets(params);
  const [minInput, setMinInput] = useState(params.min_price?.toString() ?? "");
  const [maxInput, setMaxInput] = useState(params.max_price?.toString() ?? "");

  useEffect(() => {
    setMinInput(params.min_price?.toString() ?? "");
    setMaxInput(params.max_price?.toString() ?? "");
  }, [params.min_price, params.max_price]);

  function applyPrice(e: FormEvent) {
    e.preventDefault();
    update({
      min_price: minInput.trim() || undefined,
      max_price: maxInput.trim() || undefined,
    });
  }

  function renderCategory(cat: CategoryNode, depth = 0) {
    const active = params.category === cat.slug;
    return (
      <li key={cat.id}>
        <Link
          to={`/products${cat.slug ? `?category=${cat.slug}` : ""}`}
          onClick={(e) => {
            e.preventDefault();
            update({ category: cat.slug, brand: undefined });
          }}
          className={cn(
            "flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition",
            active
              ? "bg-surface font-semibold text-brand-700 "
              : depth === 0
                ? "font-medium text-ink hover:bg-surface-2"
                : "text-ink-muted hover:bg-surface-2",
          )}
          style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.85}rem` } : undefined}
        >
          <span>{cat.name}</span>
          {typeof cat.product_count === "number" ? (
            <span className={cn("num text-[0.6875rem]", active ? "text-brand-600" : "text-ink-muted")}>
              {cat.product_count}
            </span>
          ) : null}
        </Link>
        {cat.children && cat.children.length > 0 ? (
          <ul className="ml-1">{cat.children.map((child) => renderCategory(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  const hasFilters =
    Boolean(params.category || params.brand || params.in_stock) ||
    params.min_price !== undefined ||
    params.max_price !== undefined;

  return (
    <div className="space-y-7">
      <div>
        <div className="flex items-center justify-between pb-2">
          <p className="label text-ink">Categories</p>
          {params.category ? (
            <button
              type="button"
              onClick={() => update({ category: undefined })}
              className="text-[0.75rem] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
        <ul className="mt-2 space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => update({ category: undefined })}
              className={cn(
                "flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition",
                !params.category
                  ? "bg-surface font-semibold text-brand-700 "
                  : "font-medium text-ink hover:bg-surface-2",
              )}
            >
              All categories
            </button>
          </li>
          {categories.isLoading ? (
            <li className="space-y-2 pt-1">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-3/5" />
            </li>
          ) : (
            (categories.data ?? []).map((cat) => renderCategory(cat))
          )}
        </ul>
      </div>

      {facets.data?.brands && facets.data.brands.length > 0 ? (
        <div>
          <div className="flex items-center justify-between pb-2">
            <p className="label text-ink">Brands</p>
            {params.brand ? (
              <button
                type="button"
                onClick={() => update({ brand: undefined })}
                className="text-[0.75rem] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {facets.data.brands.map((brand) => {
              const active = params.brand === brand.slug;
              return (
                <li key={brand.id}>
                  <button
                    type="button"
                    onClick={() => update({ brand: active ? undefined : brand.slug })}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[0.8125rem] transition",
                      active
                        ? "bg-surface font-semibold text-brand-700 border border-line"
                        : "bg-surface-2 text-ink-muted hover:bg-surface",
                    )}
                  >
                    {brand.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="label pb-2 text-ink">Price</p>
        <form onSubmit={applyPrice} className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            aria-label="Minimum price"
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            className="h-9 text-sm"
          />
          <span className="text-ink-muted">–</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            aria-label="Maximum price"
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
        </form>
        {facets.data ? (
          <p className="mt-2 text-[0.75rem] text-ink-muted num">
            {typeof facets.data.min_price === "number"
              ? `Listed from ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(facets.data.min_price)}`
              : ""}
          </p>
        ) : null}
      </div>

      <div>
        <Checkbox
          label="In stock only"
          checked={Boolean(params.in_stock)}
          onChange={(e) => update({ in_stock: e.target.checked ? "1" : undefined })}
        />
      </div>

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="w-full justify-start px-0">
          Clear all filters
        </Button>
      ) : null}
    </div>
  );
}

export function BrowsePage() {
  const [sp, setSp] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const params: ProductQueryParams = useMemo(() => {
    const out: ProductQueryParams = {
      page: num(sp.get("page")) ?? 1,
      page_size: PAGE_SIZE,
      sort: sp.get("sort") ?? "newest",
      category: sp.get("category") ?? undefined,
      brand: sp.get("brand") ?? undefined,
      q: sp.get("q") ?? undefined,
      min_price: num(sp.get("min_price")),
      max_price: num(sp.get("max_price")),
      in_stock: sp.get("in_stock") === "1",
      featured: sp.get("featured") === "1",
    };
    return out;
  }, [sp]);

  const products = useProducts(params);
  const categories = useCategories();

  const activeCategory = useMemo(() => {
    if (!params.category) return null;
    const find = (nodes: CategoryNode[]): CategoryNode | null => {
      for (const node of nodes) {
        if (node.slug === params.category) return node;
        const hit = node.children ? find(node.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    return find(categories.data ?? []);
  }, [categories.data, params.category]);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    if (params.sort && params.sort !== "newest") next.set("sort", params.sort);
    setSp(next);
  }

  const title = params.q
    ? `Results for “${params.q}”`
    : activeCategory
      ? activeCategory.name
      : params.featured
        ? "Featured products"
        : "All products";

  const page = params.page ?? 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-brand-600">{params.q ? "Search" : "Catalogue"}</p>
          <h1 className="mt-1.5 text-3xl sm:text-[2.25rem]">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-muted num" aria-live="polite">
            {products.data
              ? `${products.data.total} product${products.data.total === 1 ? "" : "s"}`
              : "Loading products…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            Filters
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <span className="label hidden text-ink-muted sm:inline">Sort</span>
            <Select
              value={params.sort ?? "newest"}
              onChange={(e) => update({ sort: e.target.value })}
              aria-label="Sort products"
              className="h-9 min-w-44 text-sm"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      {/* Results row: parent is a flex row, the filter sidebar and the results
          are its two child boxes. Below lg the sidebar box leaves the flow
          entirely and the Filters button opens it as a dialog instead; at lg it
          holds its own width and the results box grows into the rest. */}
      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <aside className="hidden lg:block lg:w-60 lg:shrink-0">
          <div className="sticky top-36 rounded-md bg-surface p-5 border border-line">
            <FilterPanel params={params} update={update} clearAll={clearAll} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {products.isLoading ? (
            <ProductGridSkeleton count={8} />
          ) : products.isError ? (
            <ErrorState error={products.error} onRetry={() => void products.refetch()} />
          ) : products.data && products.data.items.length > 0 ? (
            <>
              <ProductGrid>
                {products.data.items.map((item) => (
                  <ProductCard key={item.id} item={item} />
                ))}
              </ProductGrid>
              <Pagination
                className="mt-6"
                page={page}
                pages={products.data.pages}
                total={products.data.total}
                pageSize={products.data.page_size}
                onChange={(next) => {
                  update({ page: String(next) });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </>
          ) : (
            <EmptyState
              title="No products match these filters"
              body="Try removing a filter or searching for something else."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button variant="secondary" onClick={clearAll}>
                    Clear filters
                  </Button>
                  <Link to="/products">
                    <Button variant="primary">Browse everything</Button>
                  </Link>
                </div>
              }
            />
          )}
        </div>
      </div>

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        description="Narrow down the catalogue"
        footer={
          <Button block onClick={() => setFiltersOpen(false)}>
            <SearchIcon width={15} height={15} />
            {products.data ? `Show ${products.data.total} products` : "Show products"}
          </Button>
        }
      >
        <FilterPanel params={params} update={update} clearAll={clearAll} />
      </Modal>
    </div>
  );
}
