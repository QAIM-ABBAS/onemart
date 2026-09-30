import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  useAdminCategories,
  useAdminProducts,
  useDeleteProduct,
} from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { CategoryNode, ProductAdminOut } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "updated", label: "Recently updated" },
];

const PAGE_SIZE = 20;

function flattenCategories(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  const out: { node: CategoryNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children?.length) out.push(...flattenCategories(node.children, depth + 1));
  }
  return out;
}

function SkeletonRows() {
  return (
    <div className="space-y-px bg-line">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 bg-surface px-4 py-3.5">
          <Skeleton className="h-11 w-11" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

export function AdminProductsPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [deleteTarget, setDeleteTarget] = useState<ProductAdminOut | null>(null);
  const deleteProduct = useDeleteProduct();

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    q: sp.get("q") ?? undefined,
    category: sp.get("category") ?? undefined,
    active: sp.get("active") === "1" ? true : sp.get("active") === "0" ? false : undefined,
  };

  const products = useAdminProducts(params);
  const categories = useAdminCategories();
  const flat = flattenCategories(categories.data ?? []);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-leaf">Catalogue</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Products</h1>
          <p className="mt-1 text-sm text-ink-soft num" aria-live="polite">
            {products.data ? `${products.data.total} products` : "Loading…"}
          </p>
        </div>
        <Link to="/admin/products/new">
          <Button>+ New product</Button>
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <form
          className="flex min-w-56 flex-1 gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() || undefined });
          }}
        >
          <Input
            type="search"
            placeholder="Search name or SKU…"
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={params.category ?? ""}
          onChange={(e) => update({ category: e.target.value || undefined })}
          aria-label="Filter by category"
          className="h-9 min-w-40 text-sm"
        >
          <option value="">All categories</option>
          {flat.map(({ node, depth }) => (
            <option key={node.id} value={node.slug}>
              {depth > 0 ? `${"— ".repeat(depth)}` : ""}
              {node.name}
            </option>
          ))}
        </Select>
        <Select
          value={params.active === true ? "1" : params.active === false ? "0" : ""}
          onChange={(e) => update({ active: e.target.value || undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-32 text-sm"
        >
          <option value="">All statuses</option>
          <option value="1">Active only</option>
          <option value="0">Hidden only</option>
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort products"
          className="h-9 min-w-44 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-5">
        {products.isLoading ? (
          <SkeletonRows />
        ) : products.isError ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : products.data && products.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto border border-line bg-surface">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper/70 text-left">
                    <th className="label px-4 py-2.5 text-ink-soft">Product</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Category</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Price</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Stock</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Status</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.data.items.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-mist/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="size-11 shrink-0 overflow-hidden border border-line bg-mist">
                            {p.thumbnail ? (
                              <img
                                src={p.thumbnail}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="grid h-full w-full place-items-center font-display text-sm text-forest/30">
                                {p.name[0]}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="num text-[0.75rem] text-ink-soft">
                              {p.variant_count} variant{p.variant_count === 1 ? "" : "s"}
                              {p.brand ? ` · ${p.brand}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{p.category}</td>
                      <td className="num px-4 py-3 font-medium">{money(p.price)}</td>
                      <td className="num px-4 py-3">
                        {p.available === 0 ? (
                          <span className="text-brick">0</span>
                        ) : (
                          p.available
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.is_active ? "positive" : "neutral"}>
                          {p.is_active ? "Active" : "Hidden"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Link to={`/admin/products/${p.id}/edit`}>
                            <Button variant="secondary" size="sm">
                              Edit
                            </Button>
                          </Link>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteTarget(p)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              className="mt-5"
              page={products.data.page}
              pages={products.data.pages}
              total={products.data.total}
              pageSize={products.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={params.q || params.category ? "No products match" : "No products yet"}
            body={
              params.q || params.category
                ? "Try clearing the search or filters."
                : "Create your first product with at least one variant."
            }
            action={
              params.q || params.category ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setSp(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Link to="/admin/products/new">
                  <Button>New product</Button>
                </Link>
              )
            }
          />
        )}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete product"
        description="This removes the product and its variants from the catalogue."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteProduct.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteProduct.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                });
              }}
            >
              Delete product
            </Button>
          </>
        }
      >
        {deleteProduct.isError ? (
          <InlineError className="mb-3">
            {deleteProduct.error instanceof ApiError
              ? deleteProduct.error.message
              : "Could not delete this product."}
          </InlineError>
        ) : null}
        {deleteTarget ? (
          <p className="text-sm">
            Delete <span className="font-medium">{deleteTarget.name}</span> and its{" "}
            <span className="num">{deleteTarget.variant_count}</span> variant
            {deleteTarget.variant_count === 1 ? "" : "s"}? Orders that already contain this product
            keep their snapshots.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
