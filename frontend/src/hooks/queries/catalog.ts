import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  BrandOut,
  CategoryNode,
  HomeData,
  Page,
  ProductDetail,
  ProductFacets,
  ProductListItem,
} from "@/lib/types";

export interface ProductQueryParams {
  page?: number;
  page_size?: number;
  sort?: string;
  category?: string;
  brand?: string;
  q?: string;
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  featured?: boolean;
}

export function useHome() {
  return useQuery({
    queryKey: ["home"],
    queryFn: () => api.get<HomeData>("/home"),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategoryNode[]>("/categories"),
    staleTime: 5 * 60_000,
  });
}

export function useBrands() {
  return useQuery({
    queryKey: ["brands"],
    queryFn: () => api.get<BrandOut[]>("/brands"),
    staleTime: 5 * 60_000,
  });
}

export function useProducts(params: ProductQueryParams) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => api.get<Page<ProductListItem>>("/products", { ...params }),
    placeholderData: (prev) => prev,
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.get<ProductDetail>(`/products/${slug}`),
    enabled: Boolean(slug),
  });
}

export function useFacets(params: ProductQueryParams) {
  return useQuery({
    queryKey: ["facets", params],
    queryFn: () =>
      api.get<ProductFacets>("/products/facets", {
        category: params.category,
        brand: params.brand,
        q: params.q,
        min_price: params.min_price,
        max_price: params.max_price,
        in_stock: params.in_stock,
        featured: params.featured,
      }),
    staleTime: 60_000,
  });
}
