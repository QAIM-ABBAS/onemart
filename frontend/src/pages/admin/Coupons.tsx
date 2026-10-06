import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { useAdminCoupons, useDeleteCoupon, useSaveCoupon } from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { CouponAdminOut, CouponWrite } from "@/lib/types";
import { toast } from "@/stores/toast";

import { PromoBadge, promoWindow, toDateTimeLocal, parseAmount } from "@/components/admin/promo";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "code", label: "Code A–Z" },
  { value: "usage", label: "Most used" },
  { value: "expiry", label: "Expiring first" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All coupons" },
  { value: "active", label: "Active" },
  { value: "scheduled", label: "Scheduled" },
  { value: "expired", label: "Expired" },
  { value: "inactive", label: "Inactive" },
];

const KIND_OPTIONS = [
  { value: "percent", label: "Percent off" },
  { value: "fixed", label: "Flat ₹ off" },
  { value: "free_delivery", label: "Free delivery" },
];

const PAGE_SIZE = 20;

type Kind = "percent" | "fixed" | "free_delivery";

interface FormState {
  code: string;
  description: string;
  kind: Kind;
  value: string;
  minSubtotal: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
}

type ModalState = { mode: "create" } | { mode: "edit"; coupon: CouponAdminOut };

const EMPTY_FORM: FormState = {
  code: "",
  description: "",
  kind: "percent",
  value: "",
  minSubtotal: "",
  maxDiscount: "",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perUserLimit: "",
  isActive: true,
};

function formFrom(coupon: CouponAdminOut): FormState {
  return {
    code: coupon.code,
    description: coupon.description ?? "",
    kind: coupon.kind,
    value: coupon.kind === "free_delivery" ? "" : String(coupon.value),
    minSubtotal: coupon.min_subtotal ? String(coupon.min_subtotal) : "",
    maxDiscount: coupon.max_discount != null ? String(coupon.max_discount) : "",
    startsAt: toDateTimeLocal(coupon.starts_at),
    endsAt: toDateTimeLocal(coupon.ends_at),
    usageLimit: coupon.usage_limit != null ? String(coupon.usage_limit) : "",
    perUserLimit: coupon.per_user_limit != null ? String(coupon.per_user_limit) : "",
    isActive: coupon.is_active,
  };
}

function kindLabel(coupon: CouponAdminOut): string {
  if (coupon.kind === "percent") return `${coupon.value}% off`;
  if (coupon.kind === "fixed") return `${money(coupon.value)} off`;
  return "Free delivery";
}

