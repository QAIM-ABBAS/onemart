import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { useUpdateOrderStatus } from "@/hooks/queries/admin";
import {
  useAdminZones,
  useBlockDate,
  useBlockedDates,
  useDeleteTemplate,
  useDeleteZone,
  useDeliveryBoard,
  useGenerateSlots,
  useSaveTemplate,
  useSaveZone,
  useUnblockDate,
  useZoneTemplates,
} from "@/hooks/queries/delivery-admin";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type {
  DeliveryBoardEntry,
  OrderStatus,
  ZoneAdminOut,
  ZoneWrite,
} from "@/lib/types";
import { toast } from "@/stores/toast";

import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const PAGE_SIZE = 20;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
];

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
];

interface ZoneForm {
  name: string;
  postal_codes: string;
  cities: string;
  base_fee: string;
  express_fee: string;
  free_delivery_threshold: string;
  is_active: boolean;
}

const EMPTY_FORM: ZoneForm = {
  name: "",
  postal_codes: "",
  cities: "",
  base_fee: "",
  express_fee: "",
  free_delivery_threshold: "",
  is_active: true,
};

function formFrom(zone: ZoneAdminOut): ZoneForm {
  return {
    name: zone.name,
    postal_codes: zone.postal_codes.join(", "),
    cities: zone.cities.join(", "),
    base_fee: String(zone.base_fee),
    express_fee: String(zone.express_fee),
    free_delivery_threshold:
      zone.free_delivery_threshold != null ? String(zone.free_delivery_threshold) : "",
    is_active: zone.is_active,
  };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function AdminDeliveryPage() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<"board" | "zones">(sp.get("tab") === "zones" ? "zones" : "board");

  function switchTab(next: "board" | "zones") {
    setTab(next);
    const params = new URLSearchParams(sp);
    if (next === "board") params.delete("tab");
    else params.set("tab", next);
    setSp(params, { replace: true });
  }

  return (
    <div>
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-brand-600">Operations</p>
        <h1 className="mt-1.5 text-2xl sm:text-3xl">Delivery</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Zones, weekly slot templates, and today&apos;s delivery board.
        </p>
      </div>

      <div className="mt-4 flex gap-1 rounded-md bg-surface-2 p-1 shadow-pressed sm:w-fit">
        {(
          [
            { key: "board", label: "Today's board" },
            { key: "zones", label: "Zones & slots" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => switchTab(item.key)}
            className={cn(
              "label flex-1 rounded-lg px-3 py-2 transition sm:flex-none",
              tab === item.key
                ? "bg-surface font-semibold text-brand-700 border border-line"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "board" ? <BoardTab onManageZones={() => switchTab("zones")} /> : <ZonesTab />}
    </div>
  );
}

// --------------------------------------------------------------------------
// Today's delivery board
// --------------------------------------------------------------------------
function BoardTab({ onManageZones }: { onManageZones: () => void }) {
  const zones = useAdminZones({ page: 1, page_size: 100, sort: "name" });
  const [zoneId, setZoneId] = useState<number | null>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const zoneList = zones.data?.items ?? [];
  const activeZoneId = zoneId ?? zoneList.find((z) => z.is_active)?.id ?? null;

  const board = useDeliveryBoard(activeZoneId, today);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Select
          value={activeZoneId ?? ""}
          onChange={(e) => setZoneId(Number(e.target.value) || null)}
          aria-label="Choose delivery zone"
          className="h-9 min-w-48 text-sm"
        >
          <option value="" disabled>
            {zones.isLoading ? "Loading zones…" : "Select a zone"}
          </option>
          {zoneList.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
              {zone.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
        <span className="num text-sm text-ink-muted" aria-live="polite">
          {board.data
            ? `${
                board.data.groups.reduce((n, g) => n + g.orders.length, 0) +
                board.data.unscheduled.length
              } deliveries`
            : ""}
        </span>
      </div>

      <div className="mt-4">
        {zones.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : zoneList.length === 0 ? (
          <EmptyState
            title="No delivery zones yet"
            body="Create a zone in the Zones & slots tab before using the board."
            action={<Button onClick={onManageZones}>Manage zones</Button>}
          />
        ) : activeZoneId === null ? (
          <EmptyState title="Pick a zone" body="Choose a zone above to see its delivery board." />
        ) : board.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : board.isError ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : board.data &&
          board.data.groups.length === 0 &&
          board.data.unscheduled.length === 0 ? (
          <EmptyState
            title="Nothing to deliver today"
            body="No orders are scheduled for this zone today."
          />
        ) : (
          <div className="space-y-5">
            {board.data!.groups.map((group) => (
              <section key={group.slot_id} className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
                  <h2 className="label text-ink-muted">
                    {group.start && group.end
                      ? `${String(group.start).slice(0, 5)} – ${String(group.end).slice(0, 5)}`
                      : "Scheduled"}
                  </h2>
                  <span className="num text-xs text-ink-muted">{group.orders.length} orders</span>
                </div>
                <ul className="divide-y divide-line">
                  {group.orders.map((entry) => (
                    <BoardRow key={entry.order_id} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}

            {board.data!.unscheduled.length > 0 ? (
              <section className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
                  <h2 className="label text-ink-muted">Unscheduled (standard / express)</h2>
                  <span className="num text-xs text-ink-muted">
                    {board.data!.unscheduled.length} orders
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {board.data!.unscheduled.map((entry) => (
                    <BoardRow key={entry.order_id} entry={entry} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardRow({ entry }: { entry: DeliveryBoardEntry }) {
  const updateStatus = useUpdateOrderStatus(entry.order_id);
  const nextStatus = useMemo(() => {
    const idx = ACTIVE_STATUSES.indexOf(entry.status as OrderStatus);
    if (idx === -1 || idx >= ACTIVE_STATUSES.length - 1) return null;
    return ACTIVE_STATUSES[idx + 1];
  }, [entry.status]);

  function advance() {
    if (!nextStatus) return;
    updateStatus.mutate(
      { status: nextStatus, note: "Delivery board update" },
      {
        onSuccess: () =>
          toast(`${entry.order_number} → ${nextStatus.replace("_", " ")}.`, {
            tone: "positive",
          }),
        onError: (err) =>
          toast(err instanceof Error ? err.message : "Could not update the order.", {
            tone: "negative",
          }),
      },
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <span className="num font-medium">{entry.order_number}</span>
        <span className="block truncate text-ink-muted">
          {entry.recipient_name} · {entry.address}
        </span>
        <span className="num block text-[0.75rem] text-ink-muted">{entry.phone}</span>
      </div>
      <StatusBadge status={entry.status} />
      <span className="num w-20 text-end font-medium">{money(entry.total)}</span>
      {nextStatus ? (
        <Button
          variant="secondary"
          size="sm"
          loading={updateStatus.isPending}
          onClick={advance}
        >
          Mark {nextStatus.replace("_", " ")}
        </Button>
      ) : null}
      <a
        href={`/admin/orders/${entry.order_id}`}
        className="text-sm text-brand-600 underline underline-offset-2"
      >
        View
      </a>
    </li>
  );
}

// --------------------------------------------------------------------------
// Zones & slots
// --------------------------------------------------------------------------
type ModalState = { mode: "create" } | { mode: "edit"; zone: ZoneAdminOut };

function ZonesTab() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [form, setForm] = useState<ZoneForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedZone, setSelectedZone] = useState<number | null>(null);

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    q: sp.get("q") ?? undefined,
    is_active: sp.get("active") === "1" ? true : undefined,
  };

  const zones = useAdminZones(params);
  const save = useSaveZone();
  const remove = useDeleteZone();

  const zoneList = zones.data?.items ?? [];
  const detailZone = zoneList.find((z) => z.id === selectedZone) ?? null;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function open(next: ModalState, values: ZoneForm) {
    save.reset();
    setErrors({});
    setForm(values);
    setModal(next);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Enter a zone name";
    const base = parseNumber(form.base_fee);
    const express = parseNumber(form.express_fee);
    if (base === null || base < 0) next.base_fee = "Enter the standard fee";
    if (express === null || express < 0) next.express_fee = "Enter the express fee";
    else if (base !== null && express < base)
      next.express_fee = "Express cannot cost less than standard";
    const freeOver = parseNumber(form.free_delivery_threshold);
    if (form.free_delivery_threshold.trim() && freeOver === null)
      next.free_delivery_threshold = "Enter a number or leave blank";
    if (splitList(form.postal_codes).length === 0 && splitList(form.cities).length === 0)
      next.postal_codes = "Cover at least one PIN prefix or city";
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: ZoneWrite = {
      name: form.name.trim(),
      postal_codes: splitList(form.postal_codes),
      cities: splitList(form.cities),
      base_fee: parseNumber(form.base_fee) ?? 0,
      express_fee: parseNumber(form.express_fee) ?? 0,
      free_delivery_threshold: parseNumber(form.free_delivery_threshold),
      is_active: form.is_active,
    };

    const editing = modal?.mode === "edit" ? modal.zone.id : undefined;
    try {
      await save.mutateAsync({ id: editing, payload });
      setModal(null);
      toast(editing ? "Zone updated." : "Zone created.", { tone: "positive" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  function handleDelete(zone: ZoneAdminOut) {
    if (
      !window.confirm(
        `Delete ${zone.name}? Slots and templates go with it; past orders keep their records.`,
      )
    )
      return;
    remove.mutate(zone.id, {
      onSuccess: () => {
        if (selectedZone === zone.id) setSelectedZone(null);
        toast("Zone deleted.", { tone: "positive" });
      },
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the zone.", {
          tone: "negative",
        }),
    });
  }

  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;
  const busy = save.isPending || remove.isPending;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="num text-sm text-ink-muted" aria-live="polite">
          {zones.data ? `${zones.data.total} zones` : "Loading…"}
        </p>
        <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New zone</Button>
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
            placeholder="Search zone name…"
            aria-label="Search zones"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={sp.get("active") === "1" ? "active" : ""}
          onChange={(e) => update({ active: e.target.value === "active" ? "1" : undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-32 text-sm"
        >
          <option value="">All zones</option>
          <option value="active">Active only</option>
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort zones"
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
        {zones.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="ms-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : zones.isError ? (
          <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />
        ) : zoneList.length === 0 ? (
          <EmptyState
            title="No delivery zones"
            body="Add your first zone to start matching addresses and charging zone-based fees."
            action={<Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New zone</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-start">
                  <th className="label px-4 py-2.5 text-ink-muted">Zone</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Coverage</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Standard</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Express</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Free over</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                  <th className="label px-4 py-2.5 text-end text-ink-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {zoneList.map((zone) => (
                  <tr key={zone.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedZone(zone.id)}
                        className="font-medium text-brand-600 underline underline-offset-2"
                      >
                        {zone.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      <span className="num">
                        {zone.postal_codes.length > 0
                          ? zone.postal_codes.map((p) => `${p}*`).join(", ")
                          : ""}
                      </span>
                      {zone.postal_codes.length > 0 && zone.cities.length > 0 ? " · " : ""}
                      {zone.cities.join(", ")}
                    </td>
                    <td className="num px-4 py-3">{money(zone.base_fee)}</td>
                    <td className="num px-4 py-3">{money(zone.express_fee)}</td>
                    <td className="num px-4 py-3">
                      {zone.free_delivery_threshold != null
                        ? money(zone.free_delivery_threshold)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "label rounded-full px-2 py-1",
                          zone.is_active
                            ? "bg-brand-700/10 text-brand-700"
                            : "bg-surface-2 text-ink-muted",
                        )}
                      >
                        {zone.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => setSelectedZone(zone.id)}
                        >
                          Slots
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => open({ mode: "edit", zone }, formFrom(zone))}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleDelete(zone)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={zones.data?.page ?? 1}
              pages={zones.data?.pages ?? 1}
              total={zones.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              onChange={(page) => update({ page: String(page) })}
            />
          </div>
        )}
      </div>

      {detailZone ? (
        <ZoneDetail zone={detailZone} onClose={() => setSelectedZone(null)} />
      ) : null}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? `Edit ${modal.zone.name}` : "New delivery zone"}
        description="PIN prefixes are matched longest-first (560* beats 56*); cities match exactly, ignoring case."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="zone-form" type="submit" loading={busy}>
              {modal?.mode === "edit" ? "Save zone" : "Create zone"}
            </Button>
          </>
        }
      >
        <form id="zone-form" onSubmit={handleSubmit} className="space-y-4">
          {saveError ? <InlineError>{saveError}</InlineError> : null}
          <Field label="Zone name" htmlFor="zone_name" error={errors.name}>
            <Input
              id="zone_name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              invalid={Boolean(errors.name)}
              placeholder="Bengaluru Metro"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="PIN prefixes"
              htmlFor="zone_postal"
              error={errors.postal_codes}
              hint="Comma separated, e.g. 560, 561"
            >
              <Input
                id="zone_postal"
                value={form.postal_codes}
                onChange={(e) => setForm((prev) => ({ ...prev, postal_codes: e.target.value }))}
                invalid={Boolean(errors.postal_codes)}
                placeholder="560, 561"
              />
            </Field>
            <Field label="Cities" htmlFor="zone_cities" hint="Comma separated, exact names">
              <Input
                id="zone_cities"
                value={form.cities}
                onChange={(e) => setForm((prev) => ({ ...prev, cities: e.target.value }))}
                placeholder="Bengaluru"
              />
            </Field>
            <Field label="Standard fee (₹)" htmlFor="zone_base" error={errors.base_fee}>
              <Input
                id="zone_base"
                inputMode="decimal"
                value={form.base_fee}
                onChange={(e) => setForm((prev) => ({ ...prev, base_fee: e.target.value }))}
                invalid={Boolean(errors.base_fee)}
                placeholder="40"
              />
            </Field>
            <Field label="Express fee (₹)" htmlFor="zone_express" error={errors.express_fee}>
              <Input
                id="zone_express"
                inputMode="decimal"
                value={form.express_fee}
                onChange={(e) => setForm((prev) => ({ ...prev, express_fee: e.target.value }))}
                invalid={Boolean(errors.express_fee)}
                placeholder="90"
              />
            </Field>
            <Field
              label="Free delivery over (₹)"
              htmlFor="zone_free"
              error={errors.free_delivery_threshold}
              hint="Blank = never free automatically"
            >
              <Input
                id="zone_free"
                inputMode="decimal"
                value={form.free_delivery_threshold}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, free_delivery_threshold: e.target.value }))
                }
                placeholder="999"
              />
            </Field>
          </div>
          <Checkbox
            label="Active (customers can be matched to this zone)"
            checked={form.is_active}
            onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>
    </div>
  );
}

// --------------------------------------------------------------------------
// Zone detail: weekly templates, slot generation, blocked dates, slot table
// --------------------------------------------------------------------------
function ZoneDetail({ zone, onClose }: { zone: ZoneAdminOut; onClose: () => void }) {
  const [genDate, setGenDate] = useState(new Date().toISOString().slice(0, 10));
  const [genDays, setGenDays] = useState("14");
  const [tplForm, setTplForm] = useState({
    weekday: "1",
    start_time: "09:00",
    end_time: "12:00",
    capacity: "10",
  });
  const [tplError, setTplError] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const tplQuery = useZoneTemplates(zone.id);
  const blocked = useBlockedDates(zone.id);
  const generate = useGenerateSlots();
  const saveTemplate = useSaveTemplate();
  const deleteTemplate = useDeleteTemplate();
  const block = useBlockDate();
  const unblock = useUnblockDate();

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    const days = Number(genDays);
    if (!genDate || Number.isNaN(days) || days < 1 || days > 60) {
      toast("Pick a start date and 1–60 days.", { tone: "negative" });
      return;
    }
    try {
      const result = await generate.mutateAsync({ zoneId: zone.id, date_from: genDate, days });
      toast(
        result.created > 0
          ? `Generated ${result.created} slots.`
          : "Nothing new — that window already exists.",
        { tone: "positive" },
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not generate slots.", {
        tone: "negative",
      });
    }
  }

  async function handleAddTemplate(e: FormEvent) {
    e.preventDefault();
    setTplError(null);
    if (tplForm.end_time <= tplForm.start_time) {
      setTplError("End time must be after the start time");
      return;
    }
    try {
      await saveTemplate.mutateAsync({
        zoneId: zone.id,
        payload: {
          weekday: Number(tplForm.weekday),
          start_time: tplForm.start_time,
          end_time: tplForm.end_time,
          capacity: Number(tplForm.capacity) || 1,
        },
      });
      toast("Weekly window added.", { tone: "positive" });
      setTplForm((prev) => ({ ...prev, start_time: "09:00", end_time: "12:00" }));
    } catch (err) {
      setTplError(err instanceof Error ? err.message : "Could not add the window.");
    }
  }

  async function handleBlock(e: FormEvent) {
    e.preventDefault();
    if (!blockDate) return;
    try {
      await block.mutateAsync({ zoneId: zone.id, date: blockDate, reason: blockReason || undefined });
      toast("Date blocked.", { tone: "positive" });
      setBlockDate("");
      setBlockReason("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not block the date.", {
        tone: "negative",
      });
    }
  }

  return (
    <section className="mt-6 rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg">{zone.name} — schedule</h2>
          <p className="text-sm text-ink-muted">
            Weekly windows become concrete slots; block a date to pause deliveries.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
        {/* Weekly templates */}
        <div>
          <h3 className="label text-ink-muted">Weekly template</h3>
          {tplQuery.isLoading ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : tplQuery.isError ? (
            <ErrorState error={tplQuery.error} onRetry={() => void tplQuery.refetch()} />
          ) : (tplQuery.data ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No weekly windows yet — add one below before generating slots.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line">
              {(tplQuery.data ?? []).map((tpl) => (
                <li key={tpl.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 font-medium">{WEEKDAYS[tpl.weekday]}</span>
                  <span className="num text-ink-muted">
                    {String(tpl.start_time).slice(0, 5)}–{String(tpl.end_time).slice(0, 5)}
                  </span>
                  <span className="num text-ink-muted">cap {tpl.capacity}</span>
                  <button
                    type="button"
                    aria-label="Remove window"
                    disabled={deleteTemplate.isPending}
                    className="text-ink-muted transition-colors hover:text-danger disabled:opacity-40"
                    onClick={() => {
                      if (!window.confirm("Remove this weekly window?")) return;
                      deleteTemplate.mutate(
                        { zoneId: zone.id, id: tpl.id },
                        {
                          onSuccess: () => toast("Window removed.", { tone: "positive" }),
                          onError: (err) =>
                            toast(err instanceof Error ? err.message : "Could not remove it.", {
                              tone: "negative",
                            }),
                        },
                      );
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddTemplate} className="mt-3 grid gap-3 sm:grid-cols-2">
            {tplError ? (
              <div className="sm:col-span-2">
                <InlineError>{tplError}</InlineError>
              </div>
            ) : null}
            <Field label="Weekday" htmlFor="tpl_weekday">
              <Select
                id="tpl_weekday"
                value={tplForm.weekday}
                onChange={(e) => setTplForm((prev) => ({ ...prev, weekday: e.target.value }))}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Capacity" htmlFor="tpl_capacity">
              <Input
                id="tpl_capacity"
                inputMode="numeric"
                value={tplForm.capacity}
                onChange={(e) => setTplForm((prev) => ({ ...prev, capacity: e.target.value }))}
              />
            </Field>
            <Field label="Start" htmlFor="tpl_start">
              <Input
                id="tpl_start"
                type="time"
                value={tplForm.start_time}
                onChange={(e) => setTplForm((prev) => ({ ...prev, start_time: e.target.value }))}
              />
            </Field>
            <Field label="End" htmlFor="tpl_end">
              <Input
                id="tpl_end"
                type="time"
                value={tplForm.end_time}
                onChange={(e) => setTplForm((prev) => ({ ...prev, end_time: e.target.value }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" loading={saveTemplate.isPending}>
                Add window
              </Button>
            </div>
          </form>
        </div>

        {/* Generation + blocked dates */}
        <div className="space-y-6">
          <div>
            <h3 className="label text-ink-muted">Generate slots</h3>
            <form onSubmit={handleGenerate} className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="From" htmlFor="gen_date">
                <Input
                  id="gen_date"
                  type="date"
                  value={genDate}
                  onChange={(e) => setGenDate(e.target.value)}
                />
              </Field>
              <Field label="Days (1–60)" htmlFor="gen_days">
                <Input
                  id="gen_days"
                  inputMode="numeric"
                  value={genDays}
                  onChange={(e) => setGenDays(e.target.value)}
                  className="w-24"
                />
              </Field>
              <Button type="submit" size="sm" loading={generate.isPending}>
                Generate
              </Button>
            </form>
          </div>

          <div>
            <h3 className="label text-ink-muted">Blocked dates</h3>
            <form onSubmit={handleBlock} className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Date" htmlFor="block_date">
                <Input
                  id="block_date"
                  type="date"
                  value={blockDate}
                  onChange={(e) => setBlockDate(e.target.value)}
                />
              </Field>
              <Field label="Reason (optional)" htmlFor="block_reason" className="flex-1">
                <Input
                  id="block_reason"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Public holiday"
                />
              </Field>
              <Button type="submit" size="sm" loading={block.isPending} disabled={!blockDate}>
                Block
              </Button>
            </form>

            {blocked.isLoading ? (
              <Skeleton className="mt-3 h-16 w-full" />
            ) : (blocked.data ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No blocked dates.</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {(blocked.data ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm"
                  >
                    <span className="num">{row.blocked_date}</span>
                    {row.reason ? (
                      <span className="text-ink-muted">— {row.reason}</span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Unblock ${row.blocked_date}`}
                      className="text-ink-muted transition-colors hover:text-brand-600"
                      onClick={() =>
                        unblock.mutate(
                          { zoneId: zone.id, date: row.blocked_date },
                          {
                            onSuccess: () => toast("Date unblocked.", { tone: "positive" }),
                            onError: (err) =>
                              toast(
                                err instanceof Error ? err.message : "Could not unblock it.",
                                { tone: "negative" },
                              ),
                          },
                        )
                      }
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
