import { Link } from "react-router-dom";

import { BRAND_OFFERS } from "@/content/home";

import { Carousel, useCarousel } from "@/components/ui/Carousel";
import { SectionHeader } from "@/components/ui/SectionHeader";

const CARD_WIDTH =
  "w-[78%] shrink-0 snap-start sm:w-[46%] md:w-[31%] lg:w-[calc((100%-3*1rem)/4)]";

export function FeaturedBrands() {
  const { ref, scrollBy, canPrev, canNext } = useCarousel<HTMLDivElement>();

  return (
    <section aria-labelledby="brands-heading" className="section-block pt-0">
      <SectionHeader
        id="brands-heading"
        title="Featured offers"
        href="/products"
        linkLabel="All offers"
        onPrev={() => scrollBy(-1)}
        onNext={() => scrollBy(1)}
        canPrev={canPrev}
        canNext={canNext}
      />

      <div className="mt-5">
        <Carousel containerRef={ref} ariaLabel="Featured offers">
          {BRAND_OFFERS.map((offer) => (
            <Link
              key={offer.id}
              to={offer.href}
              className={`${CARD_WIDTH} group block overflow-hidden rounded-md bg-surface border border-line transition duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:shadow-lift`}
            >
              <span
                className="block aspect-[16/10] overflow-hidden"
                style={{ backgroundColor: offer.tint }}
              >
                <img
                  src={offer.image}
                  alt=""
                  width={480}
                  height={300}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
                />
              </span>
              <span className="label mt-3 block px-3 text-ink-muted">{offer.label}</span>
              <span className="mt-1.5 block px-3 pb-3 text-sm leading-snug font-semibold text-ink transition-colors group-hover:text-brand-600">
                {offer.title}
              </span>
            </Link>
          ))}
        </Carousel>
      </div>
    </section>
  );
}
