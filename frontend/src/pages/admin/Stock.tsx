import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAdjustStock, useInventory } from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, money } from "@/lib/format";
import type { InventoryRow } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "product", label: "Product name" },
  { value: "sku", label: "SKU" },
  { value: "quantity", label: "Quantity: low first" },
  { value: "updated", label: "Recently updated" },
];

const PAGE_SIZE = 20;

type AdjustMode = "add" | "remove" | "set";

export function AdminStockPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [target, setTarget] = useState<InventoryRow | null>(null);
  const [mode, setMode] = useState<AdjustMode>("add");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const adjust = useAdjustStock();

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "product",
    q: sp.get("q") ?? undefined,
    low_stock: sp.get("filter") === "low" ? true : undefined,
    out_of_stock: sp.get("filter") === "out" ? true : undefined,
  };

  const inventory = useInventory(params);
  const filter = sp.get("filter") ?? "";

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function openAdjust(row: InventoryRow) {
    setTarget(row);
    setMode("add");
    setAmount("1");
    setReason("");
    setAdjustError(null);
    adjust.reset();
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || (mode !== "set" && value <= 0) || (mode === "set" && value < 0)) {
      setAdjustError(mode === "set" ? "Enter a quantity of 0 or more" : "Enter a number greater than 0");
      return;
    }
    setAdjustError(null);
    try {
      const updated = await adjust.mutateAsync({
        variant_id: target.variant_id,
        ...(mode === "add" ? { delta: value } : {}),
        ...(mode === "remove" ? { delta: -value } : {}),
        ...(mode === "set" ? { set_to: value } : {}),
        reason: reason.trim() || undefined,
      });
      setSuccess(`${target.product_name} (${target.sku}) is now at ${updated.quantity} units.`);
      setTarget(null);
      window.setTimeout(() => setSuccess(null), 6000);
    } catch (err) {
      setAdjustError(err instanceof ApiError ? err.message : "Could not adjust stock.");
    }
  }

  const rows = inventory.data?.items ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-leaf">Inventory</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Stock</h1>
          <p className="mt-1 text-sm text-ink-soft num" aria-live="polite">
            {inventory.data ? `${inventory.data.total} variants` : "Loading…"}
          </p>
        </div>
        <Link to="/admin/products">
          <Button variant="secondary" size="sm">
            Manage products
          </Button>
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
            placeholder="Search product or SKU…"
            aria-label="Search stock"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>

        <div className="flex overflow-hidden border border-line-strong" role="group" aria-label="Stock filters">
          {[
            { value: "", label: "All" },
            { value: "low", label: "Low stock" },
            { value: "out", label: "Out of stock" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ filter: opt.value || undefined })}
              className={cn(
                "label h-9 border-r border-line-strong px-3 transition-colors last:border-r-0",
                filter === opt.value
                  ? "bg-forest text-paper"
                  : "bg-surface text-ink-soft hover:text-ink",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort stock"
          className="h-9 min-w-48 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {success ? <Notice className="mt-4">{success}</Notice> : null}

      <div className="mt-5">
        {inventory.isLoading ? (
          <div className="space-y-px bg-line">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 bg-surface px-4 py-3.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-8 w-24" />
              </div>
            ))}
          </div>
        ) : inventory.isError ? (
          <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />
        ) : rows.length > 0 ? (
          <>
            <div className="overflow-x-auto border border-line bg-surface">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper/70 text-left">
                    <th className="label px-4 py-2.5 text-ink-soft">Product</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Variant / SKU</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Price</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Quantity</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Reserved</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Available</th>
                    <th className="label px-4 py-2.5 text-ink-soft">Updated</th>
                    <th className="label px-4 py-2.5 text-right text-ink-soft">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => {
                    const out = row.available <= 0;
                    const low = !out && row.available <= row.low_stock_threshold;
                    return (
                      <tr key={row.variant_id} className="transition-colors hover:bg-mist/40">
                        <td className="px-4 py-3">
                          <Link
                            to={`/admin/products/${row.product_id}/edit`}
                            className="font-medium hover:text-leaf hover:underline underline-offset-2"
                          >
                            {row.product_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink-soft">{row.variant_name}</p>
                          <p className="num text-[0.75rem] text-ink-soft">{row.sku}</p>
                        </td>
                        <td className="num px-4 py-3 text-right">{money(row.price)}</td>
                        <td className="num px-4 py-3 text-right">{row.quantity}</td>
                        <td className="num px-4 py-3 text-right text-ink-soft">{row.reserved}</td>
                        <td className="num px-4 py-3 text-right font-semibold">
                          <span className={out ? "text-brick" : low ? "text-amber" : ""}>
                            {row.available}
                          </span>
                          {out ? (
                            <Badge tone="negative" className="ml-2">
                              Out
                            </Badge>
                          ) : low ? (
                            <Badge tone="warning" className="ml-2">
                              Low
                            </Badge>
                          ) : null}
                        </td>
                        <td className="num px-4 py-3 text-[0.8125rem] text-ink-soft">
                          {formatDateTime(row.updated_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="secondary" size="sm" onClick={() => openAdjust(row)}>
                            Adjust
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              className="mt-5"
              page={inventory.data!.page}
              pages={inventory.data!.pages}
              total={inventory.data!.total}
              pageSize={inventory.data!.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={filter || params.q ? "No stock matches these filters" : "No stock records yet"}
            body={
              filter || params.q
                ? "Try clearing the search or filters."
                : "Stock rows are created with each product variant."
            }
            action={
              filter || params.q ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setSp(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Adjust stock"
        description={target ? `${target.product_name} — ${target.variant_name}` : undefined}
      >
        {target ? (
          <form onSubmit={submitAdjust} className="space-y-4" noValidate>
            <div className="flex items-center justify-between border border-line bg-paper/60 px-4 py-3 text-sm">
              <span className="text-ink-soft">
                Current quantity: <span className="num font-semibold text-ink">{target.quantity}</span>
              </span>
              <span className="num text-ink-soft">SKU {target.sku}</span>
            </div>

            <fieldset>
              <legend className="label mb-2 text-ink-soft">Change type</legend>
              <div className="flex overflow-hidden border border-line-strong">
                {(
                  [
                    { value: "add", label: "Add" },
                    { value: "remove", label: "Remove" },
                    { value: "set", label: "Set to" },
                  ] as { value: AdjustMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={cn(
                      "label h-10 flex-1 border-r border-line-strong transition-colors last:border-r-0",
                      mode === opt.value ? "bg-forest text-paper" : "bg-surface hover:bg-mist",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field
              label={mode === "set" ? "New quantity" : "Units"}
              htmlFor="adjust-amount"
              error={adjustError}
            >
              <Input
                id="adjust-amount"
                type="number"
                min="0"
                inputMode="numeric"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAdjustError(null);
                }}
                invalid={Boolean(adjustError)}
                autoFocus
              />
            </Field>

            <Field label="Reason (optional)" htmlFor="adjust-reason" hint="Recorded in the audit trail">
              <Input
                id="adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Delivery received, damage, stock count…"
              />
            </Field>

            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button variant="secondary" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={adjust.isPending}>
                Apply adjustment
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
