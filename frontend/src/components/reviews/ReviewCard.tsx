import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, pluralize } from "@/lib/format";
import type { ReviewOut } from "@/lib/types";

import { Stars } from "./Stars";

export function ReviewCard({
  review,
  isOwn,
  helpfulPending,
  onHelpful,
  onEdit,
  onDelete,
}: {
  review: ReviewOut;
  isOwn: boolean;
  helpfulPending: boolean;
  onHelpful: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="rounded-md border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{review.author}</p>
            {review.verified_purchase ? <Badge tone="positive">Verified purchase</Badge> : null}
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <Stars rating={review.rating} size={13} />
            <span className="text-[0.8125rem] text-ink-muted">{formatDate(review.created_at)}</span>
          </div>
        </div>
        {isOwn ? (
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="danger" size="sm" onClick={onDelete}>
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <h3 className="mt-3 text-base">{review.title}</h3>
      <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">{review.body}</p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onHelpful}
          disabled={helpfulPending}
          aria-pressed={review.viewer_has_voted}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[0.8125rem] font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          Helpful
          <span className="num">{review.helpful_count}</span>
        </button>
        {review.viewer_has_voted ? (
          <span className="text-[0.8125rem] text-brand-600">
            Marked helpful by you
          </span>
        ) : null}
        <span className="ms-auto text-[0.8125rem] text-ink-faint">
          {pluralize(review.helpful_count, "person", "people")} found this helpful
        </span>
      </div>
    </li>
  );
}
