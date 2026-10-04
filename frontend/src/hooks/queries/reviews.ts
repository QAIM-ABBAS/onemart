import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { HelpfulOut, ReviewIn, ReviewOut, ReviewPage } from "@/lib/types";

export interface ReviewListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  rating?: number;
}

export function useReviews(slug: string | undefined, params: ReviewListParams) {
  return useQuery({
    queryKey: ["reviews", slug ?? "", params],
    queryFn: () => api.get<ReviewPage>(`/products/${slug}/reviews`, { ...params }),
    enabled: Boolean(slug),
    placeholderData: keepPreviousData,
  });
}

// Any review write changes both the list and the product's rating summary, so
// every mutation invalidates both keys (the PDP reads the second one).
function reviewInvalidations(qc: ReturnType<typeof useQueryClient>, slug: string) {
  void qc.invalidateQueries({ queryKey: ["reviews", slug] });
  void qc.invalidateQueries({ queryKey: ["product", slug] });
}

export function useCreateReview(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReviewIn) => api.post<ReviewOut>(`/products/${slug}/reviews`, payload),
    onSuccess: () => reviewInvalidations(qc, slug),
  });
}

export function useUpdateReview(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ReviewIn }) =>
      api.patch<ReviewOut>(`/reviews/${id}`, payload),
    onSuccess: () => reviewInvalidations(qc, slug),
  });
}

export function useDeleteReview(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/reviews/${id}`),
    onSuccess: () => reviewInvalidations(qc, slug),
  });
}

export function useToggleHelpful(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<HelpfulOut>(`/reviews/${id}/helpful`),
    // The list is re-read rather than patched: the active sort may be
    // "most helpful", so the row can move as well as change its count.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reviews", slug] }),
  });
}
