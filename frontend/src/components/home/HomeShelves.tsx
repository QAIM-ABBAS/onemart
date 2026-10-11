import { useTranslation } from "react-i18next";
import { useCategories } from "@/hooks/queries/catalog";

import { ProductShelf, shelfTabsFromCategories } from "./ProductShelf";

export function HomeShelves() {
  const { t } = useTranslation("home");
  const categories = useCategories();
  const tabs = [{ label: t("shelves.all") }, ...shelfTabsFromCategories(categories.data, 4)];

  return (
    <>
      <ProductShelf
        title={t("shelves.best")}
        href="/products?sort=bestselling"
        sort="bestselling"
        tabs={tabs}
        strip
      />
      <ProductShelf
        title={t("shelves.new")}
        href="/products?sort=newest"
        sort="newest"
        tabs={tabs}
      />
    </>
  );
}
