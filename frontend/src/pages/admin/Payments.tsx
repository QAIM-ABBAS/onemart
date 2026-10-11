import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  useAdminPayment,
  useAdminPayments,
  useRefundPayment,
} from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import { formatDateTime, money, titleCase } from "@/lib/format";
import type { PaymentAdminOut } from "@/lib/types";
import { toast } from "@/stores/toast";

import { PaymentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount_desc", label: "Amount: high to low" },
  { value: "amount_asc", label: "Amount: low to high" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "initiated", label: "Initiated" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partially refunded" },
];

const PROVIDER_OPTIONS = [
  { value: "", label: "All providers" },
  { value: "zarinpal", label: "Online payment" },
  { value: "cod", label: "Cash on delivery" },
];

const PAGE_SIZE = 20;

interface RefundForm {
  amount: string;
  reason: string;
  manual: boolean;
}

const EMPTY_REFUND: RefundForm = { amount: "", reason: "", manual: false };

export function AdminPaymentsPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [selected, setSelected] = useState<number | null>(null);

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
    provider: sp.get("provider") ?? undefined,
    q: sp.get("q") ?? undefined,
    start: sp.get("start") ?? undefined,
    end: sp.get("end") ?? undefined,
  };

  const payments = useAdminPayments(params);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  const hasFilters = Boolean(
    params.q || params.status || params.provider || params.start || params.end,
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-brand-600">Finance</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Payments</h1>
          <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
            {payments.data ? `${payments.data.total} attempts` : "Loading…"}
          </p>
        </div>
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
            placeholder="Order number or reference…"
            aria-label="Search payments"
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
          aria-label="Filter by payment status"
          className="h-9 min-w-40 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.provider ?? ""}
          onChange={(e) => update({ provider: e.target.value || undefined })}
          aria-label="Filter by provider"
          className="h-9 min-w-36 text-sm"
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label="From date"
          value={params.start ?? ""}
          onChange={(e) => update({ start: e.target.value || undefined })}
          className="h-9 text-sm"
        />
        <Input
          type="date"
          aria-label="To date"
          value={params.end ?? ""}
          onChange={(e) => update({ end: e.target.value || undefined })}
          className="h-9 text-sm"
        />
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort payments"
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
        {payments.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ms-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
        ) : payments.data && payments.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-start">
                    <th className="label px-4 py-2.5 text-ink-muted">Attempt</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Order</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Provider</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Amount</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Created</th>
                    <th className="label px-4 py-2.5 text-end text-ink-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payments.data.items.map((payment) => (
                    <tr key={payment.id} className="transition-colors hover:bg-surface-2">
                      <td className="num px-4 py-3">#{payment.id}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/orders/${payment.order_id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {payment.order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {payment.provider === "cod" ? "Cash on delivery" : "Online payment"}
                      </td>
                      <td className="num px-4 py-3 font-medium">
                        {money(payment.amount)}{" "}
                        <span className="text-ink-muted">{payment.currency}</span>
                      </td>
                      <td className="px-4 py-3">
                        <PaymentBadge status={payment.status} />
                      </td>
                      <td className="num px-4 py-3 text-ink-muted">
                        {formatDateTime(payment.created_at)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelected(payment.id)}
                        >
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              className="mt-5"
              page={payments.data.page}
              pages={payments.data.pages}
              total={payments.data.total}
              pageSize={payments.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No payments match" : "No payments yet"}
            body={
              hasFilters
                ? "Try a different filter or search term."
                : "Every checkout attempt lands here — initiated, paid, failed, refunded."
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
              ) : undefined
            }
          />
        )}
      </div>

      <PaymentDetailModal paymentId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PaymentDetailModal({
  paymentId,
  onClose,
}: {
  paymentId: number | null;
  onClose: () => void;
}) {
  const detail = useAdminPayment(paymentId ?? undefined);
  const refund = useRefundPayment();
  const [form, setForm] = useState<RefundForm>(EMPTY_REFUND);
  const [error, setError] = useState<string | null>(null);

  const payment: PaymentAdminOut | undefined = detail.data;

  function close() {
    setForm(EMPTY_REFUND);
    setError(null);
    refund.reset();
    onClose();
  }

  function handleRefund(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = form.amount.trim();
    const amount = raw === "" ? null : Number(raw);
    if (amount !== null && (Number.isNaN(amount) || amount <= 0)) {
      setError("Enter an amount greater than 0, or leave it empty for a full refund.");
      return;
    }
    refund.mutate(
      {
        id: paymentId ?? 0,
        payload: {
          amount,
          reason: form.reason.trim() || null,
          manual: form.manual,
        },
      },
      {
        onSuccess: () => {
          toast("Refund recorded.", { tone: "positive" });
          setForm(EMPTY_REFUND);
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : "Could not refund this attempt.");
        },
      },
    );
  }

  const refundable =
    payment &&
    (payment.status === "paid" || payment.status === "partially_refunded") &&
    payment.refunded_amount < payment.amount;

  return (
    <Modal
      open={paymentId !== null}
      onClose={close}
      title={payment ? `Payment #${payment.id}` : "Payment"}
      description={
        payment ? `${payment.order_number} · ${payment.provider}` : undefined
      }
      footer={
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : detail.isError || !payment ? (
        <InlineError>
          {detail.error instanceof Error ? detail.error.message : "Could not load this payment."}
        </InlineError>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">Amount</dt>
            <dd className="num font-medium">
              {money(payment.amount)} {payment.currency}
            </dd>
            <dt className="text-ink-muted">Refunded</dt>
            <dd className="num">
              {money(payment.refunded_amount)}
              {payment.refunded_amount > 0 ? (
                <span className="text-ink-muted"> / {money(payment.amount)}</span>
              ) : null}
            </dd>
            <dt className="text-ink-muted">Status</dt>
            <dd>
              <PaymentBadge status={payment.status} />
            </dd>
            <dt className="text-ink-muted">Order status</dt>
            <dd>{titleCase(detail.data?.order_status ?? "")}</dd>
            <dt className="text-ink-muted">Created</dt>
            <dd className="num">{formatDateTime(payment.created_at)}</dd>
            <dt className="text-ink-muted">Reference</dt>
            <dd className="num truncate">{payment.provider_ref ?? "—"}</dd>
          </dl>

          <section>
            <h3 className="label text-ink-muted">Attempts on this order</h3>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {(detail.data?.attempts ?? []).map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="num">#{attempt.id}</span>
                  <span className="text-ink-muted">{attempt.provider}</span>
                  <span className="num">{money(attempt.amount)}</span>
                  <PaymentBadge status={attempt.status} />
                  <span className="num text-xs text-ink-muted">
                    {formatDateTime(attempt.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="label text-ink-muted">Gateway response</h3>
            <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed">
              {JSON.stringify(detail.data?.raw_response ?? {}, null, 2)}
            </pre>
          </section>

          {refundable ? (
            <form onSubmit={handleRefund} className="space-y-3" noValidate>
              <h3 className="label text-ink-muted">Refund this attempt</h3>
              {error ? <InlineError>{error}</InlineError> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Amount"
                  htmlFor="refund-amount"
                  hint="Empty = full refund"
                >
                  <Input
                    id="refund-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={String(payment.amount)}
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </Field>
                <Field label="Reason" htmlFor="refund-reason">
                  <Input
                    id="refund-reason"
                    placeholder="Damaged on arrival"
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  />
                </Field>
              </div>
              <Checkbox
                label="Manual refund — money already moved outside the gateway"
                checked={form.manual}
                onChange={(e) => setForm({ ...form, manual: e.target.checked })}
              />
              <div className="flex justify-end">
                <Button type="submit" variant="danger" size="sm" loading={refund.isPending}>
                  {form.manual ? "Record manual refund" : "Refund"}
                </Button>
              </div>
            </form>
          ) : payment.status === "failed" || payment.status === "initiated" ? (
            <p className="text-sm text-ink-muted">
              Nothing was captured on this attempt, so there is nothing to refund.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
