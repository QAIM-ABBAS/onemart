/* ═══════════════════════════════════════════════════════════════════════
   ADMIN — FLASH DEALS
   ═══════════════════════════════════════════════════════════════════════
   Two levels, the same shape as Zones & slots:
     1. the deals table (search / status filter / sort / pagination),
     2. selecting a deal opens its item panel — live sold/remaining
        counters, add/edit items with variant search, end early.

   Money and stock previews are advisory; the server re-validates every
   write (price must beat list, percent 1–99, exactly one price shape).
   ═══════════════════════════════════════════════════════════════════════ */

import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { toDateTimeLocal } from "@/components/admin/promo";
import {
  useAddDealItem,
  useAdminDealItems,
  useAdminDeals,
  useDeleteDeal,
  useDeleteDealItem,
  useEndDeal,
  useSaveDeal,
  useUpdateDealItem,
  useVariantSearch,
} from "@/hooks/queries/flash-admin";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, money } from "@/lib/format";
import type {
  FlashDealAdminOut,
  FlashDealItemAdminOut,
  FlashDealItemWrite,
  FlashDealStatus,
  FlashDealWrite,
  FlashVariantRow,
} from "@/lib/types";
import { toast } from "@/stores/toast";

import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const PAGE_SIZE = 20;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
];

const STATUS_TONE: Record<FlashDealStatus, Tone> = {
  live: "positive",
  scheduled: "info",
  ended: "neutral",
  inactive: "warning",
};

const STATUS_LABEL: Record<FlashDealStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  inactive: "Inactive",
};

