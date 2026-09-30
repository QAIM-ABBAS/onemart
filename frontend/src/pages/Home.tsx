import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useCategories, useHome } from "@/hooks/queries/catalog";
import { cn } from "@/lib/cn";
import type { ProductListItem } from "@/lib/types";

import {
  ProductGrid,
  ProductGridSkeleton,
  SectionHeading,
} from "@/components/catalog/ProductCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ArrowRightIcon, SearchIcon } from "@/components/ui/Icon";
import { ErrorState, Skeleton } from "@/components/ui/States";

function HeroSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    navigate(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
  }
  return (
    <form onSubmit={onSubmit} role="search" className="mt-8 flex max-w-xl">
      <div className="relative flex-1">
        <SearchIcon
          width={17}
          height={17}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none"
        />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search atta, dal, soap, biscuits…"
          aria-label="Search products"
          className="h-12 w-full rounded-l-sm border border-line-strong bg-paper pl-10 pr-3 text-sm text-ink placeholder:text-ink-soft/70 focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf/40"
        />
      </div>
      <button
        type="submit"
        className="h-12 rounded-r-sm border border-forest bg-forest px-5 text-sm font-medium text-paper transition-colors hover:border-ink hover:bg-ink"
      >
        Search
      </button>
    </form>
  );
}

function CategoryTile({ name, slug, count }: { name: string; slug: string; count?: number }) {
  return (
    <Link
      to={`/products?category=${slug}`}
      className="group flex h-full flex-col justify-between border border-line bg-surface p-4 transition-colors hover:border-forest/60 hover:bg-mist/50 sm:p-5"
    >
      <span className="font-display text-lg leading-snug font-semibold sm:text-xl">{name}</span>
      <span className="label mt-6 flex items-center justify-between text-ink-soft">
        {typeof count === "number" ? <span className="num">{count} items</span> : <span />}
        <ArrowRightIcon
          width={15}
          height={15}
          className="transition-transform group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}

function ProductSection({
  eyebrow,
  title,
  items,
  href,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  items: ProductListItem[];
  href: string;
  linkLabel?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-14">
      <SectionHeading eyebrow={eyebrow} title={title} href={href} linkLabel={linkLabel} />
      <ProductGrid className="mt-6 border-t-0">
        {items.map((item) => (
          <ProductCard key={item.id} item={item} />
        ))}
      </ProductGrid>
    </section>
  );
}

const PROMISES = [
  { title: "Cash on delivery", body: "Pay when your order arrives at your door — no cards, no wallets." },
  { title: "Free delivery over ₹999", body: "A flat ₹40 delivery fee below that, shown upfront at checkout." },
  { title: "Status you can follow", body: "Every order carries a timeline — packed, shipped, delivered." },
] as const;

export function HomePage() {
  const home = useHome();
  const categories = useCategories();

  if (home.isLoading) {
    return (
      <>
        <section className="bg-forest text-paper">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 lg:grid-cols-[1.4fr_1fr] lg:gap-16 lg:py-20">
            <div>
              <Skeleton className="h-4 w-56 bg-paper/15" />
              <Skeleton className="mt-5 h-14 w-full max-w-lg bg-paper/15" />
              <Skeleton className="mt-3 h-14 w-full max-w-md bg-paper/15" />
              <Skeleton className="mt-6 h-12 w-full max-w-xl bg-paper/15" />
            </div>
            <div className="lg:border-l lg:border-paper/20 lg:pl-12">
              <Skeleton className="h-4 w-40 bg-paper/15" />
              <div className="mt-5 space-y-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full bg-paper/15" />
                ))}
              </div>
            </div>
          </div>
        </section>
        <div className="mx-auto max-w-7xl px-4 py-12">
          <Skeleton className="h-7 w-64" />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <div className="mt-12">
            <Skeleton className="h-7 w-48" />
            <ProductGridSkeleton className="mt-6" />
          </div>
        </div>
      </>
    );
  }

  if (home.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      </div>
    );
  }

  const data = home.data!;
  const cats = categories.data ?? data.categories;

  return (
    <>
      <section className="bg-forest text-paper">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 lg:grid-cols-[1.4fr_1fr] lg:gap-16 lg:py-20">
          <div>
            <p className="label text-paper/55">Your neighbourhood hypermarket, online</p>
            <h1 className="mt-4 text-4xl text-paper sm:text-5xl lg:text-[3.5rem]">
              Everything you need,
              <br /> in one place.
            </h1>
            <p className="mt-5 max-w-lg text-[0.975rem] leading-relaxed text-paper/70">
              Groceries, home care, personal care and daily essentials from the brands you
              already buy — delivered with cash on delivery.
            </p>
            <HeroSearch />
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem] text-paper/60">
              <span>Free delivery over ₹999</span>
              <span aria-hidden="true">·</span>
              <span>Cash on delivery</span>
              <span aria-hidden="true">·</span>
              <span>Live order timeline</span>
            </div>
          </div>
          <div className="lg:border-l lg:border-paper/20 lg:pl-12">
            <p className="label text-paper/55">Shop by category</p>
            <ul className="mt-4 divide-y divide-paper/15 border-y border-paper/15">
              {cats.slice(0, 6).map((cat) => (
                <li key={cat.id}>
                  <Link
                    to={`/products?category=${cat.slug}`}
                    className="group flex items-center justify-between py-3.5"
                  >
                    <span className="font-display text-lg font-medium transition-colors group-hover:text-paper/75">
                      {cat.name}
                    </span>
                    <span className="num flex items-center gap-2 text-sm text-paper/50">
                      {typeof cat.product_count === "number" ? `${cat.product_count}` : ""}
                      <ArrowRightIcon
                        width={15}
                        height={15}
                        className="transition-transform group-hover:translate-x-1"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              to="/products"
              className="label mt-6 inline-flex items-center gap-2 border-b border-paper/40 pb-1 text-paper transition-colors hover:border-paper"
            >
              Browse the full catalogue
              <ArrowRightIcon width={15} height={15} />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4">
        <section className="pt-12">
          <SectionHeading eyebrow="Departments" title="Shop by category" href="/products" />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {cats.slice(0, 8).map((cat) => (
              <CategoryTile
                key={cat.id}
                name={cat.name}
                slug={cat.slug}
                count={cat.product_count}
              />
            ))}
          </div>
        </section>

        <ProductSection
          eyebrow="Handpicked"
          title="Featured this week"
          items={data.featured}
          href="/products?featured=1"
          linkLabel="See all featured"
        />
        <ProductSection
          eyebrow="Loved by shoppers"
          title="Best sellers"
          items={data.best_sellers}
          href="/products?sort=bestselling"
        />
        <ProductSection
          eyebrow="Just landed"
          title="New arrivals"
          items={data.new_arrivals}
          href="/products?sort=newest"
        />

        <section className="mt-16 border-y border-ink/15 py-10">
          <div className="grid gap-8 sm:grid-cols-3">
            {PROMISES.map((item) => (
              <div key={item.title} className={cn("sm:border-l sm:border-line sm:pl-6 first:sm:border-0 first:sm:pl-0")}>
                <p className="label text-leaf">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
