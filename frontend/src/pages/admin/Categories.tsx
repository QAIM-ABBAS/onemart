import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  useAdminCategories,
  useDeleteCategory,
  useSaveCategory,
} from "@/hooks/queries/admin";
import { ApiError } from "@/lib/api";
import type { CategoryNode, CategoryWrite } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { PlusIcon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

type ModalState = { mode: "create"; parentId?: number } | { mode: "edit"; node: CategoryNode };

interface Row {
  node: CategoryNode;
  depth: number;
}

function flatten(nodes: CategoryNode[], depth = 0, out: Row[] = []): Row[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children?.length) flatten(node.children, depth + 1, out);
  }
  return out;
}

function collectIds(node: CategoryNode, out = new Set<number>()): Set<number> {
  out.add(node.id);
  for (const child of node.children ?? []) collectIds(child, out);
  return out;
}

interface FormState {
  name: string;
  parentId: string;
  position: string;
  isActive: boolean;
  imageUrl: string;
}

export function AdminCategoriesPage() {
  const categories = useAdminCategories();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryNode | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    parentId: "",
    position: "0",
    isActive: true,
    imageUrl: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useSaveCategory(modal?.mode === "edit" ? modal.node.id : undefined);
  const remove = useDeleteCategory();

  const rows = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  useEffect(() => {
    if (!modal) return;
    setErrors({});
    save.reset();
    if (modal.mode === "edit") {
      setForm({
        name: modal.node.name,
        parentId: modal.node.parent_id ? String(modal.node.parent_id) : "",
        position: "0",
        isActive: modal.node.is_active ?? true,
        imageUrl: modal.node.image_url ?? "",
      });
    } else {
      setForm({
        name: "",
        parentId: modal.parentId ? String(modal.parentId) : "",
        position: "0",
        isActive: true,
        imageUrl: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  const excludedIds = useMemo(() => {
    if (modal?.mode !== "edit") return new Set<number>();
    return collectIds(modal.node);
  }, [modal]);

  const parentOptions = rows.filter(({ node }) => !excludedIds.has(node.id));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Name must be at least 2 characters";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: CategoryWrite = {
      name: form.name.trim(),
      parent_id: form.parentId ? Number(form.parentId) : null,
      position: Number(form.position || 0),
      is_active: form.isActive,
      image_url: form.imageUrl.trim() || undefined,
    };

    try {
      await save.mutateAsync(payload);
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
    }
  }

  const deleteError = remove.error instanceof ApiError ? remove.error.message : null;
  const saveError =
    save.error instanceof ApiError && Object.keys(save.error.fieldErrors()).length === 0
      ? save.error.message
      : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-brand-600">Catalogue</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Categories</h1>
          <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
            {categories.data ? `${rows.length} categories` : "Loading…"}
          </p>
        </div>
        <Button onClick={() => setModal({ mode: "create" })}>+ New category</Button>
      </div>

      <div className="mt-5">
        {categories.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md bg-surface border border-line">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-8 w-28" />
              </div>
            ))}
          </div>
        ) : categories.isError ? (
          <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No categories yet"
            body="Categories organise your catalogue — create a root category first, then nest subcategories under it."
            action={<Button onClick={() => setModal({ mode: "create" })}>New category</Button>}
          />
        ) : (
          <div className="overflow-hidden rounded-md bg-surface border border-line">
            <div className="hidden bg-surface-2 px-4 py-2.5 sm:grid sm:grid-cols-[1fr_120px_110px_230px] sm:gap-4">
              <span className="label text-ink-muted">Category</span>
              <span className="label text-ink-muted">Products</span>
              <span className="label text-ink-muted">Status</span>
              <span className="label text-right text-ink-muted">Actions</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map(({ node, depth }) => (
                <li
                  key={node.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid sm:grid-cols-[1fr_120px_110px_230px]"
                >
                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 18 }}>
                    {depth > 0 ? (
                      <span aria-hidden="true" className="text-line">
                        └
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{node.name}</p>
                      <p className="num truncate text-[0.75rem] text-ink-muted">/{node.slug}</p>
                    </div>
                  </div>
                  <p className="num text-sm text-ink-muted">
                    {typeof node.product_count === "number" ? node.product_count : "—"}
                  </p>
                  <div>
                    <Badge tone={node.is_active === false ? "neutral" : "positive"}>
                      {node.is_active === false ? "Hidden" : "Active"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setModal({ mode: "create", parentId: node.id })}
                    >
                      <PlusIcon width={14} height={14} />
                      Child
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setModal({ mode: "edit", node })}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setDeleteTarget(node)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          modal?.mode === "edit"
            ? `Edit ${modal.node.name}`
            : modal?.mode === "create" && modal.parentId
              ? "New subcategory"
              : "New category"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button form="category-form" type="submit" loading={save.isPending}>
              {modal?.mode === "edit" ? "Save changes" : "Create category"}
            </Button>
          </>
        }
      >
        <form id="category-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          {saveError ? <InlineError>{saveError}</InlineError> : null}
          <Field label="Name" htmlFor="cat-name" error={errors.name}>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              invalid={Boolean(errors.name)}
              placeholder="e.g. Snacks"
              autoFocus
            />
          </Field>
          <Field
            label="Parent category"
            htmlFor="cat-parent"
            hint="Leave empty to keep it at the top level"
          >
            <Select
              id="cat-parent"
              value={form.parentId}
              onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
            >
              <option value="">Top level (no parent)</option>
              {parentOptions.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {depth > 0 ? `${"— ".repeat(depth)}` : ""}
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Position" htmlFor="cat-pos" hint="Sort order among siblings">
              <Input
                id="cat-pos"
                type="number"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              />
            </Field>
            <Field label="Image URL (optional)" htmlFor="cat-img">
              <Input
                id="cat-img"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="/api/img/…"
              />
            </Field>
          </div>
          <Checkbox
            label="Visible in the storefront"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete category"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                remove.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                });
              }}
            >
              Delete category
            </Button>
          </>
        }
      >
        {deleteError ? <InlineError className="mb-3">{deleteError}</InlineError> : null}
        {deleteTarget ? (
          <p className="text-sm">
            Delete <span className="font-medium">{deleteTarget.name}</span>? A category with
            subcategories or products must be emptied first.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
