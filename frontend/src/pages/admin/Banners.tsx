/* ═══════════════════════════════════════════════════════════════════════
   ADMIN — PROMOTIONAL BANNERS
   ═══════════════════════════════════════════════════════════════════════
   One table for all four placements (hero carousel, mid strip, category
   header, cart promo): search / placement / status / sort / pagination,
   create + edit with scheduling, and native HTML5 drag-to-reorder that
   writes priorities (available when a single placement page is sorted by
   priority — the server owns the real ordering anyway).

   CTR is live: impressions/clicks merge the Redis buffer server-side, so
   events show up within seconds of them happening, and flush to Postgres
   once a minute.
   ═══════════════════════════════════════════════════════════════════════ */

import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { toDateTimeLocal } from "@/components/admin/promo";
import {
  useAdminBanners,
  useDeleteBanner,
  useReorderBanners,
  useSaveBanner,
  useUploadBannerImage,
} from "@/hooks/queries/banners-admin";
import { useCategories } from "@/hooks/queries/catalog";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type {
  BannerAdminOut,
  BannerLinkType,
  BannerPlacement,
  BannerStatus,
  BannerTone,
  BannerWrite,
  CategoryNode,
} from "@/lib/types";
import { toast } from "@/stores/toast";

import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const PAGE_SIZE = 20;

const PLACEMENTS: { value: BannerPlacement; label: string }[] = [
  { value: "home_hero", label: "Home hero (carousel, max 5)" },
  { value: "home_mid_strip", label: "Home mid strip" },
  { value: "category_header", label: "Category header" },
  { value: "cart_promo", label: "Cart promo" },
];

const SORTS = [
  { value: "priority", label: "Priority order" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "ctr", label: "CTR high to low" },
];

const STATUS_TONE: Record<BannerStatus, Tone> = {
  active: "positive",
  scheduled: "info",
  expired: "neutral",
  inactive: "warning",
};

const STATUS_LABEL: Record<BannerStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

const PLACEMENT_LABEL: Record<BannerPlacement, string> = {
  home_hero: "Home hero",
  home_mid_strip: "Home mid strip",
  category_header: "Category header",
  cart_promo: "Cart promo",
};

const LINK_HINT: Record<BannerLinkType, string> = {
  product: "Product slug (e.g. surf-xl-1kg) or numeric id",
  category: "Category slug (e.g. fresh-produce)",
  coupon: "Coupon code (e.g. FREESHIP)",
  url: "Site path starting with /, or a full http(s):// URL",
};

const LINK_PLACEHOLDER: Record<BannerLinkType, string> = {
  product: "surf-xl-1kg",
  category: "fresh-produce",
  coupon: "FREESHIP",
  url: "/products?sort=newest",
};

