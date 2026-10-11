import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { useCancelOrder, useOrder, useOrders } from "@/hooks/queries/orders";
import { useInitiatePayment } from "@/hooks/queries/payments";
import {
  ORDER_FLOW,
  ORDER_STATUS_LABELS,
  formatDate,
  formatDateTime,
  money,
} from "@/lib/format";

import { Badge, PaymentBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/States";
import { BanknoteIcon } from "@/components/ui/Icon";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  ...ORDER_FLOW.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
  { value: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "total_desc", label: "Total: high to low" },
  { value: "total_asc", label: "Total: low to high" },
];

const PAGE_SIZE = 10;

/** Server payment codes → the words a customer reads. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  zarinpal: "Online payment",
};

function paymentMethodLabel(code: string): string {
  return PAYMENT_METHOD_LABELS[code] ?? code.replace(/_/g, " ");
}

export function OrdersPage() {
  const [sp, setSp] = useSearchParams();
  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
  };
  const orders = useOrders(params);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-brand-600">Your account</p>
          <h1 className="mt-1.5 text-3xl">My orders</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-1 border border-line">
          <Select
            value={params.status ?? ""}
            onChange={(e) => update({ status: e.target.value || undefined })}
            aria-label="Filter by status"
            className="h-9 min-w-40 text-sm"
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
            aria-label="Sort orders"
            className="h-9 min-w-44 text-sm"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6">
        {orders.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : orders.data && orders.data.items.length > 0 ? (
          <>
            <ul className="space-y-3">
              {orders.data.items.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="grid gap-3 rounded-md bg-surface px-4 py-4 border border-line transition hover:-translate-y-0.5 hover:shadow-lift sm:grid-cols-[1.2fr_1fr_auto_auto] sm:items-center sm:gap-5"
                  >
                    <div>
                      <p className="num font-display text-lg font-semibold">{order.order_number}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
                        {formatDate(order.created_at)} · {order.item_count} item
                        {order.item_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={order.status} />
                      <Badge tone={order.payment_status === "paid" ? "positive" : "neutral"}>
                        {paymentMethodLabel(order.payment_method)}
                      </Badge>
                    </div>
                    <p className="num text-base font-semibold sm:text-end">
                      {money(order.total)}
                    </p>
                    <span className="label text-brand-600 sm:justify-self-end">View <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span></span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              className="mt-5"
              page={orders.data.page}
              pages={orders.data.pages}
              total={orders.data.total}
              pageSize={orders.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={params.status ? "No orders with this status" : "No orders yet"}
            body={
              params.status
                ? "Try a different status filter."
                : "When you place your first order, it will show up here with its full timeline."
            }
            action={
              params.status ? (
                <Button variant="secondary" onClick={() => update({ status: undefined })}>
                  Show all orders
                </Button>
              ) : (
                <Link to="/products">
                  <Button>Start shopping</Button>
                </Link>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [sp] = useSearchParams();
  const placed = sp.has("placed");
  const order = useOrder(orderId);
  const cancelOrder = useCancelOrder(orderId ?? "");
  const initiate = useInitiatePayment();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const sortedHistory = useMemo(
    () => (order.data ? [...order.data.history].sort((a, b) => a.id - b.id) : []),
    [order.data],
  );

  if (order.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-9 w-72" />
        <Skeleton className="mt-6 h-40 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (order.isError || !order.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
        <div className="mt-6 text-center">
          <Link to="/orders" className="text-sm text-brand-600 underline-offset-4 hover:underline">
            Back to my orders
          </Link>
        </div>
      </div>
    );
  }

  const o = order.data;
  const isOnline = o.payment_method !== "cod";
  // Online + still pending = this order is holding stock against a payment
  // that has not landed; the window is the reservation's deadline.
  const awaitingPayment = o.status === "pending" && isOnline && o.payment_status !== "paid";
  const deadline = o.payment_deadline ? new Date(o.payment_deadline).getTime() : null;
  const paymentWindowOpen = deadline === null || deadline > Date.now();

  function retryPayment() {
    initiate.mutate(o.id, {
      onSuccess: (started) => {
        window.location.assign(started.redirect_url);
      },
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:py-12">
      <Link
        to="/orders"
        className="label text-ink-muted transition-colors hover:text-ink"
      >
        <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> All orders
      </Link>

      {placed ? (
        <Notice className="mt-5" tone={o.payment_status === "paid" ? "positive" : "info"}>
          {o.payment_status === "paid" ? (
            <>
              Order placed and paid — thank you! You can follow its progress on this page.
            </>
          ) : awaitingPayment ? (
            <>
              Order placed — finish the payment to confirm it. Your items are held until the
              window below closes.
            </>
          ) : (
            <>
              Order placed — keep <span className="num font-semibold">{money(o.total)}</span> ready
              for cash on delivery. You can follow its progress on this page.
            </>
          )}
        </Notice>
      ) : null}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label text-brand-600">Order</p>
          <h1 className="num mt-1.5 text-3xl">{o.order_number}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Placed on {formatDateTime(o.placed_at)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={o.status} />
          <div className="flex items-center gap-2">
            <PaymentBadge status={o.payment_status} />
            <Badge tone="neutral">{paymentMethodLabel(o.payment_method)}</Badge>
          </div>
          {/* Online orders still inside the reservation window get a retry
              until the hold lapses; after that the order is cancelled. */}
          {awaitingPayment && paymentWindowOpen ? (
            <Button
              variant="primary"
              size="sm"
              loading={initiate.isPending}
              onClick={retryPayment}
            >
              Retry payment
            </Button>
          ) : null}
          {/* Customers may stop an order only before it is packed — the
              server enforces the same window. */}
          {o.status === "pending" || o.status === "confirmed" ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmingCancel(true)}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </div>

      <section className="mt-7">
        <h2 className="text-lg">Status timeline</h2>
        <div className="mt-4 rounded-md bg-surface-2 px-4 py-5 shadow-pressed sm:px-6">
          <OrderTimeline status={o.status} history={sortedHistory} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Items</h2>
        <ul className="mt-4 divide-y divide-line rounded-md bg-surface-2 shadow-pressed">
          {o.items.map((item) => (
            <li key={item.id} className="flex items-start gap-4 px-4 py-4">
              <div className="size-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.product_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center font-display text-lg text-brand-700/25">
                    {item.product_name[0]}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/p/${item.product_slug}`}
                  className="font-medium hover:text-brand-600 hover:underline underline-offset-2"
                >
                  {item.product_name}
                </Link>
                <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
                  {item.variant_name} · SKU <span dir="ltr" className="num">{item.sku}</span>
                </p>
                <p className="num mt-1 text-[0.8125rem] text-ink-muted">
                  {money(item.unit_price)} × {item.quantity}
                </p>
              </div>
              <p className="num shrink-0 font-semibold">{money(item.line_total)}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <section className="rounded-md bg-surface px-4 py-4 border border-line">
          <h2 className="flex items-center gap-2 text-lg">
            <BanknoteIcon width={17} height={17} className="text-brand-600" />
            Payment
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Method</dt>
              <dd>{paymentMethodLabel(o.payment_method)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Status</dt>
              <dd>{o.payment_status.replace(/_/g, " ")}</dd>
            </div>
            {awaitingPayment && deadline !== null ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Payment window</dt>
                <dd className={paymentWindowOpen ? "num" : "num text-deal"}>
                  {paymentWindowOpen
                    ? `until ${formatDateTime(new Date(deadline).toISOString())}`
                    : "closed"}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between pt-3">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="num">{money(o.subtotal)}</dd>
            </div>
            {o.discount_total > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">
                  Coupon <span dir="ltr" className="font-medium text-ink">{o.coupon_code}</span>
                </dt>
                <dd className="num text-deal"><span dir="ltr">−{money(o.discount_total)}</span></dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-ink-muted">Delivery</dt>
              <dd className="num">{o.delivery_fee === 0 ? "Free" : money(o.delivery_fee)}</dd>
            </div>
            <div className="flex justify-between pt-3 text-base font-semibold">
              <dt>Total</dt>
              <dd className="num">{money(o.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md bg-surface px-4 py-4 border border-line">
          <h2 className="text-lg">Delivery address</h2>
          <div className="mt-3 text-sm">
            <p className="font-medium">{o.recipient_name}</p>
            <p dir="ltr" className="num mt-0.5 text-ink-muted">{o.phone}</p>
            <p className="mt-1.5 text-ink-muted">
              {o.line1}
              {o.line2 ? `, ${o.line2}` : ""}, {o.city}, {o.state}{" "}
              <span dir="ltr" className="num">{o.postal_code}</span>, {o.country}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="label text-ink-muted">Method</span>
            <Badge tone="info">
              {o.delivery_method === "express"
                ? "Express delivery"
                : o.delivery_method === "scheduled"
                  ? "Scheduled slot"
                  : "Standard delivery"}
            </Badge>
            {o.delivery_slot ? (
              <span className="num text-ink-muted">
                {new Date(`${o.delivery_slot.slot_date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                , {o.delivery_slot.start_time.slice(0, 5)}–{o.delivery_slot.end_time.slice(0, 5)}
              </span>
            ) : null}
          </div>
          {o.customer_note ? (
            <div className="mt-4 rounded-md bg-surface-2/50 px-3 py-2.5 ">
              <p className="label text-ink-muted">Your note</p>
              <p className="mt-1 text-sm">{o.customer_note}</p>
            </div>
          ) : null}
        </section>
      </div>

      <Modal
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title="Cancel this order?"
        description={`${o.order_number} will be stopped before it ships.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={cancelOrder.isPending}
              onClick={() =>
                cancelOrder.mutate(undefined, { onSuccess: () => setConfirmingCancel(false) })
              }
            >
              Cancel order
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          Anything reserved for this order goes straight back to the shelf, along with your
          delivery slot.{" "}
          {o.payment_status === "paid"
            ? "The payment is sent to an admin for a refund before it can finish."
            : "Nothing has been paid yet, so there is nothing to refund."}{" "}
          This cannot be undone — you can always place the order again.
        </p>
      </Modal>
    </div>
  );
}
