import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAdminOrder, useUpdateOrderStatus } from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  NEXT_STATUSES,
  ORDER_STATUS_LABELS,
  formatDateTime,
  money,
} from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { PaymentBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { ErrorState, InlineError, Notice, Skeleton } from "@/components/ui/States";

export function AdminOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = useAdminOrder(orderId);
  const updateStatus = useUpdateOrderStatus(Number(orderId));

  const [nextStatus, setNextStatus] = useState<OrderStatus | "">("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (order.data) {
      setNextStatus("");
      setNote("");
      setFormError(null);
      updateStatus.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.data?.status, order.data?.id]);

  if (order.isLoading) {
    return (
      <div className="max-w-5xl">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-9 w-72" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (order.isError || !order.data) {
    return (
      <div className="max-w-2xl">
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
        <div className="mt-5">
          <Link to="/admin/orders" className="text-sm text-leaf underline-offset-4 hover:underline">
            ← Back to orders
          </Link>
        </div>
      </div>
    );
  }

  const o = order.data;
  const options = NEXT_STATUSES[o.status];
  const history = [...o.history].sort((a, b) => a.id - b.id);

  async function handleStatus(e: FormEvent) {
    e.preventDefault();
    if (!nextStatus) {
      setFormError("Choose the next status");
      return;
    }
    setFormError(null);
    try {
      await updateStatus.mutateAsync({
        status: nextStatus,
        note: note.trim() ? note.trim() : undefined,
      });
      setNextStatus("");
      setNote("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not update the status.");
    }
  }

  return (
    <div className="max-w-6xl">
      <Link to="/admin/orders" className="label text-ink-soft hover:text-ink">
        ← Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-ink/15 pb-5">
        <div>
          <p className="label text-leaf">Order</p>
          <h1 className="num mt-1.5 text-2xl sm:text-3xl">{o.order_number}</h1>
          <p className="mt-1 text-sm text-ink-soft">Placed {formatDateTime(o.placed_at)}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <StatusBadge status={o.status} />
          <div className="flex items-center gap-2">
            <PaymentBadge status={o.payment_status} />
            <span className="label text-ink-soft">Cash on delivery</span>
          </div>
        </div>
      </div>

      {updateStatus.isSuccess ? (
        <Notice className="mt-5">Status updated to {ORDER_STATUS_LABELS[o.status]}.</Notice>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3.5 text-lg">Status timeline</h2>
            <div className="px-5 py-5">
              <OrderTimeline status={o.status} history={history} />
            </div>
            {history.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {history.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
                    <span className="num w-40 shrink-0 text-ink-soft">
                      {formatDateTime(event.created_at)}
                    </span>
                    <span className="font-medium">{ORDER_STATUS_LABELS[event.status]}</span>
                    {event.note ? <span className="text-ink-soft">— {event.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3.5 text-lg">Items</h2>
            <ul className="divide-y divide-line">
              {o.items.map((item) => (
                <li key={item.id} className="flex items-start gap-4 px-5 py-4">
                  <div className="size-14 shrink-0 overflow-hidden border border-line bg-mist">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center font-display text-base text-forest/30">
                        {item.product_name[0]}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.product_name}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-soft">
                      {item.variant_name} · SKU <span className="num">{item.sku}</span>
                    </p>
                    <p className="num mt-1 text-[0.8125rem] text-ink-soft">
                      {money(item.unit_price)} × {item.quantity}
                    </p>
                  </div>
                  <p className="num shrink-0 font-semibold">{money(item.line_total)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3.5 text-lg">Update status</h2>
            <form onSubmit={handleStatus} className="space-y-4 px-5 py-5" noValidate>
              {options.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  {o.status === "cancelled"
                    ? "This order is cancelled — no further transitions."
                    : "This order is complete. No further transitions."}
                </p>
              ) : (
                <>
                  {formError ? <InlineError>{formError}</InlineError> : null}
                  <Field label="Next status" htmlFor="next-status">
                    <Select
                      id="next-status"
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value as OrderStatus | "")}
                    >
                      <option value="">Choose…</option>
                      {options.map((s) => (
                        <option key={s} value={s}>
                          {ORDER_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Note (optional)" htmlFor="status-note" hint="Stored on the timeline">
                    <Textarea
                      id="status-note"
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Packed by store team, rider assigned…"
                      maxLength={300}
                    />
                  </Field>
                  <Button type="submit" block loading={updateStatus.isPending}>
                    Update status
                  </Button>
                </>
              )}
            </form>
          </section>

          <section className="border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3.5 text-lg">Customer</h2>
            <div className="space-y-4 px-5 py-5 text-sm">
              <div>
                <p className="font-medium">{o.recipient_name}</p>
                <p className="num mt-0.5 text-ink-soft">{o.phone}</p>
              </div>
              <p className="text-ink-soft">
                {o.line1}
                {o.line2 ? `, ${o.line2}` : ""}, {o.city}, {o.state}{" "}
                <span className="num">{o.postal_code}</span>, {o.country}
              </p>
              {o.customer_note ? (
                <div className="border-t border-line pt-3">
                  <p className="label text-ink-soft">Customer note</p>
                  <p className="mt-1">{o.customer_note}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3.5 text-lg">Totals</h2>
            <dl className="space-y-2.5 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd className="num">{money(o.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Delivery</dt>
                <dd className="num">{o.delivery_fee === 0 ? "Free" : money(o.delivery_fee)}</dd>
              </div>
              <div
                className={cn(
                  "flex justify-between border-t border-line pt-2.5 text-base font-semibold",
                )}
              >
                <dt>Total</dt>
                <dd className="num">{money(o.total)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
