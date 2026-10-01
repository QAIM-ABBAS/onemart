import { useCategories } from "@/hooks/queries/catalog";

import { ProductShelf, shelfTabsFromCategories } from "./ProductShelf";

export function HomeShelves() {
  const categories = useCategories();
  const tabs = [{ label: "All" }, ...shelfTabsFromCategories(categories.data, 4)];

  return (
    <>
      <ProductShelf
        title="Best seller"
        href="/products?sort=bestselling"
        sort="bestselling"
        tabs={tabs}
        strip
      />
      <ProductShelf
        title="Just landing"
        href="/products?sort=newest"
        sort="newest"
        tabs={tabs}
      />
    </>
  );
}
