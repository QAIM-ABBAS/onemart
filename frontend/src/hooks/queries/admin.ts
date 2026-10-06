import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  CategoryNode,
  CategoryWrite,
  CouponAdminOut,
  CouponWrite,
  DiscountAdminOut,
  DiscountWrite,
  InventoryRow,
  OrderDetail,
  OrderListItem,
  Page,
  ProductAdminOut,
  ProductWrite,
  ReviewOut,
  StatusUpdateIn,
  StockAdjustment,
} from "@/lib/types";

export interface AdminProductQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  q?: string;
  category?: string;
  brand?: string;
  active?: boolean;
}

export function useAdminProducts(params: AdminProductQueryParams) {
  return useQuery({
    queryKey: ["admin", "products", params],
    queryFn: () => api.get<Page<ProductAdminOut>>("/admin/products", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminProduct(productId: number | string | undefined) {
  return useQuery({
    queryKey: ["admin", "product", productId],
    queryFn: () => api.get<ProductAdminOut>(`/admin/products/${productId}`),
    enabled: productId !== undefined && productId !== "",
  });
}

export function useSaveProduct(productId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProductWrite) =>
      productId
        ? api.patch<ProductAdminOut>(`/admin/products/${productId}`, payload)
        : api.post<ProductAdminOut>("/admin/products", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "products"] });
      qc.removeQueries({ queryKey: ["admin", "product"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: number) => api.del<void>(`/admin/products/${productId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useAdminCategories() {
  return useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => api.get<CategoryNode[]>("/admin/categories"),
    staleTime: 60_000,
  });
}

export function useAdminCategoryFlat() {
  return useQuery({
    queryKey: ["admin", "categories", "flat"],
    queryFn: () => api.get<CategoryNode[]>("/admin/categories/flat"),
    staleTime: 60_000,
  });
}

export function useSaveCategory(categoryId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategoryWrite) =>
      categoryId
        ? api.patch<CategoryNode>(`/admin/categories/${categoryId}`, payload)
        : api.post<CategoryNode>("/admin/categories", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "categories"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) => api.del<void>(`/admin/categories/${categoryId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "categories"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export interface InventoryQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  q?: string;
  low_stock?: boolean;
  out_of_stock?: boolean;
}

export function useInventory(params: InventoryQueryParams) {
  return useQuery({
    queryKey: ["admin", "inventory", params],
    queryFn: () => api.get<Page<InventoryRow>>("/admin/inventory", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StockAdjustment) =>
      api.post<InventoryRow>("/admin/inventory/adjust", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "inventory"] });
      void qc.invalidateQueries({ queryKey: ["admin", "products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product"] });
    },
  });
}

export interface AdminOrderQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  status?: string;
  q?: string;
}

export function useAdminOrders(params: AdminOrderQueryParams) {
  return useQuery({
    queryKey: ["admin", "orders", params],
    queryFn: () => api.get<Page<OrderListItem>>("/admin/orders", { ...params }),
    placeholderData: keepPreviousData,
  });
}

// Route params arrive as strings and callers as numbers — normalise both, or the
// cache write lands under a key the query never reads ("8" !== 8) and an update
// looks like it silently didn't happen.
const orderKey = (orderId: number | string | undefined) => [
  "order",
  orderId == null ? "" : String(orderId),
];

export function useAdminOrder(orderId: number | string | undefined) {
  return useQuery({
    queryKey: ["admin", ...orderKey(orderId)],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${orderId}`),
    enabled: orderId !== undefined && orderId !== "",
  });
}

export function useUpdateOrderStatus(orderId: number | string) {
  const qc = useQueryClient();
  const id = String(orderId);
  return useMutation({
    mutationFn: (payload: StatusUpdateIn) =>
      api.patch<OrderDetail>(`/admin/orders/${id}/status`, payload),
    onSuccess: (order) => {
      qc.setQueryData(["admin", ...orderKey(id)], order);
      void qc.invalidateQueries({ queryKey: ["admin", "orders"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: orderKey(id) });
    },
  });
}

export interface AdminReviewQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  rating?: number;
  status?: string;
  product_id?: number;
  q?: string;
}

export function useAdminReviews(params: AdminReviewQueryParams) {
  return useQuery({
    queryKey: ["admin", "reviews", params],
    queryFn: () => api.get<Page<ReviewOut>>("/admin/reviews", { ...params }),
    placeholderData: keepPreviousData,
  });
}

// Moderation changes the public list and the product's rating summary too.
function reviewSideEffects(
  qc: ReturnType<typeof useQueryClient>,
  productSlug: string,
): void {
  void qc.invalidateQueries({ queryKey: ["admin", "reviews"] });
  void qc.invalidateQueries({ queryKey: ["reviews", productSlug] });
  void qc.invalidateQueries({ queryKey: ["product", productSlug] });
}

export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_visible }: { id: number; is_visible: boolean }) =>
      api.patch<ReviewOut>(`/admin/reviews/${id}`, { is_visible }),
    onSuccess: (review) => reviewSideEffects(qc, review.product_slug),
  });
}

export function useDeleteAdminReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (review: { id: number; product_slug: string }) =>
      api.del<void>(`/admin/reviews/${review.id}`),
    onSuccess: (_data, review) => reviewSideEffects(qc, review.product_slug),
  });
}

// --------------------------------------------------------------------------- //
// Promotions: coupons + automatic discounts
// --------------------------------------------------------------------------- //

export interface AdminCouponQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  status?: string;
  q?: string;
}

export function useAdminCoupons(params: AdminCouponQueryParams) {
  return useQuery({
    queryKey: ["admin", "coupons", params],
    queryFn: () => api.get<Page<CouponAdminOut>>("/admin/coupons", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: CouponWrite }) =>
      id
        ? api.patch<CouponAdminOut>(`/admin/coupons/${id}`, payload)
        : api.post<CouponAdminOut>("/admin/coupons", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
      // cart/checkout totals are recomputed server-side from these rules
      void qc.invalidateQueries({ queryKey: ["cart"] });
      void qc.invalidateQueries({ queryKey: ["checkout-summary"] });
    },
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (couponId: number) => api.del<void>(`/admin/coupons/${couponId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
      void qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
}

export interface AdminDiscountQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  scope?: string;
  status?: string;
  q?: string;
}

export function useAdminDiscounts(params: AdminDiscountQueryParams) {
  return useQuery({
    queryKey: ["admin", "discounts", params],
    queryFn: () => api.get<Page<DiscountAdminOut>>("/admin/discounts", { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: DiscountWrite }) =>
      id
        ? api.patch<DiscountAdminOut>(`/admin/discounts/${id}`, payload)
        : api.post<DiscountAdminOut>("/admin/discounts", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "discounts"] });
      void qc.invalidateQueries({ queryKey: ["cart"] });
      void qc.invalidateQueries({ queryKey: ["checkout-summary"] });
    },
  });
}

export function useDeleteDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (discountId: number) => api.del<void>(`/admin/discounts/${discountId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "discounts"] });
      void qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
}
