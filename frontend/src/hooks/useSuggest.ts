import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CategoryNode, Page, ProductListItem } from "@/lib/types";

export interface Suggestion {
  products: ProductListItem[];
  categories: CategoryNode[];
}

function matchCategory(nodes: CategoryNode[], needle: string): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const node of list) {
      if (node.name.toLowerCase().includes(needle)) out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function useSuggest(term: string) {
  const needle = term.trim().toLowerCase();
  const enabled = needle.length >= 2;

  const products = useQuery({
    queryKey: ["suggest", "products", needle],
    queryFn: () =>
      api.get<Page<ProductListItem>>("/products", { q: needle, page_size: 6, in_stock: true }),
    enabled,
    staleTime: 30_000,
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategoryNode[]>("/categories"),
    staleTime: 5 * 60_000,
  });

  return {
    enabled,
    loading: products.isLoading,
    products: (products.data?.items ?? []).slice(0, 5),
    categories: enabled ? matchCategory(categories.data ?? [], needle).slice(0, 4) : [],
    error: products.isError,
  };
}
