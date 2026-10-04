import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { toast } from "@/stores/toast";
import { useAuth } from "@/stores/auth";

import {
  useDeleteReview,
  useReviews,
  useToggleHelpful,
} from "@/hooks/queries/reviews";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";

import { RatingSummary } from "./RatingSummary";
import { ReviewCard } from "./ReviewCard";
import { ReviewForm } from "./ReviewForm";

const PAGE_SIZE = 5;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "highest", label: "Highest rated" },
  { value: "lowest", label: "Lowest rated" },
  { value: "most_helpful", label: "Most helpful" },
] as const;

/**
 * The whole "Ratings & reviews" block of the product page: summary with
 * distribution bars, sort + rating filter, paginated list, and write/edit/
 * delete. Every state is handled — skeleton, error, empty, filtered-empty.
 */
export function ReviewSection({ slug }: { slug: string }) {
  const user = useAuth((s) => s.user);
  const booted = useAuth((s) => s.booted);

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string>("newest");
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reviews = useReviews(slug, { page, page_size: PAGE_SIZE, sort, rating });
  const remove = useDeleteReview(slug);
  const helpful = useToggleHelpful(slug);

  // New sort/filter → back to page 1 (and drop any open editor).
  useEffect(() => {
    setPage(1);
    setEditingId(null);
    setWriting(false);
  }, [slug, sort, rating]);

  const data = reviews.data;
  const ownReview = data?.items.find((r) => user != null && r.user_id === user.id) ?? null;
  const editingReview =
    editingId != null ? (data?.items.find((r) => r.id === editingId) ?? null) : null;

  function handleDelete(id: number) {
    if (!window.confirm("Delete this review? This cannot be undone.")) return;
    remove.mutate(id, {
      onSuccess: () => {
        toast("Review deleted.", { tone: "positive" });
        setEditingId(null);
      },
      onError: (err) => toast(err instanceof Error ? err.message : "Could not delete.", { tone: "negative" }),
    });
  }

  function handleHelpful(id: number) {
    if (!user) return;
    helpful.mutate(id, {
      onError: (err) => toast(err instanceof Error ? err.message : "Could not save.", { tone: "negative" }),
    });
  }

  return (
    <section id="reviews" className="mt-12 scroll-mt-24 border-t border-line pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl">Ratings & reviews</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="review-sort" className="label text-ink-muted">
            Sort
          </label>
          <Select
            id="review-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-10 w-44 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr] lg:gap-8">
        <aside>
          {data ? (
            <RatingSummary
              summary={data.summary}
              activeRating={rating}
              onToggleRating={(r) => setRating((cur) => (cur === r ? undefined : r))}
            />
          ) : reviews.isError ? null : (
            <div className="space-y-3 rounded-md border border-line bg-surface p-5">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {/* Who may write: staff/owner only, guests get the login prompt. */}
          {!booted ? null : !user ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-5 py-4">
              <p className="text-sm text-ink-muted">
                Sign in to write a review and mark reviews helpful.
              </p>
              <Link to={`/login?next=${encodeURIComponent(`/p/${slug}`)}`}>
                <Button variant="secondary" size="sm">
                  Sign in
                </Button>
              </Link>
            </div>
          ) : editingReview ? (
            <div className="mb-4">
              <ReviewForm
                slug={slug}
                existing={editingReview}
                onDone={() => setEditingId(null)}
              />
            </div>
          ) : writing ? (
            <div className="mb-4">
              <ReviewForm slug={slug} onDone={() => setWriting(false)} />
            </div>
          ) : !ownReview ? (
            <div className="mb-4">
              <Button size="sm" onClick={() => setWriting(true)}>
                Write a review
              </Button>
            </div>
          ) : null}

          {reviews.isPending ? (
            <ul className="space-y-4" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="rounded-md border border-line bg-surface p-5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-3 h-3.5 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-1.5 h-3 w-5/6" />
                </li>
              ))}
            </ul>
          ) : reviews.isError ? (
            <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
          ) : data && data.items.length > 0 ? (
            <>
              <ul className="space-y-4">
                {data.items.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    isOwn={user != null && review.user_id === user.id}
                    helpfulPending={helpful.isPending}
                    onHelpful={() => handleHelpful(review.id)}
                    onEdit={
                      user != null && review.user_id === user.id
                        ? () => setEditingId(review.id)
                        : undefined
                    }
                    onDelete={
                      user != null && review.user_id === user.id
                        ? () => handleDelete(review.id)
                        : undefined
                    }
                  />
                ))}
              </ul>
              <Pagination
                page={data.page}
                pages={data.pages}
                total={data.total}
                pageSize={data.page_size}
                onChange={setPage}
                className="mt-6"
              />
            </>
          ) : rating !== undefined ? (
            <EmptyState
              title={`No ${rating}★ reviews yet`}
              body="Try another star, or clear the filter to see every review."
              action={
                <Button variant="secondary" size="sm" onClick={() => setRating(undefined)}>
                  Clear filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No reviews yet"
              body="Reviews come from customers who bought this product. Yours would be the first."
              action={
                user ? (
                  <Button size="sm" onClick={() => setWriting(true)}>
                    Write a review
                  </Button>
                ) : (
                  <Link to={`/login?next=${encodeURIComponent(`/p/${slug}`)}`}>
                    <Button variant="secondary" size="sm">
                      Sign in to review
                    </Button>
                  </Link>
                )
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}