function DealStatusBadge({ status }: { status: FlashDealStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

function windowText(deal: FlashDealAdminOut): string {
  const from = deal.starts_at ? formatDateTime(deal.starts_at) : "immediately";
  const until = deal.ends_at ? formatDateTime(deal.ends_at) : "no end";
  return `${from} → ${until}`;
}

/** Deal ↔ form conversion (datetimes travel as browser-local input values). */
interface DealForm {
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

const EMPTY_DEAL_FORM: DealForm = { name: "", starts_at: "", ends_at: "", is_active: true };

function dealFormFrom(deal: FlashDealAdminOut): DealForm {
  return {
    name: deal.name,
    starts_at: toDateTimeLocal(deal.starts_at),
    ends_at: toDateTimeLocal(deal.ends_at),
    is_active: deal.is_active,
  };
}

/* ═══ PAGE ═══════════════════════════════════════════════════════════ */
export function AdminFlashPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; deal: FlashDealAdminOut } | null>(null);
  const [form, setForm] = useState<DealForm>(EMPTY_DEAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedDeal, setSelectedDeal] = useState<number | null>(null);

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
  };

  const deals = useAdminDeals(params);
  const save = useSaveDeal();
  const remove = useDeleteDeal();
  const endDeal = useEndDeal();

  const dealList = deals.data?.items ?? [];
  const detailDeal = dealList.find((d) => d.id === selectedDeal) ?? null;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function open(next: { mode: "create" } | { mode: "edit"; deal: FlashDealAdminOut }, values: DealForm) {
    save.reset();
    setErrors({});
    setForm(values);
    setModal(next);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Enter a deal name (2+ characters)";
    if (form.starts_at && form.ends_at) {
      const starts = new Date(form.starts_at).getTime();
      const ends = new Date(form.ends_at).getTime();
      if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends <= starts)
        next.ends_at = "End time must be after the start time";
    }
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: FlashDealWrite = {
      name: form.name.trim(),
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      is_active: form.is_active,
    };

    const editing = modal?.mode === "edit" ? modal.deal.id : undefined;
    try {
      await save.mutateAsync({ id: editing, payload });
      setModal(null);
      toast(editing ? "Deal updated." : "Deal created.", { tone: "positive" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  function handleDelete(deal: FlashDealAdminOut) {
    if (
      !window.confirm(
        `Delete "${deal.name}"? Its items go with it; orders that bought from it keep their records.`,
      )
    )
      return;
    remove.mutate(deal.id, {
      onSuccess: () => {
        if (selectedDeal === deal.id) setSelectedDeal(null);
        toast("Deal deleted.", { tone: "positive" });
      },
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the deal.", { tone: "negative" }),
    });
  }

  function handleEndEarly(deal: FlashDealAdminOut) {
    if (!window.confirm(`End "${deal.name}" right now? It will disappear from the storefront.`)) return;
    endDeal.mutate(deal.id, {
      onSuccess: () => toast("Deal ended early.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not end the deal.", { tone: "negative" }),
    });
  }

  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;
  const busy = save.isPending || remove.isPending || endDeal.isPending;

  return (
    <div>
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-brand-600">Marketing</p>
        <h1 className="mt-1.5 text-2xl sm:text-3xl">Flash deals</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Timed, stock-limited sale prices. The deal price wins over automatic discounts while the
          window is open and stock lasts.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <p className="num text-sm text-ink-muted" aria-live="polite">
          {deals.data ? `${deals.data.total} deals` : "Loading…"}
        </p>
        <Button onClick={() => open({ mode: "create" }, EMPTY_DEAL_FORM)}>+ New deal</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <form
          className="flex min-w-56 flex-1 gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() || undefined });
          }}
        >
          <Input
            type="search"
            placeholder="Search deal name…"
            aria-label="Search deals"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={sp.get("status") ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-32 text-sm"
        >
          <option value="">All statuses</option>
          <option value="live">Live</option>
          <option value="scheduled">Scheduled</option>
          <option value="ended">Ended</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort deals"
          className="h-9 min-w-40 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {deals.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="ml-auto h-5 w-28" />
              </div>
            ))}
          </div>
        ) : deals.isError ? (
          <ErrorState error={deals.error} onRetry={() => void deals.refetch()} />
        ) : dealList.length === 0 ? (
          <EmptyState
            title="No flash deals"
            body="Create a timed deal, then add the variants it discounts. The storefront strip appears only while one is live."
            action={
              <Button onClick={() => open({ mode: "create" }, EMPTY_DEAL_FORM)}>+ New deal</Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left">
                  <th className="label px-4 py-2.5 text-ink-muted">Deal</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Window</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Items</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Claimed</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dealList.map((deal) => {
                  const pct =
                    deal.stock_limit > 0
                      ? Math.min(100, Math.round((deal.stock_sold / deal.stock_limit) * 100))
                      : 0;
                  return (
                    <tr key={deal.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedDeal(deal.id)}
                          className="font-medium text-brand-600 underline underline-offset-2"
                        >
                          {deal.name}
                        </button>
                      </td>
                      <td className="num px-4 py-3 text-ink-muted">{windowText(deal)}</td>
                      <td className="num px-4 py-3">{deal.item_count}</td>
                      <td className="px-4 py-3">
                        <div className="min-w-32">
                          <div className="h-1.5 overflow-hidden rounded-full bg-deal-50">
                            <div
                              className="h-full rounded-full bg-deal-600"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="num mt-1 block text-[0.75rem] text-ink-muted">
                            {deal.stock_sold} / {deal.stock_limit} claimed
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DealStatusBadge status={deal.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setSelectedDeal(deal.id)}
                          >
                            Items
                          </Button>
                          {deal.status === "live" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => handleEndEarly(deal)}
                            >
                              End now
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => open({ mode: "edit", deal }, dealFormFrom(deal))}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleDelete(deal)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={deals.data?.page ?? 1}
              pages={deals.data?.pages ?? 1}
              total={deals.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              onChange={(page) => update({ page: String(page) })}
            />
          </div>
        )}
      </div>

      {detailDeal ? (
        <DealDetail deal={detailDeal} onClose={() => setSelectedDeal(null)} />
      ) : null}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? `Edit ${modal.deal.name}` : "New flash deal"}
        description="Blank start = live now; blank end = runs until you end it. The storefront strip hides itself when nothing is live."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="deal-form" type="submit" loading={busy}>
              {modal?.mode === "edit" ? "Save deal" : "Create deal"}
            </Button>
          </>
        }
      >
        <form id="deal-form" onSubmit={handleSubmit} className="space-y-4">
          {saveError ? <InlineError>{saveError}</InlineError> : null}
          <Field label="Deal name" htmlFor="deal_name" error={errors.name}>
            <Input
              id="deal_name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              invalid={Boolean(errors.name)}
              placeholder="Weekend Flash Sale"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="deal_starts" hint="Blank = immediately">
              <Input
                id="deal_starts"
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value }))}
              />
            </Field>
            <Field label="Ends" htmlFor="deal_ends" error={errors.ends_at} hint="Blank = no end">
              <Input
                id="deal_ends"
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value }))}
                invalid={Boolean(errors.ends_at)}
              />
            </Field>
          </div>
          <Checkbox
            label="Active (deals can be paused without deleting their items)"
            checked={form.is_active}
            onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>
    </div>
  );
}

