import { type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useInitiatePayment, usePaymentStatus } from "@/hooks/queries/payments";
import { formatPrice } from "@/lib/format";

import { Button } from "@/components/ui/Button";
import { CheckIcon, ClockIcon, CloseIcon } from "@/components/ui/Icon";
import { ErrorState, Skeleton } from "@/components/ui/States";

/**
 * Where the gateway's redirect lands (see payments.router._result_url).
 *
 * The URL's ``status`` is only a hint for first paint — the real state is
 * polled from the server, so a hand-edited query string can't claim a payment
 * that never happened, and a slow callback never shows a wrong answer.
 */
export function PaymentResultPage() {
  const { t } = useTranslation("payment");
  const [sp] = useSearchParams();
  const paymentId = sp.get("payment_id");
  const hint = sp.get("status");

  const payment = usePaymentStatus(paymentId);
  const retry = useInitiatePayment();

  const status = payment.data?.status ?? (hint === "failed" ? "failed" : "pending");

  function doRetry() {
    if (!payment.data) return;
    retry.mutate(payment.data.order_id, {
      onSuccess: (started) => {
        window.location.assign(started.redirect_url);
      },
    });
  }

  if (payment.isLoading && !payment.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Skeleton className="mx-auto h-16 w-16 rounded-full" />
        <Skeleton className="mx-auto mt-6 h-7 w-64" />
        <Skeleton className="mx-auto mt-3 h-4 w-80" />
        <div className="mt-8 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (payment.isError || !payment.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          error={payment.error}
          onRetry={() => void payment.refetch()}
        />
        <div className="mt-6 text-center">
          <Link to="/orders" className="text-sm text-brand-600 underline-offset-4 hover:underline">
            Go to my orders
          </Link>
        </div>
      </div>
    );
  }

  const data = payment.data;

  if (status === "paid") {
    return (
      <ResultShell
        tone="success"
        icon={<CheckIcon width={26} height={26} />}
        eyebrow={t("success.eyebrow")}
        title={t("success.title")}
        body={
          <>
            {t("success.body", {
              amount: formatPrice(data.amount),
              orderNumber: data.order_number,
            })}
          </>
        }
        actions={
          <>
            <Link to={`/orders/${data.order_id}`}>
              <Button size="lg">{t("success.viewOrder")}</Button>
            </Link>
            <Link to="/products">
              <Button variant="secondary" size="lg">{t("success.keepShopping")}</Button>
            </Link>
          </>
        }
      />
    );
  }

  if (status === "failed") {
    return (
      <ResultShell
        tone="danger"
        icon={<CloseIcon width={24} height={24} />}
        eyebrow={t("failed.eyebrow")}
        title={t("failed.title")}
        body={
          <>
            {t("failed.body", {
              amount: formatPrice(data.amount),
              orderNumber: data.order_number,
            })}
          </>
        }
        actions={
          <>
            <Button size="lg" loading={retry.isPending} onClick={doRetry}>
              {t("failed.retry")}
            </Button>
            <Link to={`/orders/${data.order_id}`}>
              <Button variant="secondary" size="lg">
                {t("failed.backToOrder")}
              </Button>
            </Link>
          </>
        }
      />
    );
  }

  return (
    <ResultShell
      tone="info"
      icon={<ClockIcon width={24} height={24} />}
      eyebrow={t("pending.eyebrow")}
      title={t("pending.title")}
      body={
        <>
          {t("pending.body", {
            amount: formatPrice(data.amount),
            orderNumber: data.order_number,
          })}
        </>
      }
      actions={
        <Link to={`/orders/${data.order_id}`}>
          <Button variant="secondary" size="lg">
            {t("pending.viewOrder")}
          </Button>
        </Link>
      }
    />
  );
}

function ResultShell({
  tone,
  icon,
  eyebrow,
  title,
  body,
  actions,
}: {
  tone: "success" | "danger" | "info";
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: ReactNode;
  actions: ReactNode;
}) {
  const tones = {
    success: "bg-success/10 text-success border-success/25",
    danger: "bg-danger/10 text-danger border-danger/25",
    info: "bg-info/10 text-info border-info/25",
  } as const;

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-center lg:py-20">
      <div
        className={`mx-auto grid size-16 place-items-center rounded-full border ${tones[tone]}`}
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="label mt-6 text-ink-faint">{eyebrow}</p>
      <h1 className="mt-2 text-2xl lg:text-3xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-muted">{body}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
    </div>
  );
}
