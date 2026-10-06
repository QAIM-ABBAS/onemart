import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useApplyCoupon,
  useCart,
  useRemoveCartItem,
  useRemoveCoupon,
  useUpdateCartItem,
} from "@/hooks/queries/cart";
import { money } from "@/lib/format";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { BagIcon, TrashIcon } from "@/components/ui/Icon";
import { Price, QuantityStepper } from "@/components/ui/Price";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

export function CartPage() {
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
          title="Your cart is empty"
          body="Browse the catalogue and add the things you need — groceries, home care, daily essentials."
          action={
            <Link to="/products">
              <Button>
                <BagIcon width={16} height={16} />
                Start shopping
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const onApplyCoupon = (event: FormEvent) => {
    event.preventDefault();
    const code = couponCode.trim();
    if (!code) return;
    applyCoupon.mutate(code, { onSuccess: () => setCouponCode("") });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
      <div className="pb-1">
        <p className="label text-brand-600">Your basket</p>
        <h1 className="mt-1.5 text-3xl">Cart</h1>
        <p className="mt-1.5 text-sm text-ink-muted num">
          {data.item_count} item{data.item_count === 1 ? "" : "s"}
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
                : "Could not update quantity."}
            </InlineError>
          ) : null}
          {removeItem.isError ? (
            <InlineError>
              {removeItem.error instanceof Error
                ? removeItem.error.message
                : "Could not remove item."}
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
                    {item.variant_name} · SKU <span className="num">{item.sku}</span>
                  </p>
                  <p className="num mt-1 text-[0.8125rem] text-ink-muted">
                    {money(item.unit_price)} each
                  </p>

                  {missing ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-danger">
                      Out of stock — remove this item to continue.
                    </p>
                  ) : exceeds ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-warning">
                      Only {item.available} available. Reduce the quantity to check out.
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
                      Remove
                    </button>
                  </div>
                </div>

                <div className="sm:text-right">
                  <Price value={item.line_total} size="lg" />
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
              <h2 className="text-lg">Order summary</h2>
            </div>

            {/* Coupon: one input while none is applied, one chip once it is.
                The highlight yellow is spent here and nowhere else on the page. */}
            <div className="border-t border-line px-5 py-4">
              {data.coupon ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 rounded-md bg-highlight px-2.5 py-1.5 text-xs font-semibold text-highlight-ink">
                    {data.coupon.code}
                    <span className="font-normal opacity-80">applied</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCoupon.mutate()}
                    disabled={removeCoupon.isPending}
                    className="text-[0.8125rem] text-ink-muted underline underline-offset-2 transition hover:text-ink disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <form onSubmit={onApplyCoupon} className="flex gap-2">
                  <Input
                    id="coupon-code"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
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
                    Apply
                  </Button>
                </form>
              )}
              {applyCoupon.isError ? (
                <InlineError className="mt-2">
                  {applyCoupon.error instanceof Error
                    ? applyCoupon.error.message
                    : "Could not apply that code."}
                </InlineError>
              ) : null}
            </div>

            <dl className="space-y-3 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="num font-medium">{money(data.subtotal)}</dd>
              </div>
              {data.auto_discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Discount</dt>
                  <dd className="num font-medium text-deal">−{money(data.auto_discount)}</dd>
                </div>
              ) : null}
              {data.coupon?.kind === "free_delivery" ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">
                    Coupon <span className="font-medium text-ink">{data.coupon.code}</span>
                  </dt>
                  <dd className="num font-medium text-brand-600">Free delivery</dd>
                </div>
              ) : data.discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">
                    Coupon <span className="font-medium text-ink">{data.coupon?.code}</span>
                  </dt>
                  <dd className="num font-medium text-deal">−{money(data.discount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-muted">Delivery</dt>
                <dd className="num font-medium">
                  {data.delivery_fee === 0 ? (
                    <span className="text-brand-600">Free</span>
                  ) : (
                    money(data.delivery_fee)
                  )}
                </dd>
              </div>
              <div className="flex justify-between pt-3 text-base">
                <dt className="font-medium">Total</dt>
                <dd className="num font-semibold">{money(data.total)}</dd>
              </div>
            </dl>
            {data.free_delivery_gap > 0 ? (
              <p className="bg-surface-2/50 px-5 py-3 text-[0.8125rem] text-ink-muted ">
                Add <span className="num font-medium text-ink">{money(data.free_delivery_gap)}</span> more
                for free delivery.
              </p>
            ) : (
              <p className="bg-brand-600/8 px-5 py-3 text-[0.8125rem] text-brand-600 ">
                You have unlocked free delivery.
              </p>
            )}
            <div className="space-y-2.5 px-5 py-4">
              <Button
                block
                size="lg"
                onClick={() => navigate("/checkout")}
                disabled={data.items.some((i) => i.available < i.quantity)}
              >
                Proceed to checkout
              </Button>
              <Link to="/products">
                <Button block variant="ghost">
                  Continue shopping
                </Button>
              </Link>
            </div>
            <div className="bg-surface-2/50 px-5 py-3 ">
              <Badge tone="neutral">Cash on delivery</Badge>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