/* ═══ DEAL DETAIL — ITEMS ════════════════════════════════════════════ */
type ItemModalState = { mode: "create" } | { mode: "edit"; item: FlashDealItemAdminOut };

interface ItemForm {
  deal_price: string;
  deal_percent: string;
  stock_limit: string;
  per_user_limit: string;
}

const EMPTY_ITEM_FORM: ItemForm = { deal_price: "", deal_percent: "", stock_limit: "", per_user_limit: "" };

function itemFormFrom(item: FlashDealItemAdminOut): ItemForm {
  return {
    deal_price: item.deal_price != null ? String(item.deal_price) : "",
    deal_percent: item.deal_percent != null ? String(item.deal_percent) : "",
    stock_limit: String(item.stock_limit),
    per_user_limit: item.per_user_limit != null ? String(item.per_user_limit) : "",
  };
}

function DealDetail({ deal, onClose }: { deal: FlashDealAdminOut; onClose: () => void }) {
  const items = useAdminDealItems(deal.id);
  const [modal, setModal] = useState<ItemModalState | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<FlashVariantRow | null>(null);
  const [query, setQuery] = useState("");

  const addItem = useAddDealItem(deal.id);
  const updateItem = useUpdateDealItem();
  const deleteItem = useDeleteDealItem(deal.id);
  const search = useVariantSearch(modal?.mode === "create" ? query : "");

  const itemList = items.data ?? [];
  const editingListPrice =
    modal?.mode === "edit" ? modal.item.list_price : picked?.price ?? null;

  const priceShape = form.deal_price.trim() ? "price" : form.deal_percent.trim() ? "percent" : "none";

  function openCreate() {
    addItem.reset();
    setErrors({});
    setPicked(null);
    setQuery("");
    setForm(EMPTY_ITEM_FORM);
    setModal({ mode: "create" });
  }

  function openEdit(item: FlashDealItemAdminOut) {
    updateItem.reset();
    setErrors({});
    setForm(itemFormFrom(item));
    setModal({ mode: "edit", item });
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (modal?.mode === "create" && !picked) next.variant = "Pick a variant first";
    if (priceShape === "none") next.price = "Enter a deal price OR a percent off (exactly one)";
    if (priceShape === "price") {
      const value = Number(form.deal_price);
      if (!Number.isFinite(value) || value <= 0) next.price = "Enter a price above 0";
      else if (editingListPrice != null && value >= editingListPrice)
        next.price = `Deal price must be below the list price (${money(editingListPrice)})`;
    }
    if (priceShape === "percent") {
      const value = Number(form.deal_percent);
      if (!Number.isFinite(value) || value < 1 || value > 99)
        next.price = "Percent must be between 1 and 99";
    }
    const limit = Number(form.stock_limit);
    if (!Number.isInteger(limit) || limit < 1) next.stock_limit = "Enter a whole number of units";
    if (form.per_user_limit.trim()) {
      const perUser = Number(form.per_user_limit);
      if (!Number.isInteger(perUser) || perUser < 1)
        next.per_user_limit = "Leave blank or enter 1+";
    }
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: FlashDealItemWrite = {
      variant_id: modal?.mode === "edit" ? modal.item.variant_id : picked!.variant_id,
      deal_price: priceShape === "price" ? Number(form.deal_price) : null,
      deal_percent: priceShape === "percent" ? Number(form.deal_percent) : null,
      deal_stock_limit: Number(form.stock_limit),
      per_user_limit: form.per_user_limit.trim() ? Number(form.per_user_limit) : null,
    };

    try {
      if (modal?.mode === "edit") {
        await updateItem.mutateAsync({ itemId: modal.item.id, payload });
        toast("Item updated.", { tone: "positive" });
      } else {
        await addItem.mutateAsync(payload);
        toast("Item added to the deal.", { tone: "positive" });
      }
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError) {
        const field = err.fieldErrors();
        setErrors(field);
        if (Object.keys(field).length === 0)
          setErrors({ price: err.message });
      }
    }
  }

  function handleDelete(item: FlashDealItemAdminOut) {
    if (!window.confirm(`Remove ${item.product_name} (${item.variant_name}) from this deal?`)) return;
    deleteItem.mutate(item.id, {
      onSuccess: () => toast("Item removed.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not remove the item.", { tone: "negative" }),
    });
  }

  const itemError =
    (addItem.isError || updateItem.isError) &&
    ((addItem.error instanceof ApiError && Object.keys(addItem.error.fieldErrors()).length === 0) ||
      (updateItem.error instanceof ApiError &&
        Object.keys(updateItem.error.fieldErrors()).length === 0))
      ? (addItem.error instanceof ApiError ? addItem.error.message : null) ??
        (updateItem.error instanceof ApiError ? updateItem.error.message : null)
      : null;
  const busy = addItem.isPending || updateItem.isPending || deleteItem.isPending;

  // Advisory preview of what a unit will cost (server does the maths too).
  const previewPrice =
    priceShape === "price"
      ? Number(form.deal_price) || null
      : priceShape === "percent" && editingListPrice != null
        ? Math.round(editingListPrice * (1 - Number(form.deal_percent) / 100) * 100) / 100
        : null;

  return (
    <section className="mt-6 rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg">{deal.name} — items</h2>
          <p className="text-sm text-ink-muted">
            {windowText(deal)} · <DealStatusBadge status={deal.status} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={openCreate}>
            + Add item
          </Button>
        </div>
      </div>

      <div className="px-5 py-5">
        {items.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : items.isError ? (
          <ErrorState error={items.error} onRetry={() => void items.refetch()} />
        ) : itemList.length === 0 ? (
          <EmptyState
            title="No items yet"
            body="Add the variants this deal discounts — search by product name or SKU."
            action={<Button onClick={openCreate}>+ Add item</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left">
                  <th className="label px-4 py-2.5 text-ink-muted">Product</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Price</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Sold / limit</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Per user</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {itemList.map((item) => {
                  const pct =
                    item.stock_limit > 0
                      ? Math.min(100, Math.round((item.stock_sold / item.stock_limit) * 100))
                      : 0;
                  return (
                    <tr key={item.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <span className="block font-medium">{item.product_name}</span>
                        <span className="num block text-[0.75rem] text-ink-muted">
                          {item.variant_name} · {item.sku}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="num font-semibold text-deal">
                          {money(item.effective_price)}
                        </span>
                        <span className="num ml-2 text-[0.75rem] text-ink-muted line-through">
                          {money(item.list_price)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-32">
                          <div className="h-1.5 overflow-hidden rounded-full bg-deal-50">
                            <div
                              className="h-full rounded-full bg-deal-600"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="num mt-1 block text-[0.75rem] text-ink-muted">
                            {item.stock_sold} / {item.stock_limit} · {item.remaining} left
                          </span>
                        </div>
                      </td>
                      <td className="num px-4 py-3 text-ink-muted">
                        {item.per_user_limit ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => openEdit(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleDelete(item)}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Edit deal item" : "Add deal item"}
        description="Fill exactly one price shape: an absolute deal price, or a percent off the list price."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="item-form" type="submit" loading={busy}>
              {modal?.mode === "edit" ? "Save item" : "Add to deal"}
            </Button>
          </>
        }
      >
        <form id="item-form" onSubmit={handleSubmit} className="space-y-4">
          {itemError ? <InlineError>{itemError}</InlineError> : null}

          {modal?.mode === "create" ? (
            <div>
              <Field label="Find a variant" htmlFor="variant_q" error={errors.variant}>
                <Input
                  id="variant_q"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  invalid={Boolean(errors.variant)}
                  placeholder="Product name or SKU (2+ characters)"
                  autoFocus
                />
              </Field>
              {search.isFetching ? (
                <Skeleton className="mt-2 h-16 w-full" />
              ) : (search.data?.items ?? []).length > 0 ? (
                <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line">
                  {search.data!.items.map((row) => (
                    <li key={row.variant_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(row);
                          setQuery(row.product_name);
                          setErrors((prev) => ({ ...prev, variant: "" }));
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2",
                          picked?.variant_id === row.variant_id && "bg-brand-600/8",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {row.product_name} — {row.variant_name}
                          </span>
                          <span className="num block text-[0.75rem] text-ink-muted">
                            {money(row.price)} · {row.sku}
                          </span>
                        </span>
                        {row.in_live_deal ? (
                          <Badge tone="warning">In {row.in_live_deal}</Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim().length >= 2 ? (
                <p className="mt-2 text-sm text-ink-muted">No variants match “{query.trim()}”.</p>
              ) : null}
              {picked ? (
                <div className="mt-3 rounded-md bg-surface-2 px-3 py-2.5 text-sm">
                  <span className="font-medium">{picked.product_name}</span>{" "}
                  <span className="text-ink-muted">— {picked.variant_name}</span>
                  <span className="num ml-2 text-ink-muted">{money(picked.price)}</span>
                </div>
              ) : null}
            </div>
          ) : modal && modal.mode === "edit" ? (
            <div className="rounded-md bg-surface-2 px-3 py-2.5 text-sm">
              <span className="font-medium">{modal.item.product_name}</span>{" "}
              <span className="text-ink-muted">— {modal.item.variant_name}</span>
              <span className="num ml-2 text-ink-muted">{money(modal.item.list_price)}</span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deal price (₹)"
              htmlFor="item_price"
              hint="Absolute price"
              error={errors.price}
            >
              <Input
                id="item_price"
                inputMode="decimal"
                value={form.deal_price}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deal_price: e.target.value, deal_percent: "" }))
                }
                invalid={Boolean(errors.price)}
                placeholder="99"
                disabled={modal?.mode === "edit" && modal.item.deal_percent != null}
              />
            </Field>
            <Field label="Percent off (%)" htmlFor="item_percent" hint="1–99">
              <Input
                id="item_percent"
                inputMode="numeric"
                value={form.deal_percent}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deal_percent: e.target.value, deal_price: "" }))
                }
                placeholder="20"
                disabled={modal?.mode === "edit" && modal.item.deal_price != null}
              />
            </Field>
            <Field
              label="Deal stock limit"
              htmlFor="item_limit"
              error={errors.stock_limit}
              hint="Units available in this deal"
            >
              <Input
                id="item_limit"
                inputMode="numeric"
                value={form.stock_limit}
                onChange={(e) => setForm((prev) => ({ ...prev, stock_limit: e.target.value }))}
                invalid={Boolean(errors.stock_limit)}
                placeholder="50"
              />
            </Field>
            <Field
              label="Per-customer limit"
              htmlFor="item_per_user"
              error={errors.per_user_limit}
              hint="Blank = no limit"
            >
              <Input
                id="item_per_user"
                inputMode="numeric"
                value={form.per_user_limit}
                onChange={(e) => setForm((prev) => ({ ...prev, per_user_limit: e.target.value }))}
                invalid={Boolean(errors.per_user_limit)}
                placeholder="2"
              />
            </Field>
          </div>

          {/* Live preview — what a unit costs and how many are left. */}
          <div className="rounded-md bg-surface-2 px-3.5 py-3 text-sm">
            <p className="label text-ink-muted">Preview</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span>
                Charge{" "}
                <span className="num font-semibold text-deal">
                  {previewPrice != null ? money(previewPrice) : "—"}
                </span>
                {editingListPrice != null ? (
                  <span className="num ml-2 text-ink-muted line-through">
                    {money(editingListPrice)}
                  </span>
                ) : null}
              </span>
              <span className="num text-ink-muted">
                {modal?.mode === "edit"
                  ? `${modal.item.stock_sold} sold · ${Math.max(
                      Number(form.stock_limit) - modal.item.stock_sold,
                      0,
                    )} remaining`
                  : `0 sold · ${Number(form.stock_limit) || 0} remaining`}
              </span>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}
