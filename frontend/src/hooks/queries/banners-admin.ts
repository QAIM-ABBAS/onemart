import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { BannerAdminOut, BannerUpload, BannerWrite, Page } from "@/lib/types";

export interface AdminBannerQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  q?: string;
  placement?: string;
  status?: string;
}

export function useAdminBanners(params: AdminBannerQueryParams) {
  return useQuery({
    queryKey: ["admin", "banners", params],
    queryFn: () => api.get<Page<BannerAdminOut>>("/admin/banners", { ...params }),
    placeholderData: keepPreviousData,
  });
}

/** Every admin write drops the storefront payload cache too (the server
 * invalidates its Redis entries; this keeps the query layer in sync). */
function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ["admin", "banners"] });
  void qc.invalidateQueries({ queryKey: ["banners"] });
}

export function useSaveBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: BannerWrite }) =>
      id
        ? api.patch<BannerAdminOut>(`/admin/banners/${id}`, payload)
        : api.post<BannerAdminOut>("/admin/banners", payload),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/admin/banners/${id}`),
    onSuccess: () => invalidateAll(qc),
  });
}

/** Drag-to-reorder: ids arrive in their new display order. */
export function useReorderBanners() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api.patch<BannerAdminOut[]>("/admin/banners/reorder", { ids }),
    onSuccess: () => invalidateAll(qc),
  });
}

/** Uploads one creative; the server validates it and returns the resized
 * desktop + mobile WebP variants. */
export function useUploadBannerImage() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<BannerUpload>("/admin/banners/upload", form);
    },
  });
}
