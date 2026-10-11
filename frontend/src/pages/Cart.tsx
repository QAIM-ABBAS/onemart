import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  useApplyCoupon,
  useCart,
  useRemoveCartItem,
  useRemoveCoupon,
  useUpdateCartItem,
} from "@/hooks/queries/cart";
import { formatPrice } from "@/lib/format";
import { normalizeDigits } from "@/lib/text";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { BagIcon, TrashIcon } from "@/components/ui/Icon";
import { Price, QuantityStepper } from "@/components/ui/Price";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

export function CartPage() {
  const { t } = useTranslation("cart");
  const cart = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const applyCoupon = useApplyCoupon();
  const removeCoupon = useRemoveCoupon();
  const [couponCode, setCouponCode] = useState("");
  const navigate = useNavigate();

  if (cart.isPending) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Skeleton className="h-8 w-40" />
        <div className="mt-8 flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-4 rounded-md bg-surface p-4 border border-line">
                <Skeleton className="size-20" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-9 w-32" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full lg:w-[320px] lg:shrink-0" />
        </div>
      </div>
    );
  }

  if (cart.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={cart.error} onRetry={() => void cart.refetch()} />
      </div>
    );
  }

  const data = cart.data!;

  if (data.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            <Link to="/products">
              <Button>
                <BagIcon width={16} height={16} />
                {t("empty.cta")}
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const onApplyCoupon = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeDigits(couponCode).trim();
    if (!code) return;
    applyCoupon.mutate(code, { onSuccess: () => setCouponCode("") });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
      <div className="pb-1">
        <p className="label text-brand-600">{t("eyebrow")}</p>
        <h1 className="mt-1.5 text-3xl">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-ink-muted num">
          {t("items", { count: data.item_count })}
        </p>
      </div>

      {/* Items + summary: a flex row of two boxes. The item list grows, the
          summary keeps a fixed basis; on small screens they stack. */}
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          {updateItem.isError ? (
            <InlineError>
              {updateItem.error instanceof Error
                ? updateItem.error.message
                : t("errors.update")}
            </InlineError>
          ) : null}
          {removeItem.isError ? (
            <InlineError>
              {removeItem.error instanceof Error
                ? removeItem.error.message
                : t("errors.remove")}
            </InlineError>
          ) : null}

          <div className="divide-y divide-line overflow-hidden rounded-md bg-surface-2 shadow-pressed">
            {data.items.map((item) => {
            const missing = item.available <= 0;
            const exceeds = item.quantity > item.available && item.available > 0;
            return (
              <article
                key={item.id}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start"
              >
                <Link
                  to={`/p/${item.product_slug}`}
                  className="size-24 shrink-0 overflow-hidden rounded-md bg-surface-2"
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.product_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center font-display text-xl text-brand-700/25">
                      {item.product_name[0]}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/p/${item.product_slug}`}
                    className="font-medium leading-snug hover:text-brand-600 hover:underline underline-offset-2"
                  >
                    {item.product_name}
                  </Link>
                  <p className="mt-1 text-[0.8125rem] text-ink-muted">
                    {item.variant_name} · {t("item.sku")} <span dir="ltr" className="num">{item.sku}</span>
                  </p>
                  <p className="num mt-1 text-[0.8125rem] text-ink-muted">
                    {item.deal_price != null ? (
                      <>
                        <span className="font-semibold text-deal">{t("item.dealPrice", { price: formatPrice(item.deal_price) })}</span>{" "}
                        <span className="line-through">{formatPrice(item.unit_price)}</span>{" "}
                        <span className="label rounded-xs bg-deal px-1.5 py-0.5 text-surface">
                          {t("item.flashDeal")}
                        </span>
                      </>
                    ) : (
                      <>{t("item.unitPrice", { price: formatPrice(item.unit_price) })}</>
                    )}
                  </p>

                  {missing ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-danger">
                      {t("item.outOfStock")}
                    </p>
                  ) : exceeds ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-warning">
                      {t("item.exceeds", { count: item.available })}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <QuantityStepper
                      compact
                      value={item.quantity}
                      min={1}
                      max={Math.max(1, Math.min(item.available, 99))}
                      disabled={missing || updateItem.isPending}
                      onChange={(qty) =>
                        updateItem.mutate({ item_id: item.id, quantity: qty })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeItem.mutate(item.id)}
                      disabled={removeItem.isPending}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] text-ink-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      <TrashIcon width={15} height={15} />
                      {t("item.remove")}
                    </button>
                  </div>
                </div>

                <div className="sm:text-end">
                  {item.deal_price != null ? (
                    <div>
                      <Price value={item.deal_price * item.quantity} size="lg" className="text-deal" />
                      <p className="num text-[0.8125rem] text-ink-muted line-through">
                        {formatPrice(item.line_total)}
                      </p>
                    </div>
                  ) : (
                    <Price value={item.line_total} size="lg" />
                  )}
                </div>
              </article>
            );
            })}
          </div>
        </div>

        {/* fixed basis so the summary never shares space with the item list;
            self-start keeps a sticky box from being stretched by the row */}
        <aside className="lg:sticky lg:top-36 lg:w-[340px] lg:shrink-0 lg:self-start">
          <div className="rounded-md bg-surface border border-line">
            <div className="px-5 py-4">
              <h2 className="text-lg">{t("summary.title")}</h2>
            </div>

            {/* Coupon: one input while none is applied, one chip once it is.
                The highlight yellow is spent here and nowhere else on the page. */}
            <div className="border-t border-line px-5 py-4">
              {data.coupon ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span dir="ltr" className="inline-flex items-center gap-2 rounded-md bg-highlight px-2.5 py-1.5 text-xs font-semibold text-highlight-ink">
                    {data.coupon.code}
                    <span className="font-normal opacity-80">{t("coupon.applied")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCoupon.mutate()}
                    disabled={removeCoupon.isPending}
                    className="text-[0.8125rem] text-ink-muted underline underline-offset-2 transition hover:text-ink disabled:opacity-40"
                  >
                    {t("coupon.remove")}
                  </button>
                </div>
              ) : (
                <form onSubmit={onApplyCoupon} className="flex gap-2">
                  <Input
                    id="coupon-code"
                    dir="ltr"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder={t("coupon.placeholder")}
                    aria-label={t("coupon.label")}
                    autoComplete="off"
                    className="h-9 flex-1 uppercase"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    loading={applyCoupon.isPending}
                    disabled={!couponCode.trim()}
                  >
                    {t("coupon.apply")}
                  </Button>
                </form>
              )}
              {applyCoupon.isError ? (
                <InlineError className="mt-2">
                  {applyCoupon.error instanceof Error
                    ? applyCoupon.error.message
                    : t("errors.coupon")}
                </InlineError>
              ) : null}
            </div>

            <dl className="space-y-3 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("summary.subtotal")}</dt>
                <dd className="num font-medium">{formatPrice(data.subtotal)}</dd>
              </div>
              {data.flash_discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">{t("summary.flashDeal")}</dt>
                  <dd className="num font-medium text-deal"><span dir="ltr">−{formatPrice(data.flash_discount)}</span></dd>
                </div>
              ) : null}
              {data.auto_discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">{t("summary.discount")}</dt>
                  <dd className="num font-medium text-deal"><span dir="ltr">−{formatPrice(data.auto_discount)}</span></dd>
                </div>
              ) : null}
              {data.coupon?.kind === "free_delivery" ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">
                    {t("summary.coupon")} <span dir="ltr" className="font-medium text-ink">{data.coupon.code}</span>
                  </dt>
                  <dd className="num font-medium text-brand-600">{t("summary.freeDelivery")}</dd>
                </div>
              ) : data.discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">
                    {t("summary.coupon")} <span dir="ltr" className="font-medium text-ink">{data.coupon?.code}</span>
                  </dt>
                  <dd className="num font-medium text-deal"><span dir="ltr">−{formatPrice(data.discount)}</span></dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("summary.delivery")}</dt>
                <dd className="num font-medium">
                  {data.delivery_fee === 0 ? (
                    <span className="text-brand-600">{t("summary.free")}</span>
                  ) : (
                    formatPrice(data.delivery_fee)
                  )}
                </dd>
              </div>
              <div className="flex justify-between pt-3 text-base">
                <dt className="font-medium">{t("summary.total")}</dt>
                <dd className="num font-semibold">{formatPrice(data.total)}</dd>
              </div>
            </dl>
            {data.free_delivery_gap > 0 ? (
              <p className="bg-surface-2/50 px-5 py-3 text-[0.8125rem] text-ink-muted " dangerouslySetInnerHTML={{ __html: t("summary.gap", { amount: formatPrice(data.free_delivery_gap) }) }} />
            ) : (
              <p className="bg-brand-600/8 px-5 py-3 text-[0.8125rem] text-brand-600 ">
                {t("summary.unlocked")}
              </p>
            )}
            <div className="space-y-2.5 px-5 py-4">
              <Button
                block
                size="lg"
                onClick={() => navigate("/checkout")}
                disabled={data.items.some((i) => i.available < i.quantity)}
              >
                {t("summary.checkout")}
              </Button>
              <Link to="/products">
                <Button block variant="ghost">
                  {t("summary.continue")}
                </Button>
              </Link>
            </div>
            <div className="bg-surface-2/50 px-5 py-3 ">
              <Badge tone="neutral">{t("summary.cod")}</Badge>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
