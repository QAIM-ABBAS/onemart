import { useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api";
import { toast } from "@/stores/toast";
import type { ReviewIn, ReviewOut } from "@/lib/types";

import { useCreateReview, useUpdateReview } from "@/hooks/queries/reviews";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Form";
import { InlineError } from "@/components/ui/States";

import { StarPicker } from "./Stars";

/** Write or edit a review. Field errors come back from the API and land inline. */
export function ReviewForm({
  slug,
  existing,
  onDone,
}: {
  slug: string;
  existing?: ReviewOut | null;
  onDone: () => void;
}) {
  const create = useCreateReview(slug);
  const update = useUpdateReview(slug);
  const mutation = existing ? update : create;

  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const payload: ReviewIn = { rating, title: title.trim(), body: body.trim() };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    try {
      if (existing) {
        await update.mutateAsync({ id: existing.id, payload });
        toast("Review updated.", { tone: "positive" });
      } else {
        await create.mutateAsync(payload);
        toast("Thanks — your review is live.", { tone: "positive" });
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fieldErrors();
        if (Object.keys(fieldErrors).length > 0) setFields(fieldErrors);
        setError(err.message);
      } else {
        setError("Could not save your review. Please try again.");
      }
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-line bg-surface p-5"
      noValidate
    >
      <h3 className="text-base">{existing ? "Edit your review" : "Write a review"}</h3>

      <div className="mt-4">
        <p className="label text-ink-muted">Your rating</p>
        <div className="mt-1.5">
          <StarPicker value={rating} onChange={setRating} />
        </div>
        {fields.rating ? <p className="mt-1 text-[0.8125rem] text-danger">{fields.rating}</p> : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="review-title" error={fields.title ?? null}>
          <Input
            id="review-title"
            value={title}
            maxLength={120}
            required
            invalid={Boolean(fields.title)}
            placeholder="Sums it up in a line"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Your review"
        htmlFor="review-body"
        error={fields.body ?? null}
        hint={`${body.trim().length}/10 characters minimum`}
        className="mt-4"
      >
        <Textarea
          id="review-body"
          value={body}
          maxLength={4000}
          required
          invalid={Boolean(fields.body)}
          rows={4}
          placeholder="What did you like or dislike? How was the quality, delivery, value?"
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>

      {error ? <InlineError className="mt-4">{error}</InlineError> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={mutation.isPending}>
          {existing ? "Save changes" : "Post review"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