function StatusBadge({ status }: { status: BannerStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

function windowText(banner: BannerAdminOut): string {
  const from = banner.starts_at ? formatDateTime(banner.starts_at) : "immediately";
  const until = banner.ends_at ? formatDateTime(banner.ends_at) : "no end";
  return `${from} → ${until}`;
}

/** 0.5 → "0.5%", 100 → "100%" — no pointless trailing zeros. */
function ctrText(ctr: number): string {
  return `${Number(ctr.toFixed(2))}%`;
}

/* ═══ FORM MODEL ══════════════════════════════════════════════════════ */
interface BannerForm {
  title: string;
  eyebrow: string;
  subtitle: string;
  cta_label: string;
  alt: string;
  tone: BannerTone;
  placement: BannerPlacement;
  category_id: string;
  link_type: BannerLinkType;
  link_target: string;
  image_desktop: string;
  image_mobile: string;
  starts_at: string;
  ends_at: string;
  priority: string;
  is_active: boolean;
}

const EMPTY_FORM: BannerForm = {
  title: "",
  eyebrow: "",
  subtitle: "",
  cta_label: "",
  alt: "",
  tone: "light",
  placement: "home_mid_strip",
  category_id: "",
  link_type: "url",
  link_target: "/products",
  image_desktop: "",
  image_mobile: "",
  starts_at: "",
  ends_at: "",
  priority: "10",
  is_active: true,
};

function formFrom(banner: BannerAdminOut): BannerForm {
  return {
    title: banner.title,
    eyebrow: banner.eyebrow ?? "",
    subtitle: banner.subtitle ?? "",
    cta_label: banner.cta_label ?? "",
    alt: banner.alt ?? "",
    tone: banner.tone,
    placement: banner.placement,
    category_id: banner.category_id ? String(banner.category_id) : "",
    link_type: banner.link_type,
    link_target: banner.link_target,
    image_desktop: banner.image_desktop,
    image_mobile: banner.image_mobile ?? "",
    starts_at: toDateTimeLocal(banner.starts_at),
    ends_at: toDateTimeLocal(banner.ends_at),
    priority: String(banner.priority),
    is_active: banner.is_active,
  };
}

function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): { id: number; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${" ".repeat(depth * 3)}${node.name}` },
    ...flattenCategories(node.children ?? [], depth + 1),
  ]);
}

/* ═══ PAGE ═══════════════════════════════════════════════════════════ */
export function AdminBannersPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; banner: BannerAdminOut } | null
  >(null);
  const [form, setForm] = useState<BannerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "priority",
    q: sp.get("q") ?? undefined,
    placement: sp.get("placement") ?? undefined,
    status: sp.get("status") ?? undefined,
  };

  const banners = useAdminBanners(params);
  const save = useSaveBanner();
  const remove = useDeleteBanner();
  const reorder = useReorderBanners();
  const upload = useUploadBannerImage();
  const categories = useCategories();

  const bannerList = banners.data?.items ?? [];
  const pages = banners.data?.pages ?? 1;
  const categoryOptions = flattenCategories(categories.data ?? []);

  // Drag-to-reorder only makes sense for ONE placement, in priority order,
  // on a single page — anything else would renumber across mixed lists.
  const reorderEnabled =
    params.sort === "priority" && Boolean(params.placement) && pages === 1;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function open(
    next: { mode: "create" } | { mode: "edit"; banner: BannerAdminOut },
    values: BannerForm,
  ) {
    save.reset();
    upload.reset();
    setErrors({});
    setForm(values);
    setModal(next);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = "Give the banner a title";
    if (!form.image_desktop.trim()) next.image_desktop = "Upload an image or paste a URL";
    if (!form.link_target.trim()) next.link_target = "Where should the CTA go?";
    if (form.link_type === "url" && form.link_target.trim()) {
      const target = form.link_target.trim();
      if (!target.startsWith("/") && !target.startsWith("http"))
        next.link_target = "Start with / (site path) or http(s)://";
    }
    if (form.placement === "category_header" && !form.category_id)
      next.category_id = "Pick the category this header shows on";
    if (form.starts_at && form.ends_at) {
      const starts = new Date(form.starts_at).getTime();
      const ends = new Date(form.ends_at).getTime();
      if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends <= starts)
        next.ends_at = "End time must be after the start time";
    }
    const priority = Number(form.priority);
    if (!Number.isInteger(priority) || priority < 0)
      next.priority = "Enter a whole number (0+)";
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: BannerWrite = {
      title: form.title.trim(),
      eyebrow: form.eyebrow.trim() || null,
      subtitle: form.subtitle.trim() || null,
      cta_label: form.cta_label.trim() || null,
      alt: form.alt.trim() || null,
      tone: form.tone,
      placement: form.placement,
      category_id:
        form.placement === "category_header" && form.category_id
          ? Number(form.category_id)
          : null,
      link_type: form.link_type,
      link_target: form.link_target.trim(),
      image_desktop: form.image_desktop.trim(),
      image_mobile: form.image_mobile.trim() || null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      priority: Number(form.priority),
      is_active: form.is_active,
    };

    const editing = modal?.mode === "edit" ? modal.banner.id : undefined;
    try {
      await save.mutateAsync({ id: editing, payload });
      setModal(null);
      toast(editing ? "Banner updated." : "Banner created.", { tone: "positive" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  function handleDelete(banner: BannerAdminOut) {
    if (!window.confirm(`Delete "${banner.title}"? Its counters go with it.`)) return;
    remove.mutate(banner.id, {
      onSuccess: () => toast("Banner deleted.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the banner.", {
          tone: "negative",
        }),
    });
  }

  function handleFile(file: File) {
    upload.mutate(file, {
      onSuccess: (result) => {
        setForm((prev) => ({
          ...prev,
          image_desktop: result.image_desktop,
          image_mobile: result.image_mobile,
        }));
        toast("Image uploaded and resized (desktop + mobile).", { tone: "positive" });
      },
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Upload failed.", { tone: "negative" }),
    });
  }

  function handleDrop(targetId: number) {
    const source = dragId;
    setDragId(null);
    setOverId(null);
    if (source === null || source === targetId) return;
    const ids = bannerList.map((banner) => banner.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    reorder.mutate(ids, {
      onSuccess: () => toast("Priority order saved.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not reorder banners.", {
          tone: "negative",
        }),
    });
  }

  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;
  const busy = save.isPending || remove.isPending || reorder.isPending;

  return (
    <div>
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-brand-600">Marketing</p>
        <h1 className="mt-1.5 text-2xl sm:text-3xl">Banners</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Scheduled creatives per placement. The storefront shows only active,
          in-window banners, highest priority first — one hero carousel, one mid
          strip, one slot each on category pages and the cart.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <p className="num text-sm text-ink-muted" aria-live="polite">
          {banners.data ? `${banners.data.total} banners` : "Loading…"}
        </p>
        <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New banner</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <form
          className="flex min-w-56 flex-1 gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() || undefined });
          }}
        >
          <Input
            type="search"
            placeholder="Search title…"
            aria-label="Search banners"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={sp.get("placement") ?? ""}
          onChange={(e) => update({ placement: e.target.value || undefined })}
          aria-label="Filter by placement"
          className="h-9 min-w-44 text-sm"
        >
          <option value="">All placements</option>
          {PLACEMENTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={sp.get("status") ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-32 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort banners"
          className="h-9 min-w-44 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <p className="mt-2 text-[0.8125rem] text-ink-muted">
        {reorderEnabled
          ? "Drag rows to reorder — the new priority saves on drop."
          : "Tip: filter to one placement, keep priority order, and stay on one page to drag-reorder."}
      </p>

      <div className="mt-3">
        {banners.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-10 w-16" />
                <Skeleton className="h-5 w-44" />
                <Skeleton className="ml-auto h-5 w-28" />
              </div>
            ))}
          </div>
        ) : banners.isError ? (
          <ErrorState error={banners.error} onRetry={() => void banners.refetch()} />
        ) : bannerList.length === 0 ? (
          <EmptyState
            title="No banners yet"
            body="Create one for a placement to light it up on the storefront. Empty placements simply hide."
            action={
              <Button onClick={() => open({ mode: "create" }, EMPTY_FORM)}>+ New banner</Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left">
                  {reorderEnabled ? (
                    <th className="label w-8 px-2 py-2.5 text-ink-muted" aria-label="Drag handle" />
                  ) : null}
                  <th className="label px-4 py-2.5 text-ink-muted">Banner</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Placement</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Window</th>
                  <th className="label px-4 py-2.5 text-ink-muted">Priority</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">Impr.</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">Clicks</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">CTR</th>
                  <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bannerList.map((banner) => (
                  <tr
                    key={banner.id}
                    draggable={reorderEnabled}
                    onDragStart={() => setDragId(banner.id)}
                    onDragOver={(e) => {
                      if (dragId !== null) {
                        e.preventDefault();
                        setOverId(banner.id);
                      }
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(banner.id);
                    }}
                    className={cn(
                      "transition-colors",
                      dragId === banner.id && "opacity-50",
                      dragId !== null &&
                        dragId !== banner.id &&
                        overId === banner.id &&
                        "bg-brand-50",
                      reorderEnabled && "cursor-grab active:cursor-grabbing",
                    )}
                  >
                    {reorderEnabled ? (
                      <td className="px-2 py-3 text-ink-muted" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <circle cx="5" cy="3" r="1.4" />
                          <circle cx="9" cy="3" r="1.4" />
                          <circle cx="5" cy="7" r="1.4" />
                          <circle cx="9" cy="7" r="1.4" />
                          <circle cx="5" cy="11" r="1.4" />
                          <circle cx="9" cy="11" r="1.4" />
                        </svg>
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={banner.image_desktop}
                          alt=""
                          width={64}
                          height={40}
                          loading="lazy"
                          decoding="async"
                          className="h-10 w-16 rounded border border-line object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{banner.title}</p>
                          <p className="truncate text-[0.75rem] text-ink-muted">
                            {banner.category_name ? `${banner.category_name} · ` : ""}
                            {banner.link_target}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {PLACEMENT_LABEL[banner.placement]}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={banner.status} />
                    </td>
                    <td className="num px-4 py-3 text-ink-muted">{windowText(banner)}</td>
                    <td className="num px-4 py-3">{banner.priority}</td>
                    <td className="num px-4 py-3 text-right">{banner.impressions}</td>
                    <td className="num px-4 py-3 text-right">{banner.clicks}</td>
                    <td className="num px-4 py-3 text-right">{ctrText(banner.ctr)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            open({ mode: "edit", banner }, formFrom(banner))
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleDelete(banner)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={banners.data?.page ?? 1}
              pages={pages}
              total={banners.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              onChange={(page) => update({ page: String(page) })}
            />
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          modal?.mode === "edit" ? `Edit ${modal.banner.title}` : "New banner"
        }
        description="Only active, in-window banners show. Empty placements hide — the homepage never stacks more than one hero and one mid strip."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="banner-form" type="submit" loading={busy}>
              {modal?.mode === "edit" ? "Save banner" : "Create banner"}
            </Button>
          </>
        }
      >
        <form id="banner-form" onSubmit={handleSubmit} className="space-y-4">
          {saveError ? <InlineError>{saveError}</InlineError> : null}

          <Field label="Title" htmlFor="banner_title" error={errors.title}>
            <Input
              id="banner_title"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              invalid={Boolean(errors.title)}
              placeholder="Fresh picks for the week"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow" htmlFor="banner_eyebrow" hint="Optional small label">
              <Input
                id="banner_eyebrow"
                value={form.eyebrow}
                onChange={(e) => setForm((prev) => ({ ...prev, eyebrow: e.target.value }))}
                placeholder="This week only"
              />
            </Field>
            <Field label="CTA label" htmlFor="banner_cta" hint="Blank = Shop now">
              <Input
                id="banner_cta"
                value={form.cta_label}
                onChange={(e) => setForm((prev) => ({ ...prev, cta_label: e.target.value }))}
                placeholder="Shop now"
              />
            </Field>
          </div>

          <Field label="Subtitle" htmlFor="banner_subtitle" hint="Optional line under the title">
            <Input
              id="banner_subtitle"
              value={form.subtitle}
              onChange={(e) => setForm((prev) => ({ ...prev, subtitle: e.target.value }))}
              placeholder="Fruit, vegetables and daily essentials."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Placement" htmlFor="banner_placement">
              <Select
                id="banner_placement"
                value={form.placement}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    placement: e.target.value as BannerPlacement,
                  }))
                }
              >
                {PLACEMENTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Card tone" htmlFor="banner_tone" hint="Contrast of the card behind the art">
              <Select
                id="banner_tone"
                value={form.tone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, tone: e.target.value as BannerTone }))
                }
              >
                <option value="light">Light (green tint)</option>
                <option value="brand">Brand (deep green)</option>
              </Select>
            </Field>
          </div>

          {form.placement === "category_header" ? (
            <Field
              label="Category"
              htmlFor="banner_category"
              error={errors.category_id}
              hint="The header shows only on this category's page"
            >
              <Select
                id="banner_category"
                value={form.category_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, category_id: e.target.value }))
                }
                invalid={Boolean(errors.category_id)}
              >
                <option value="">
                  {categories.isLoading ? "Loading categories…" : "Pick a category"}
                </option>
                {categoryOptions.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Links to" htmlFor="banner_link_type">
              <Select
                id="banner_link_type"
                value={form.link_type}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    link_type: e.target.value as BannerLinkType,
                  }))
                }
              >
                <option value="url">URL (site path)</option>
                <option value="product">Product</option>
                <option value="category">Category</option>
                <option value="coupon">Coupon</option>
              </Select>
            </Field>
            <Field
              label="Target"
              htmlFor="banner_link_target"
              error={errors.link_target}
              hint={LINK_HINT[form.link_type]}
            >
              <Input
                id="banner_link_target"
                value={form.link_target}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, link_target: e.target.value }))
                }
                invalid={Boolean(errors.link_target)}
                placeholder={LINK_PLACEHOLDER[form.link_type]}
              />
            </Field>
          </div>

          <Field
            label="Desktop image"
            htmlFor="banner_image"
            error={errors.image_desktop}
            hint="JPEG, PNG or WebP up to 5 MB — resized to 1600w WebP"
          >
            <div className="flex gap-2">
              <Input
                id="banner_image"
                value={form.image_desktop}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, image_desktop: e.target.value }))
                }
                invalid={Boolean(errors.image_desktop)}
                placeholder="/api/img/placeholder.svg?text=Fresh"
                className="flex-1"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                loading={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Upload
              </Button>
            </div>
          </Field>
          {form.image_desktop ? (
            <img
              src={form.image_desktop}
              alt=""
              className="h-24 w-full max-w-xs rounded border border-line object-cover"
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Mobile image"
              htmlFor="banner_image_mobile"
              hint="Optional — auto-filled by upload (750w)"
            >
              <Input
                id="banner_image_mobile"
                value={form.image_mobile}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, image_mobile: e.target.value }))
                }
                placeholder="(defaults to desktop)"
              />
            </Field>
            <Field label="Alt text" htmlFor="banner_alt" hint="For screen readers; blank = title">
              <Input
                id="banner_alt"
                value={form.alt}
                onChange={(e) => setForm((prev) => ({ ...prev, alt: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="banner_starts" hint="Blank = immediately">
              <Input
                id="banner_starts"
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, starts_at: e.target.value }))
                }
              />
            </Field>
            <Field
              label="Ends"
              htmlFor="banner_ends"
              error={errors.ends_at}
              hint="Blank = no end"
            >
              <Input
                id="banner_ends"
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value }))}
                invalid={Boolean(errors.ends_at)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Priority"
              htmlFor="banner_priority"
              error={errors.priority}
              hint="Lower shows first (drag rows in the table to set)"
            >
              <Input
                id="banner_priority"
                type="number"
                min={0}
                value={form.priority}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, priority: e.target.value }))
                }
                invalid={Boolean(errors.priority)}
              />
            </Field>
          </div>

          <Checkbox
            label="Active (pause a banner without deleting it)"
            checked={form.is_active}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
        </form>
      </Modal>
    </div>
  );
}
