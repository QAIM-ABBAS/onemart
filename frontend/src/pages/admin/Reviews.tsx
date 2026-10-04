import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAdminReviews, useDeleteAdminReview, useModerateReview } from "@/hooks/queries/admin";
import { formatDate } from "@/lib/format";
import { toast } from "@/stores/toast";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { Stars } from "@/components/reviews/Stars";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Rating: high to low" },
  { value: "lowest", label: "Rating: low to high" },
  { value: "most_helpful", label: "Most helpful" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All reviews" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

const RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  ...[5, 4, 3, 2, 1].map((r) => ({ value: String(r), label: `${r}★` })),
];

const PAGE_SIZE = 20;

export function AdminReviewsPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
    rating: sp.get("rating") ? Number(sp.get("rating")) : undefined,
    q: sp.get("q") ?? undefined,
  };

  const reviews = useAdminReviews(params);
  const moderate = useModerateReview();
  const remove = useDeleteAdminReview();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  function handleModerate(id: number, isVisible: boolean) {
    moderate.mutate(
      { id, is_visible: isVisible },
      {
        onSuccess: () =>
          toast(isVisible ? "Review is visible again." : "Review hidden.", {
            tone: "positive",
          }),
        onError: (err) =>
          toast(err instanceof Error ? err.message : "Could not update the review.", {
            tone: "negative",
          }),
      },
    );
  }

  function handleDelete(review: { id: number; product_slug: string; author: string }) {
    if (!window.confirm(`Delete ${review.author}'s review? This cannot be undone.`)) return;
    remove.mutate(review, {
      onSuccess: () => toast("Review deleted.", { tone: "positive" }),
      onError: (err) =>
        toast(err instanceof Error ? err.message : "Could not delete the review.", {
          tone: "negative",
        }),
    });
  }

  const hasFilters = Boolean(params.q || params.status || params.rating);

  return (
    <div>
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-brand-600">Catalogue</p>
        <h1 className="mt-1.5 text-2xl sm:text-3xl">Reviews</h1>
        <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
          {reviews.data ? `${reviews.data.total} reviews` : "Loading…"}
        </p>
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
            placeholder="Product, reviewer or title…"
            aria-label="Search reviews"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={params.rating ? String(params.rating) : ""}
          onChange={(e) => update({ rating: e.target.value || undefined })}
          aria-label="Filter by rating"
          className="h-9 min-w-32 text-sm"
        >
          {RATING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.status ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          aria-label="Filter by visibility"
          className="h-9 min-w-36 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort reviews"
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
        {reviews.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md bg-surface-2 shadow-pressed">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : reviews.isError ? (
          <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
        ) : reviews.data && reviews.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md bg-surface-2 shadow-pressed">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left shadow-pressed">
                    <th className="label px-4 py-2.5 text-ink-muted">Product</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Reviewer</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Rating</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Review</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Date</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reviews.data.items.map((review) => {
                    const busy = moderate.isPending || remove.isPending;
                    return (
                      <tr key={review.id} className="transition-colors hover:bg-surface">
                        <td className="px-4 py-3 font-medium">{review.product_name}</td>
                        <td className="px-4 py-3">
                          <span className="block">{review.author}</span>
                          {review.verified_purchase ? (
                            <span className="text-[0.75rem] text-success">Verified purchase</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Stars rating={review.rating} size={13} />
                        </td>
                        <td className="max-w-[340px] px-4 py-3 text-ink-muted">
                          <span className="block font-medium text-ink">{review.title}</span>
                          <span className="line-clamp-2">{review.body}</span>
                        </td>
                        <td className="num px-4 py-3 text-ink-muted">
                          {formatDate(review.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={review.is_visible ? "neutral" : "warning"}>
                            {review.is_visible ? "Visible" : "Hidden"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              loading={
                                moderate.isPending && moderate.variables?.id === review.id
                              }
                              onClick={() => handleModerate(review.id, !review.is_visible)}
                            >
                              {review.is_visible ? "Hide" : "Unhide"}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                handleDelete({
                                  id: review.id,
                                  product_slug: review.product_slug,
                                  author: review.author,
                                })
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              className="mt-5"
              page={reviews.data.page}
              pages={reviews.data.pages}
              total={reviews.data.total}
              pageSize={reviews.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No reviews match" : "No reviews yet"}
            body={
              hasFilters
                ? "Try a different filter or search term."
                : "Customer reviews of published products will appear here."
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
    </div>
  );
}
