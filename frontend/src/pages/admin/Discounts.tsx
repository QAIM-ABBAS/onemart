import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import {
  useAdminCategoryFlat,
  useAdminDiscounts,
  useAdminProducts,
  useDeleteDiscount,
  useSaveDiscount,
} from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { DiscountAdminOut, DiscountWrite } from "@/lib/types";
import { toast } from "@/stores/toast";

import { PromoBadge, promoWindow, toDateTimeLocal } from "@/components/admin/promo";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "value", label: "Biggest value" },
  { value: "expiry", label: "Expiring first" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All rules" },
  { value: "active", label: "Active" },
  { value: "scheduled", label: "Scheduled" },
  { value: "expired", label: "Expired" },
  { value: "inactive", label: "Inactive" },
];

const SCOPE_OPTIONS = [
  { value: "", label: "Every scope" },
  { value: "product", label: "Products" },
  { value: "category", label: "Categories" },
];

const KIND_OPTIONS = [
  { value: "percent", label: "Percent off" },
  { value: "fixed", label: "Flat ₹ off" },
];

const PAGE_SIZE = 20;

type Scope = "product" | "category";
type Kind = "percent" | "fixed";

interface FormState {
  scope: Scope;
  kind: Kind;
  value: string;
  productId: string;
  categoryId: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

type ModalState = { mode: "create" } | { mode: "edit"; discount: DiscountAdminOut };

const EMPTY_FORM: FormState = {
  scope: "product",
  kind: "percent",
  value: "",
  productId: "",
  categoryId: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
};

function formFrom(discount: DiscountAdminOut): FormState {
  return {
    scope: discount.scope,
    kind: discount.kind,
    value: String(discount.value),
    productId: discount.product_id != null ? String(discount.product_id) : "",
    categoryId: discount.category_id != null ? String(discount.category_id) : "",
    startsAt: toDateTimeLocal(discount.starts_at),
    endsAt: toDateTimeLocal(discount.ends_at),
    isActive: discount.is_active,
  };
}

export function AdminDiscountsPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    scope: sp.get("scope") ?? undefined,
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
  };

  const discounts = useAdminDiscounts(params);
  const save = useSaveDiscount();
  const remove = useDeleteDiscount();

  // Target lists for the form's dropdowns (the demo catalogue fits in one page).
  const products = useAdminProducts({ page: 1, page_size: 100, sort: "newest" });
  const categories = useAdminCategoryFlat();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function open(next: ModalState, values: FormState) {
    save.reset();
    setErrors({});
    setForm(values);
    setModal(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.scope === "product" && !form.productId) next.product_id = "Pick a product";
    if (form.scope === "category" && !form.categoryId) next.category_id = "Pick a category";
    const raw = form.value.trim();
    const value = Number(raw);
    if (raw === "" || Number.isNaN(value)) next.value = "Enter a value";
    else if (form.kind === "percent" && (value <= 0 || value > 100))
      next.value = "Percent must be between 1 and 100";
    else if (form.kind === "fixed" && value <= 0) next.value = "Must be greater than 0";
    if (form.startsAt && form.endsAt && new Date(form.startsAt) >= new Date(form.endsAt)) {
      next.ends_at = "End must be after start";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: DiscountWrite = {
      scope: form.scope,
      kind: form.kind,
      value,
      product_id: form.scope === "product" ? Number(form.productId) : null,
      category_id: form.scope === "category" ? Number(form.categoryId) : null,
      starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      is_active: form.isActive,
    };

    const editing = modal?.mode === "edit" ? modal.discount.id : undefined;
    try {
      await save.mutateAsync({ id: editing, payload });
      setModal(null);
      toast(editing ? "Discount updated." : "Discount created.", { tone: "positive" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  function toggleActive(discount: DiscountAdminOut) {
    save.mutate(
      { id: discount.id, payload: { is_active: !discount.is_active } },
      {
        onSuccess: (updated) =>
          toast(
            updated.is_active
              ? `${updated.product_name ?? updated.category_name ?? "Rule"} discount is on.`
              : "Discount turned off.",
            { tone: "positive" },
          ),
        onError: (err) =>
          toast(err instanceof Error ? err.message : "Could not update the discount.", {
            tone: "negative",
          }),
      },
    );
  }

  function handleDelete(discount: DiscountAdminOut) {
    const label = discount.product_name ?? discount.category_name ?? "this rule";
    if (!window.confirm(`Delete the discount on ${label}? This cannot be undone.`)) return;
    remove.mutate(discount.id, {
      onSuccess: () => toast("Discount deleted.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the discount.", {
          tone: "negative",
        }),
    });
  }

  const hasFilters = Boolean(params.q || params.status || params.scope);
  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;
  const busy = save.isPending || remove.isPending;

  const productOptions = products.data?.items ?? [];
  const categoryOptions = categories.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-brand-600">Promotions</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Discounts</h1>
          <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
            {discounts.data ? `${discounts.data.total} rules` : "Loading…"}
          </p>
        </div>
        <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New discount</Button>
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
            placeholder="Search product or category…"
            aria-label="Search discounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={params.scope ?? ""}
          onChange={(e) => update({ scope: e.target.value || undefined })}
          aria-label="Filter by scope"
          className="h-9 min-w-32 text-sm"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.status ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-32 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort discounts"
          className="h-9 min-w-40 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-5">
        {discounts.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="ml-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : discounts.isError ? (
          <ErrorState error={discounts.error} onRetry={() => void discounts.refetch()} />
        ) : discounts.data && discounts.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left">
                    <th className="label px-4 py-2.5 text-ink-muted">Applies to</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Type</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Window</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {discounts.data.items.map((discount) => (
                    <tr key={discount.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <span className="block font-medium">
                          {discount.product_name ?? discount.category_name ?? "—"}
                        </span>
                        <span className="block text-[0.75rem] text-ink-muted">
                          {discount.scope === "product" ? "Product" : "Category"}
                        </span>
                      </td>
                      <td className="num px-4 py-3">
                        {discount.kind === "percent"
                          ? `${discount.value}% off`
                          : `${money(discount.value)} off`}
                      </td>
                      <td className="num px-4 py-3 text-ink-muted">
                        {promoWindow(discount.starts_at, discount.ends_at)}
                      </td>
                      <td className="px-4 py-3">
                        <PromoBadge status={discount.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            loading={save.isPending && save.variables?.id === discount.id}
                            onClick={() => toggleActive(discount)}
                          >
                            {discount.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => open({ mode: "edit", discount }, formFrom(discount))}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleDelete(discount)}
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
              page={discounts.data.page}
              pages={discounts.data.pages}
              total={discounts.data.total}
              pageSize={discounts.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No discounts match" : "No automatic discounts yet"}
            body={
              hasFilters
                ? "Try a different filter or search term."
                : "Rules the cart applies on its own — no code needed. One best rule per product, no stacking."
            }
            action={
              hasFilters ? (
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
                <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>New discount</Button>
              )
            }
          />
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Edit discount" : "New discount"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="discount-form" type="submit" loading={save.isPending}>
              {modal?.mode === "edit" ? "Save changes" : "Create discount"}
            </Button>
          </>
        }
      >
        <form id="discount-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          {saveError ? <InlineError>{saveError}</InlineError> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applies to" htmlFor="discount-scope">
              <Select
                id="discount-scope"
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as Scope })}
              >
                <option value="product">A product</option>
                <option value="category">A category</option>
              </Select>
            </Field>
            <Field label="Type" htmlFor="discount-kind">
              <Select
                id="discount-kind"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {form.scope === "product" ? (
            <Field label="Product" htmlFor="discount-product" error={errors.product_id}>
              <Select
                id="discount-product"
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
              >
                <option value="">
                  {products.isLoading ? "Loading products…" : "Pick a product…"}
                </option>
                {productOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Category" htmlFor="discount-category" error={errors.category_id}>
              <Select
                id="discount-category"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">
                  {categories.isLoading ? "Loading categories…" : "Pick a category…"}
                </option>
                {categoryOptions.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Value"
            htmlFor="discount-value"
            error={errors.value}
            hint={form.kind === "percent" ? "1–100" : "Rupees off"}
          >
            <Input
              id="discount-value"
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder={form.kind === "percent" ? "10" : "50"}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Starts"
              htmlFor="discount-starts"
              error={errors.starts_at}
              hint="Empty = open now"
            >
              <Input
                id="discount-starts"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </Field>
            <Field
              label="Ends"
              htmlFor="discount-ends"
              error={errors.ends_at}
              hint="Empty = never"
            >
              <Input
                id="discount-ends"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>

          <Checkbox
            label="Active — apply this rule to carts right now"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
        </form>
      </Modal>
    </div>
  );
}
