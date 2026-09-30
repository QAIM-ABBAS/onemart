import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  CategoryNode,
  CategoryWrite,
  InventoryRow,
  OrderDetail,
  OrderListItem,
  Page,
  ProductAdminOut,
  ProductWrite,
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

export function useAdminOrder(orderId: number | string | undefined) {
  return useQuery({
    queryKey: ["admin", "order", orderId],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${orderId}`),
    enabled: orderId !== undefined && orderId !== "",
  });
}

export function useUpdateOrderStatus(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StatusUpdateIn) =>
      api.patch<OrderDetail>(`/admin/orders/${orderId}/status`, payload),
    onSuccess: (order) => {
      qc.setQueryData(["admin", "order", orderId], order);
      void qc.invalidateQueries({ queryKey: ["admin", "orders"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });
}