export function AdminCouponsPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
  };

  const coupons = useAdminCoupons(params);
  const save = useSaveCoupon();
  const remove = useDeleteCoupon();

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

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!form.code.trim()) next.code = "Code is required";
    if (form.kind !== "free_delivery") {
      const raw = form.value.trim();
      const value = Number(raw);
      if (raw === "" || Number.isNaN(value)) next.value = "Enter a value";
      else if (form.kind === "percent" && (value <= 0 || value > 100))
        next.value = "Percent must be between 1 and 100";
      else if (form.kind === "fixed" && value <= 0) next.value = "Must be greater than 0";
    }
    if (form.startsAt && form.endsAt && new Date(form.startsAt) >= new Date(form.endsAt)) {
      next.ends_at = "End must be after start";
    }
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: CouponWrite = {
      code: form.code.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      value: form.kind === "free_delivery" ? 0 : Number(form.value),
      min_subtotal: parseAmount(form.minSubtotal) ?? 0,
      max_discount: form.kind === "percent" ? (parseAmount(form.maxDiscount) ?? null) : null,
      starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      usage_limit: parseAmount(form.usageLimit) ?? null,
      per_user_limit: parseAmount(form.perUserLimit) ?? null,
      is_active: form.isActive,
    };

    const editing = modal?.mode === "edit" ? modal.coupon.id : undefined;
    try {
      await save.mutateAsync({ id: editing, payload });
      setModal(null);
      toast(editing ? "Coupon updated." : "Coupon created.", { tone: "positive" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  function toggleActive(coupon: CouponAdminOut) {
    save.mutate(
      { id: coupon.id, payload: { is_active: !coupon.is_active } },
      {
        onSuccess: (updated) =>
          toast(updated.is_active ? `${updated.code} is on.` : `${updated.code} turned off.`, {
            tone: "positive",
          }),
        onError: (err) =>
          toast(err instanceof Error ? err.message : "Could not update the coupon.", {
            tone: "negative",
          }),
      },
    );
  }

  function handleDelete(coupon: CouponAdminOut) {
    if (!window.confirm(`Delete ${coupon.code}? This cannot be undone.`)) return;
    remove.mutate(coupon.id, {
      onSuccess: () => toast("Coupon deleted.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the coupon.", {
          tone: "negative",
        }),
    });
  }

  const hasFilters = Boolean(params.q || params.status);
  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;
  const busy = save.isPending || remove.isPending;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-brand-600">Promotions</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Coupons</h1>
          <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
            {coupons.data ? `${coupons.data.total} coupons` : "Loading…"}
          </p>
        </div>
        <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New coupon</Button>
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
            placeholder="Search code or description…"
            aria-label="Search coupons"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
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
          aria-label="Sort coupons"
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
        {coupons.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : coupons.isError ? (
          <ErrorState error={coupons.error} onRetry={() => void coupons.refetch()} />
        ) : coupons.data && coupons.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left">
                    <th className="label px-4 py-2.5 text-ink-muted">Code</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Type</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Min order</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Window</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Used</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {coupons.data.items.map((coupon) => (
                    <tr key={coupon.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <span className="block font-medium">{coupon.code}</span>
                        {coupon.description ? (
                          <span className="block max-w-[260px] truncate text-[0.75rem] text-ink-muted">
                            {coupon.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{kindLabel(coupon)}</td>
                      <td className="num px-4 py-3 text-ink-muted">
                        {coupon.min_subtotal > 0 ? money(coupon.min_subtotal) : "—"}
                      </td>
                      <td className="num px-4 py-3 text-ink-muted">
                        {promoWindow(coupon.starts_at, coupon.ends_at)}
                      </td>
                      <td className="num px-4 py-3">
                        {coupon.used_count}
                        {coupon.usage_limit != null ? ` / ${coupon.usage_limit}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <PromoBadge status={coupon.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            loading={save.isPending && save.variables?.id === coupon.id}
                            onClick={() => toggleActive(coupon)}
                          >
                            {coupon.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => open({ mode: "edit", coupon }, formFrom(coupon))}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleDelete(coupon)}
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
              page={coupons.data.page}
              pages={coupons.data.pages}
              total={coupons.data.total}
              pageSize={coupons.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No coupons match" : "No coupons yet"}
            body={
              hasFilters
                ? "Try a different filter or search term."
                : "Codes customers can type at checkout — percent off, a flat amount, or free delivery."
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
                <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>New coupon</Button>
              )
            }
          />
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? `Edit ${modal.coupon.code}` : "New coupon"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="coupon-form" type="submit" loading={save.isPending}>
              {modal?.mode === "edit" ? "Save changes" : "Create coupon"}
            </Button>
          </>
        }
      >
        <form id="coupon-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          {saveError ? <InlineError>{saveError}</InlineError> : null}

          <Field label="Code" htmlFor="coupon-code" error={errors.code}>
            <Input
              id="coupon-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="WELCOME10"
              autoComplete="off"
            />
          </Field>

          <Field label="Description" htmlFor="coupon-desc" error={errors.description}>
            <Input
              id="coupon-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="10% off orders over ₹499"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="coupon-kind">
              <Select
                id="coupon-kind"
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
            <Field
              label="Value"
              htmlFor="coupon-value"
              error={errors.value}
              hint={form.kind === "free_delivery" ? "Waives the delivery line" : undefined}
            >
              <Input
                id="coupon-value"
                type="number"
                min="0"
                step="0.01"
                value={form.value}
                disabled={form.kind === "free_delivery"}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder={form.kind === "percent" ? "10" : "100"}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Min order (₹)" htmlFor="coupon-min" error={errors.min_subtotal}>
              <Input
                id="coupon-min"
                type="number"
                min="0"
                step="0.01"
                value={form.minSubtotal}
                onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
              />
            </Field>
            <Field
              label="Max cap (₹)"
              htmlFor="coupon-cap"
              error={errors.max_discount}
              hint={form.kind === "percent" ? "Caps a percent coupon" : "Percent only"}
            >
              <Input
                id="coupon-cap"
                type="number"
                min="0"
                step="0.01"
                value={form.maxDiscount}
                disabled={form.kind !== "percent"}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Starts"
              htmlFor="coupon-starts"
              error={errors.starts_at}
              hint="Empty = open now"
            >
              <Input
                id="coupon-starts"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Ends" htmlFor="coupon-ends" error={errors.ends_at} hint="Empty = never">
              <Input
                id="coupon-ends"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Total uses"
              htmlFor="coupon-usage"
              error={errors.usage_limit}
              hint="Empty = unlimited"
            >
              <Input
                id="coupon-usage"
                type="number"
                min="1"
                step="1"
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
              />
            </Field>
            <Field
              label="Uses per customer"
              htmlFor="coupon-per-user"
              error={errors.per_user_limit}
              hint="Empty = unlimited"
            >
              <Input
                id="coupon-per-user"
                type="number"
                min="1"
                step="1"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              />
            </Field>
          </div>

          <Checkbox
            label="Active — customers can use this code"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
        </form>
      </Modal>
    </div>
  );
}
