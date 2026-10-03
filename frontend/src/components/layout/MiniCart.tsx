import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useCart, useRemoveCartItem, useUpdateCartItem } from "@/hooks/queries/cart";
import { money } from "@/lib/format";

import { Button } from "@/components/ui/Button";
import { CloseIcon, TrashIcon } from "@/components/ui/Icon";
import { QuantityStepper } from "@/components/ui/Price";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";

export function MiniCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart();
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const data = cart.data;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Close cart"
        onClick={onClose}
        className="absolute inset-0 bg-overlay/50 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-label="Shopping cart"
        className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col border-s border-line bg-surface shadow-panel"
      >
        <header className="flex items-center justify-between px-5 pb-4 pt-5">
          <div>
            <p className="label text-ink-muted">Your basket</p>
            <p className="mt-1 font-display text-xl font-semibold">
              {data ? `${data.item_count} item${data.item_count === 1 ? "" : "s"}` : "Cart"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="grid size-9 place-items-center rounded-md border border-line bg-surface transition hover:bg-surface-2"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {cart.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : cart.isError ? (
            <div className="p-5">
              <ErrorState error={cart.error} onRetry={() => void cart.refetch()} />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Your basket is empty"
                body="Add a few everyday essentials and they will show up here."
                action={
                  <Button
                    onClick={() => {
                      onClose();
                      navigate("/products");
                    }}
                  >
                    Browse products
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.items.map((item) => (
                <li key={item.id} className="flex gap-3 p-4">
                  <Link
                    to={`/p/${item.product_slug}`}
                    onClick={onClose}
                    className="grid size-16 shrink-0 place-items-center overflow-hidden bg-surface-2 text-center text-[0.6rem] font-semibold text-brand-700"
                  >
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      item.product_name.slice(0, 2).toUpperCase()
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/p/${item.product_slug}`}
                      onClick={onClose}
                      className="block truncate text-sm font-medium hover:text-brand-600"
                    >
                      {item.product_name}
                    </Link>
                    <p className="mt-0.5 truncate text-[0.6875rem] text-ink-muted">
                      {item.variant_name} · {money(item.unit_price)}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <QuantityStepper
                        compact
                        value={item.quantity}
                        max={Math.max(item.available, 1)}
                        onChange={(next) => update.mutate({ item_id: item.id, quantity: next })}
                        disabled={update.isPending}
                      />
                      <span className="num text-sm font-semibold">{money(item.line_total)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${item.product_name} from cart`}
                        onClick={() => remove.mutate(item.id)}
                        className="text-ink-muted transition-colors hover:text-danger"
                      >
                        <TrashIcon width={16} height={16} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data && data.items.length > 0 ? (
          <footer className="bg-surface-2/50 px-5 py-4 ">
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="num font-medium">{money(data.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">Delivery</dt>
                <dd className="num font-medium">
                  {data.delivery_fee === 0 ? "Free" : money(data.delivery_fee)}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-2">
                <dt className="font-medium">Total</dt>
                <dd className="num text-lg font-semibold">{money(data.total)}</dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-2">
              <Button
                block
                onClick={() => {
                  onClose();
                  navigate("/checkout");
                }}
              >
                Checkout
              </Button>
              <Button
                variant="secondary"
                block
                onClick={() => {
                  onClose();
                  navigate("/cart");
                }}
              >
                View basket
              </Button>
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
