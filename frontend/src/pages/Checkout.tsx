import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useAddresses,
  useCheckoutSummary,
  useDeleteAddress,
  usePlaceOrder,
} from "@/hooks/queries/checkout";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { AddressIn } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Form";
import { BanknoteIcon, PinIcon, TrashIcon } from "@/components/ui/Icon";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const EMPTY_ADDRESS: AddressIn = {
  full_name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "India",
  is_default: false,
};

export function CheckoutPage() {
  const summary = useCheckoutSummary();
  const addresses = useAddresses();
  const placeOrder = usePlaceOrder();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"saved" | "new">("saved");
  const [addressId, setAddressId] = useState<number | null>(null);
  const [form, setForm] = useState<AddressIn>(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(true);
  const [note, setNote] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [paymentCode, setPaymentCode] = useState<string>("");

  const addressList = useMemo(() => addresses.data ?? [], [addresses.data]);

  useEffect(() => {
    if (addressId === null && addressList.length > 0) {
      const def = addressList.find((a) => a.is_default) ?? addressList[0];
      setAddressId(def.id);
      setMode("saved");
    }
    if (addressList.length === 0 && mode === "saved" && addresses.isSuccess) {
      setMode("new");
    }
  }, [addressList, addressId, mode, addresses.isSuccess]);

  const methods = summary.data?.payment_methods ?? [];
  useEffect(() => {
    if (!paymentCode && methods.length > 0) {
      const cod = methods.find((m) => m.code === "cod") ?? methods[0];
      setPaymentCode(cod.code);
    }
  }, [methods, paymentCode]);

  if (summary.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="h-8 w-56" />
        <div className="mt-8 flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-5">
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-72 w-full lg:w-[340px] lg:shrink-0" />
        </div>
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      </div>
    );
  }

  const cartSummary = summary.data!;

  if (cartSummary.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="Nothing to check out"
          body="Your cart is empty. Add a few things first."
          action={
            <Link to="/products">
              <Button>Browse products</Button>
            </Link>
          }
        />
      </div>
    );
  }

  function setField(key: keyof AddressIn, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateNewAddress(): boolean {
    const errors: Record<string, string> = {};
    if (form.full_name.trim().length < 2) errors.full_name = "Enter the recipient's name";
    if (!/^\d{7,15}$/.test(form.phone.replace(/\D/g, "")))
      errors.phone = "Enter a valid phone number";
    if (!form.line1.trim()) errors.line1 = "Enter the street address";
    if (!form.city.trim()) errors.city = "Enter the city";
    if (!form.state.trim()) errors.state = "Enter the state";
    if (!form.postal_code.trim()) errors.postal_code = "Enter the PIN code";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    placeOrder.reset();

    if (mode === "new" && !validateNewAddress()) return;
    if (mode === "saved" && addressId === null) {
      setFormErrors({ address: "Choose a delivery address or add a new one" });
      return;
    }

    try {
      const order = await placeOrder.mutateAsync({
        payment_method: paymentCode,
        ...(mode === "saved"
          ? { address_id: addressId ?? undefined }
          : { address: form, save_address: saveAddress }),
        note: note.trim() ? note.trim() : undefined,
      });
      navigate(`/orders/${order.id}?placed=1`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setFormErrors(err.fieldErrors());
      }
    }
  }

  const serverError =
    placeOrder.error instanceof ApiError ? placeOrder.error : placeOrder.error;

  const shortages =
    placeOrder.error instanceof ApiError &&
    placeOrder.error.details &&
    typeof placeOrder.error.details === "object" &&
    "shortages" in (placeOrder.error.details as object)
      ? ((placeOrder.error.details as { shortages?: unknown }).shortages as
          | Array<{ product: string; variant: string; available: number }>
          | undefined)
      : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
      <div className="pb-1">
        <p className="label text-brand-600">Almost there</p>
        <h1 className="mt-1.5 text-3xl">Checkout</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Cash on delivery — pay when your order arrives.</p>
      </div>

      {/* Form + order summary: a flex row of two boxes. The form grows, the
          summary keeps a fixed basis; they stack on small screens. */}
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-6">
          <section className="rounded-md bg-surface border border-line">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg">
                <PinIcon width={17} height={17} className="text-brand-600" />
                Delivery address
              </h2>
              {addressList.length > 0 ? (
                <div className="flex gap-1 rounded-md bg-surface-2 p-1 shadow-pressed">
                  <button
                    type="button"
                    onClick={() => setMode("saved")}
                    className={cn(
                      "label rounded-lg px-2.5 py-1.5 transition",
                      mode === "saved"
                        ? "bg-surface font-semibold text-brand-700 border border-line"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    Saved
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className={cn(
                      "label rounded-lg px-2.5 py-1.5 transition",
                      mode === "new"
                        ? "bg-surface font-semibold text-brand-700 border border-line"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    New address
                  </button>
                </div>
              ) : null}
            </div>

            <div className="px-5 py-5">
              {mode === "saved" ? (
                addresses.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : addressList.length === 0 ? (
                  <div className="text-sm text-ink-muted">
                    No saved addresses yet.{" "}
                    <button
                      type="button"
                      onClick={() => setMode("new")}
                      className="text-brand-600 underline underline-offset-2"
                    >
                      Add one
                    </button>
                    .
                  </div>
                ) : (
                  <div className="space-y-3">
                    {addressList.map((addr) => {
                      const selected = addressId === addr.id;
                      return (
                        <div
                          key={addr.id}
                          className={cn(
                            "flex items-start gap-3 rounded-md bg-surface p-4 border border-line transition hover:shadow-lift",
                            selected && "bg-surface ring-2 ring-brand-600/40",
                          )}
                        >
                          <input
                            type="radio"
                            name="address"
                            checked={selected}
                            onChange={() => setAddressId(addr.id)}
                            className="mt-1 size-4 accent-brand-700"
                            aria-label={`Select address of ${addr.full_name}`}
                          />
                          <div className="min-w-0 flex-1 text-sm">
                            <p
                              className={cn(
                                "flex flex-wrap items-center gap-2",
                                selected ? "font-semibold text-ink" : "font-medium text-ink-muted",
                              )}
                            >
                              {addr.full_name}
                              {addr.is_default ? <Badge tone="info">Default</Badge> : null}
                            </p>
                            <p className="num mt-0.5 text-ink-muted">{addr.phone}</p>
                            <p className="mt-1 text-ink-muted">
                              {addr.line1}
                              {addr.line2 ? `, ${addr.line2}` : ""}, {addr.city}, {addr.state}{" "}
                              <span className="num">{addr.postal_code}</span>
                            </p>
                          </div>
                          <DeleteAddressButton
                            addressId={addr.id}
                            onDeleted={() => {
                              if (addressId === addr.id) setAddressId(null);
                            }}
                          />
                        </div>
                      );
                    })}
                    {formErrors.address ? (
                      <InlineError>{formErrors.address}</InlineError>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="full_name" error={formErrors.full_name} className="sm:col-span-2">
                    <Input
                      id="full_name"
                      value={form.full_name}
                      onChange={(e) => setField("full_name", e.target.value)}
                      invalid={Boolean(formErrors.full_name)}
                      autoComplete="name"
                    />
                  </Field>
                  <Field label="Phone" htmlFor="phone" error={formErrors.phone}>
                    <Input
                      id="phone"
                      inputMode="tel"
                      value={form.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                      invalid={Boolean(formErrors.phone)}
                      autoComplete="tel"
                    />
                  </Field>
                  <Field label="PIN code" htmlFor="postal_code" error={formErrors.postal_code}>
                    <Input
                      id="postal_code"
                      inputMode="numeric"
                      value={form.postal_code}
                      onChange={(e) => setField("postal_code", e.target.value)}
                      invalid={Boolean(formErrors.postal_code)}
                      autoComplete="postal-code"
                    />
                  </Field>
                  <Field
                    label="Street address"
                    htmlFor="line1"
                    error={formErrors.line1}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="line1"
                      placeholder="House no., street"
                      value={form.line1}
                      onChange={(e) => setField("line1", e.target.value)}
                      invalid={Boolean(formErrors.line1)}
                      autoComplete="address-line1"
                    />
                  </Field>
                  <Field label="Landmark (optional)" htmlFor="line2" className="sm:col-span-2">
                    <Input
                      id="line2"
                      value={form.line2 ?? ""}
                      onChange={(e) => setField("line2", e.target.value)}
                      autoComplete="address-line2"
                    />
                  </Field>
                  <Field label="City" htmlFor="city" error={formErrors.city}>
                    <Input
                      id="city"
                      value={form.city}
                      onChange={(e) => setField("city", e.target.value)}
                      invalid={Boolean(formErrors.city)}
                      autoComplete="address-level2"
                    />
                  </Field>
                  <Field label="State" htmlFor="state" error={formErrors.state}>
                    <Input
                      id="state"
                      value={form.state}
                      onChange={(e) => setField("state", e.target.value)}
                      invalid={Boolean(formErrors.state)}
                      autoComplete="address-level1"
                    />
                  </Field>
                  <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center">
                    <Checkbox
                      label="Save this address to my account"
                      checked={saveAddress}
                      onChange={(e) => setSaveAddress(e.target.checked)}
                    />
                    <Checkbox
                      label="Set as default"
                      checked={Boolean(form.is_default)}
                      onChange={(e) => setField("is_default", e.target.checked)}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md bg-surface border border-line">
            <div className="flex items-center gap-2 px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg">
                <BanknoteIcon width={17} height={17} className="text-brand-600" />
                Payment
              </h2>
            </div>
            <div className="px-5 py-5">
              <div className="space-y-3">
                {methods.map((method) => (
                  <label
                    key={method.code}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md bg-surface p-4 border border-line transition hover:shadow-lift",
                      paymentCode === method.code && "bg-surface ring-2 ring-brand-600/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentCode === method.code}
                      onChange={() => setPaymentCode(method.code)}
                      className="mt-1 size-4 accent-brand-700"
                    />
                    <span className="text-sm">
                      <span
                        className={cn(
                          "block",
                          paymentCode === method.code
                            ? "font-semibold text-ink"
                            : "font-medium text-ink-muted",
                        )}
                      >
                        {method.name}
                      </span>
                      <span className="mt-0.5 block text-ink-muted">
                        {method.code === "cod"
                          ? "Hand the exact amount to our delivery partner."
                          : "Pay securely at checkout."}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <Field label="Order note (optional)" htmlFor="note" className="mt-5">
                <Textarea
                  id="note"
                  rows={3}
                  placeholder="Gate code, best time to deliver…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </section>
        </div>

        {/* fixed basis so the summary never shares space with the form;
            self-start keeps a sticky box from being stretched by the row */}
        <aside className="lg:sticky lg:top-36 lg:w-[360px] lg:shrink-0 lg:self-start">
          <div className="rounded-md bg-surface border border-line">
            <div className="px-5 py-4">
              <h2 className="text-lg">Your order</h2>
            </div>
            <ul className="divide-y divide-line px-5">
              {cartSummary.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 py-3.5 text-sm">
                  <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-[0.75rem] font-semibold">
                    {item.quantity}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.product_name}</span>
                    <span className="block text-[0.8125rem] text-ink-muted">{item.variant_name}</span>
                  </span>
                  <span className="num shrink-0">{money(item.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-3 bg-surface-2/50 px-5 py-4 text-sm ">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="num font-medium">{money(cartSummary.subtotal)}</dd>
              </div>
              {cartSummary.discount > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-muted">
                    Coupon{" "}
                    <span className="rounded-md bg-highlight px-1.5 py-0.5 text-[0.6875rem] font-semibold text-highlight-ink">
                      {cartSummary.coupon?.code}
                    </span>
                  </dt>
                  <dd className="num shrink-0 font-medium text-deal">
                    −{money(cartSummary.discount)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-muted">Delivery</dt>
                <dd className="num font-medium">
                  {cartSummary.delivery_fee === 0 ? (
                    <span className="text-brand-600">Free</span>
                  ) : (
                    money(cartSummary.delivery_fee)
                  )}
                </dd>
              </div>
              <div className="flex justify-between pt-3 text-base">
                <dt className="font-medium">Total</dt>
                <dd className="num font-semibold">{money(cartSummary.total)}</dd>
              </div>
            </dl>

            {serverError ? (
              <div className="px-5 py-4">
                <InlineError>{serverError.message}</InlineError>
                {shortages && shortages.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[0.8125rem] text-danger">
                    {shortages.map((s) => (
                      <li key={`${s.product}-${s.variant}`} className="num">
                        {s.product} ({s.variant}) — {s.available} left
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3">
                  <Link to="/cart" className="text-sm text-brand-600 underline underline-offset-2">
                    Back to cart
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="px-5 py-4">
              <Button
                type="submit"
                size="lg"
                block
                loading={placeOrder.isPending}
                disabled={
                  cartSummary.items.some((i) => i.available < i.quantity) ||
                  (mode === "saved" && addressId === null)
                }
              >
                Place order · {money(cartSummary.total)}
              </Button>
              <p className="mt-3 text-center text-[0.75rem] text-ink-muted">
                Cash on delivery — you pay when the order reaches you.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}

function DeleteAddressButton({
  addressId,
  onDeleted,
}: {
  addressId: number;
  onDeleted: () => void;
}) {
  const del = useDeleteAddress();
  return (
    <button
      type="button"
      aria-label="Remove address"
      disabled={del.isPending}
      onClick={() => {
        if (!window.confirm("Remove this address from your account?")) return;
        del.mutate(addressId, { onSuccess: onDeleted });
      }}
      className="text-ink-muted transition-colors hover:text-danger disabled:opacity-40"
    >
      <TrashIcon width={16} height={16} />
    </button>
  );
}
