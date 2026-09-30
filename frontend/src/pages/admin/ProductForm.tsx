import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  useAdminCategories,
  useAdminProduct,
  useSaveProduct,
} from "@/hooks/queries/admin";
import { useBrands } from "@/hooks/queries/catalog";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { CategoryNode, ProductWrite, VariantIn, ImageIn } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { PlusIcon, TrashIcon } from "@/components/ui/Icon";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/States";

let uidSeq = 0;
const nextUid = () => `f${++uidSeq}`;

interface AttrRow {
  uid: string;
  key: string;
  value: string;
}

interface VariantForm {
  uid: string;
  id?: number;
  sku: string;
  name: string;
  price: string;
  compareAt: string;
  isDefault: boolean;
  attrs: AttrRow[];
  initialStock: string;
  active: boolean;
}

interface ImageForm {
  uid: string;
  url: string;
  alt: string;
}

interface FormState {
  name: string;
  categoryId: string;
  brandId: string;
  description: string;
  isActive: boolean;
  isFeatured: boolean;
  variants: VariantForm[];
  images: ImageForm[];
}

function blankVariant(isDefault: boolean): VariantForm {
  return {
    uid: nextUid(),
    sku: "",
    name: isDefault ? "Default" : "",
    price: "",
    compareAt: "",
    isDefault,
    attrs: [],
    initialStock: "0",
    active: true,
  };
}

const BLANK_FORM: FormState = {
  name: "",
  categoryId: "",
  brandId: "",
  description: "",
  isActive: true,
  isFeatured: false,
  variants: [blankVariant(true)],
  images: [],
};

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  const out: { node: CategoryNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children?.length) out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

