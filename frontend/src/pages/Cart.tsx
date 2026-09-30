import { Link, useNavigate } from "react-router-dom";

import { useCart, useRemoveCartItem, useUpdateCartItem } from "@/hooks/queries/cart";
import { money } from "@/lib/format";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BagIcon, TrashIcon } from "@/components/ui/Icon";
import { Price, QuantityStepper } from "@/components/ui/Price";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

export function CartPage() {
  const cart = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const navigate = useNavigate();

  if (cart.isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Skeleton className="h-8 w-40" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-4 border border-line bg-surface p-4">
                <Skeleton className="size-20" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-9 w-32" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
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

  const freeDeliveryGap = data.subtotal >= 999 ? 0 : Math.max(0, 999 - data.subtotal);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-leaf">Your basket</p>
        <h1 className="mt-1.5 text-3xl">Cart</h1>
        <p className="mt-1.5 text-sm text-ink-soft num">
          {data.item_count} item{data.item_count === 1 ? "" : "s"}
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
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

          {data.items.map((item) => {
            const missing = item.available <= 0;
            const exceeds = item.quantity > item.available && item.available > 0;
            return (
              <article
                key={item.id}
                className="flex flex-col gap-4 border border-line bg-surface p-4 sm:flex-row sm:items-start"
              >
                <Link
                  to={`/p/${item.product_slug}`}
                  className="size-24 shrink-0 overflow-hidden border border-line bg-mist"
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.product_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center font-display text-xl text-forest/25">
                      {item.product_name[0]}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/p/${item.product_slug}`}
                    className="font-medium leading-snug hover:text-leaf hover:underline underline-offset-2"
                  >
                    {item.product_name}
                  </Link>
                  <p className="mt-1 text-[0.8125rem] text-ink-soft">
                    {item.variant_name} · SKU <span className="num">{item.sku}</span>
                  </p>
                  <p className="num mt-1 text-[0.8125rem] text-ink-soft">
                    {money(item.unit_price)} each
                  </p>

                  {missing ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-brick">
                      Out of stock — remove this item to continue.
                    </p>
                  ) : exceeds ? (
                    <p className="mt-2 text-[0.8125rem] font-medium text-amber">
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
                      className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-transparent px-2 text-[0.8125rem] text-ink-soft transition-colors hover:border-brick/40 hover:text-brick disabled:opacity-40"
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

        <aside className="lg:sticky lg:top-36 lg:self-start">
          <div className="border border-line bg-surface">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-lg">Order summary</h2>
            </div>
            <dl className="space-y-3 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd className="num font-medium">{money(data.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Delivery</dt>
                <dd className="num font-medium">
                  {data.delivery_fee === 0 ? (
                    <span className="text-leaf">Free</span>
                  ) : (
                    money(data.delivery_fee)
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3 text-base">
                <dt className="font-medium">Total</dt>
                <dd className="num font-semibold">{money(data.total)}</dd>
              </div>
            </dl>
            {freeDeliveryGap > 0 ? (
              <p className="border-t border-line bg-mist/60 px-5 py-3 text-[0.8125rem] text-ink-soft">
                Add <span className="num font-medium text-ink">{money(freeDeliveryGap)}</span> more
                for free delivery.
              </p>
            ) : (
              <p className="border-t border-line bg-leaf/8 px-5 py-3 text-[0.8125rem] text-leaf">
                You have unlocked free delivery.
              </p>
            )}
            <div className="space-y-2.5 border-t border-line px-5 py-4">
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
            <div className="border-t border-line px-5 py-3">
              <Badge tone="neutral">Cash on delivery</Badge>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