export function AdminProductFormPage() {
  const { productId } = useParams<{ productId: string }>();
  const isEdit = Boolean(productId);
  const navigate = useNavigate();

  const productQuery = useAdminProduct(productId);
  const categories = useAdminCategories();
  const brands = useBrands();
  const save = useSaveProduct(productId ? Number(productId) : undefined);

  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isEdit || !productQuery.data) return;
    if (loadedFor.current === productId) return;
    loadedFor.current = productId ?? null;
    const p = productQuery.data;
    setForm({
      name: p.name,
      categoryId: String(p.category_id),
      brandId: p.brand_id ? String(p.brand_id) : "",
      description: p.description ?? "",
      isActive: p.is_active ?? true,
      isFeatured: p.is_featured ?? false,
      variants: (p.variants ?? []).map((v) => ({
        uid: nextUid(),
        id: v.id,
        sku: v.sku,
        name: v.name,
        price: String(v.price),
        compareAt: v.compare_at_price ? String(v.compare_at_price) : "",
        isDefault: v.is_default,
        attrs: Object.entries(v.attributes ?? {}).map(([key, value]) => ({
          uid: nextUid(),
          key,
          value: String(value),
        })),
        initialStock: "",
        active: v.is_active ?? true,
      })),
      images: (p.images ?? []).map((img) => ({
        uid: nextUid(),
        url: img.url,
        alt: img.alt ?? "",
      })),
    });
  }, [isEdit, productId, productQuery.data]);

  const flatCategories = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  function patch(partial: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function patchVariant(uid: string, partial: Partial<VariantForm>) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((v) => (v.uid === uid ? { ...v, ...partial } : v)),
    }));
    setFieldErrors({});
  }

  function removeVariant(uid: string) {
    setForm((prev) => {
      if (prev.variants.length <= 1) return prev;
      const variants = prev.variants.filter((v) => v.uid !== uid);
      if (!variants.some((v) => v.isDefault)) variants[0] = { ...variants[0], isDefault: true };
      return { ...prev, variants };
    });
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (form.name.trim().length < 2) errors.name = "Name must be at least 2 characters";
    if (!form.categoryId) errors.category_id = "Choose a category";
    if (form.variants.length === 0) errors.variants = "Add at least one variant";

    const skus = new Set<string>();
    for (const v of form.variants) {
      const sku = v.sku.trim();
      if (sku.length < 2) errors[`sku-${v.uid}`] = "SKU must be at least 2 characters";
      if (skus.has(sku)) errors[`sku-${v.uid}`] = "SKU must be unique in this product";
      skus.add(sku);
      const price = Number(v.price);
      if (!Number.isFinite(price) || price <= 0)
        errors[`price-${v.uid}`] = "Enter a price greater than 0";
      if (v.compareAt && (!Number.isFinite(Number(v.compareAt)) || Number(v.compareAt) <= 0))
        errors[`compare-${v.uid}`] = "Enter a valid compare-at price";
      if (v.initialStock !== "" && Number(v.initialStock) < 0)
        errors[`stock-${v.uid}`] = "Stock cannot be negative";
    }

    if (form.images.some((img) => !img.url.trim())) {
      errors.images = "Every image needs a URL";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.reset();
    if (!validate()) return;

    const variants: VariantIn[] = form.variants.map((v, index) => ({
      id: v.id,
      sku: v.sku.trim(),
      name: v.name.trim() || "Default",
      attributes: Object.fromEntries(
        v.attrs.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value]),
      ),
      price: Number(v.price),
      compare_at_price: v.compareAt ? Number(v.compareAt) : null,
      is_default: v.isDefault,
      is_active: v.active,
      position: index,
      initial_stock: v.id ? undefined : Number(v.initialStock || 0),
    }));

    const images: ImageIn[] = form.images.map((img, index) => ({
      url: img.url.trim(),
      alt: img.alt.trim(),
      position: index,
    }));

    const payload: ProductWrite = {
      name: form.name.trim(),
      category_id: Number(form.categoryId),
      brand_id: form.brandId ? Number(form.brandId) : null,
      description: form.description,
      is_active: form.isActive,
      is_featured: form.isFeatured,
      variants,
      images,
    };

    try {
      const saved = await save.mutateAsync(payload);
      navigate(`/admin/products/${saved.id}/edit`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
      }
    }
  }

  if (isEdit && productQuery.isLoading) {
    return (
      <div className="max-w-3xl">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (isEdit && productQuery.isError) {
    return (
      <div className="max-w-2xl">
        <ErrorState error={productQuery.error} onRetry={() => void productQuery.refetch()} />
      </div>
    );
  }

  const serverError = save.error instanceof ApiError ? save.error : save.error;

  return (
    <div className="max-w-4xl">
      <div className="border-b border-ink/15 pb-4">
        <Link to="/admin/products" className="label text-ink-soft hover:text-ink">
          ← Products
        </Link>
        <h1 className="mt-2 text-2xl sm:text-3xl">
          {isEdit ? `Edit ${form.name || "product"}` : "New product"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every product needs at least one variant with its own SKU, price and stock.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-6" noValidate>
        {serverError ? (
          <InlineError>
            {serverError instanceof ApiError &&
            Array.isArray(serverError.details) &&
            serverError.details.length === 0
              ? serverError.message
              : serverError instanceof ApiError
                ? serverError.message
                : "Could not save the product."}
          </InlineError>
        ) : null}

        <section className="border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3.5 text-lg">Basics</h2>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <Field label="Product name" htmlFor="p-name" error={fieldErrors.name} className="sm:col-span-2">
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                invalid={Boolean(fieldErrors.name)}
                placeholder="e.g. Aashirvaad Whole Wheat Atta"
              />
            </Field>
            <Field label="Category" htmlFor="p-cat" error={fieldErrors.category_id}>
              <Select
                id="p-cat"
                value={form.categoryId}
                onChange={(e) => patch({ categoryId: e.target.value })}
                invalid={Boolean(fieldErrors.category_id)}
              >
                <option value="">Select a category…</option>
                {flatCategories.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {depth > 0 ? `${"— ".repeat(depth)}` : ""}
                    {node.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand (optional)" htmlFor="p-brand">
              <Select
                id="p-brand"
                value={form.brandId}
                onChange={(e) => patch({ brandId: e.target.value })}
              >
                <option value="">No brand</option>
                {(brands.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="p-desc" className="sm:col-span-2">
              <Textarea
                id="p-desc"
                rows={4}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="What is it, what's inside, how is it useful…"
              />
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
              <Checkbox
                label="Visible in the storefront"
                checked={form.isActive}
                onChange={(e) => patch({ isActive: e.target.checked })}
              />
              <Checkbox
                label="Featured on the homepage"
                checked={form.isFeatured}
                onChange={(e) => patch({ isFeatured: e.target.checked })}
              />
            </div>
          </div>
        </section>

        <section className="border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <div>
              <h2 className="text-lg">Variants</h2>
              <p className="text-[0.8125rem] text-ink-soft">
                Size, weight or pack — one must be the default.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => patch({ variants: [...form.variants, blankVariant(false)] })}
            >
              <PlusIcon width={15} height={15} />
              Add variant
            </Button>
          </div>

          <div className="divide-y divide-line">
            {form.variants.map((v) => (
              <fieldset key={v.uid} className="px-5 py-5">
                <legend className="sr-only">Variant {v.sku || v.name || "new"}</legend>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="default-variant"
                        checked={v.isDefault}
                        onChange={() =>
                          patchVariant(v.uid, { isDefault: true })
                        }
                        className="size-4 accent-[#1F3D2B]"
                      />
                      Default variant
                    </label>
                    {v.id ? <Badge tone="neutral">Existing</Badge> : <Badge tone="info">New</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                      <input
                        type="checkbox"
                        checked={v.active}
                        onChange={(e) => patchVariant(v.uid, { active: e.target.checked })}
                        className="size-4 accent-[#1F3D2B]"
                      />
                      Active
                    </label>
                    {form.variants.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeVariant(v.uid)}
                        aria-label="Remove variant"
                        className="text-ink-soft transition-colors hover:text-brick"
                      >
                        <TrashIcon width={16} height={16} />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="SKU" htmlFor={`sku-${v.uid}`} error={fieldErrors[`sku-${v.uid}`]}>
                    <Input
                      id={`sku-${v.uid}`}
                      value={v.sku}
                      onChange={(e) => patchVariant(v.uid, { sku: e.target.value })}
                      invalid={Boolean(fieldErrors[`sku-${v.uid}`])}
                      placeholder="OM-ATT-1000"
                    />
                  </Field>
                  <Field label="Variant name" htmlFor={`vname-${v.uid}`}>
                    <Input
                      id={`vname-${v.uid}`}
                      value={v.name}
                      onChange={(e) => patchVariant(v.uid, { name: e.target.value })}
                      placeholder="1 kg"
                    />
                  </Field>
                  <Field label="Price (₹)" htmlFor={`price-${v.uid}`} error={fieldErrors[`price-${v.uid}`]}>
                    <Input
                      id={`price-${v.uid}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={v.price}
                      onChange={(e) => patchVariant(v.uid, { price: e.target.value })}
                      invalid={Boolean(fieldErrors[`price-${v.uid}`])}
                      placeholder="99"
                    />
                  </Field>
                  <Field
                    label="Compare-at (₹)"
                    htmlFor={`cmp-${v.uid}`}
                    error={fieldErrors[`compare-${v.uid}`]}
                    hint="Shown struck through"
                  >
                    <Input
                      id={`cmp-${v.uid}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={v.compareAt}
                      onChange={(e) => patchVariant(v.uid, { compareAt: e.target.value })}
                      placeholder="Optional"
                    />
                  </Field>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="label text-ink-soft">Attributes</p>
                    <div className="mt-2 space-y-2">
                      {v.attrs.map((attr) => (
                        <div key={attr.uid} className="flex gap-2">
                          <Input
                            aria-label="Attribute name"
                            placeholder="weight"
                            value={attr.key}
                            className="h-9 flex-1 text-sm"
                            onChange={(e) =>
                              patchVariant(v.uid, {
                                attrs: v.attrs.map((a) =>
                                  a.uid === attr.uid ? { ...a, key: e.target.value } : a,
                                ),
                              })
                            }
                          />
                          <Input
                            aria-label="Attribute value"
                            placeholder="1 kg"
                            value={attr.value}
                            className="h-9 flex-1 text-sm"
                            onChange={(e) =>
                              patchVariant(v.uid, {
                                attrs: v.attrs.map((a) =>
                                  a.uid === attr.uid ? { ...a, value: e.target.value } : a,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            aria-label="Remove attribute"
                            onClick={() =>
                              patchVariant(v.uid, {
                                attrs: v.attrs.filter((a) => a.uid !== attr.uid),
                              })
                            }
                            className="grid size-9 shrink-0 place-items-center border border-line-strong text-ink-soft transition-colors hover:border-brick/50 hover:text-brick"
                          >
                            <TrashIcon width={15} height={15} />
                          </button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          patchVariant(v.uid, {
                            attrs: [...v.attrs, { uid: nextUid(), key: "", value: "" }],
                          })
                        }
                      >
                        <PlusIcon width={14} height={14} />
                        Add attribute
                      </Button>
                    </div>
                  </div>
                  {!v.id ? (
                    <Field
                      label="Opening stock (units)"
                      htmlFor={`stock-${v.uid}`}
                      error={fieldErrors[`stock-${v.uid}`]}
                      hint="Adjust anytime from the Stock page"
                    >
                      <Input
                        id={`stock-${v.uid}`}
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={v.initialStock}
                        onChange={(e) => patchVariant(v.uid, { initialStock: e.target.value })}
                        className="h-10"
                      />
                    </Field>
                  ) : (
                    <div className="self-end pb-1 text-[0.8125rem] text-ink-soft">
                      Existing variant — stock is managed from the{" "}
                      <Link to="/admin/stock" className="text-leaf underline underline-offset-2">
                        Stock page
                      </Link>
                      .
                    </div>
                  )}
                </div>
              </fieldset>
            ))}
          </div>
          {fieldErrors.variants ? <InlineError className="mx-5 mb-4">{fieldErrors.variants}</InlineError> : null}
        </section>

        <section className="border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <div>
              <h2 className="text-lg">Images</h2>
              <p className="text-[0.8125rem] text-ink-soft">
                First image becomes the catalogue thumbnail.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                patch({ images: [...form.images, { uid: nextUid(), url: "", alt: "" }] })
              }
            >
              <PlusIcon width={15} height={15} />
              Add image
            </Button>
          </div>
          <div className="px-5 py-5">
            {fieldErrors.images ? <InlineError className="mb-3">{fieldErrors.images}</InlineError> : null}
            {form.images.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No images yet — the storefront shows the product's initials instead.
              </p>
            ) : (
              <div className="space-y-3">
                {form.images.map((img) => (
                  <div key={img.uid} className="flex items-start gap-3">
                    <div className="size-14 shrink-0 overflow-hidden border border-line bg-mist">
                      {img.url ? (
                        <img src={img.url} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <Input
                        aria-label="Image URL"
                        placeholder="/api/img/placeholder.svg?text=Atta"
                        value={img.url}
                        className="h-10 text-sm"
                        onChange={(e) =>
                          patch({
                            images: form.images.map((im) =>
                              im.uid === img.uid ? { ...im, url: e.target.value } : im,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Image alt text"
                        placeholder="Alt text"
                        value={img.alt}
                        className="h-10 text-sm"
                        onChange={(e) =>
                          patch({
                            images: form.images.map((im) =>
                              im.uid === img.uid ? { ...im, alt: e.target.value } : im,
                            ),
                          })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() =>
                        patch({ images: form.images.filter((im) => im.uid !== img.uid) })
                      }
                      className="grid size-10 shrink-0 place-items-center border border-line-strong text-ink-soft transition-colors hover:border-brick/50 hover:text-brick"
                    >
                      <TrashIcon width={16} height={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div
          className={cn(
            "flex flex-wrap items-center gap-3 border-t border-ink/15 pt-5",
          )}
        >
          <Button type="submit" size="lg" loading={save.isPending}>
            {isEdit ? "Save changes" : "Create product"}
          </Button>
          <Link to="/admin/products">
            <Button variant="ghost" size="lg">
              Cancel
            </Button>
          </Link>
          {isEdit && productQuery.data ? (
            <span className="ml-auto hidden text-[0.8125rem] text-ink-soft sm:block">
              From {money(productQuery.data.price)} ·{" "}
              <span className="num">{productQuery.data.available}</span> in stock
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
