import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { BannerSlide } from "@/content/home";
import { cn } from "@/lib/cn";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/Icon";

const INTERVAL = 5000;

export function HeroSlider({ slides }: { slides: BannerSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const count = slides.length;

  const go = useCallback(
    (next: number) => setIndex((next + count) % count),
    [count],
  );

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), INTERVAL);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  if (count === 0) return null;

  const active = slides[index];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured offers"
      className="relative h-[360px] overflow-hidden rounded-md bg-surface-2 border border-line sm:h-[380px] lg:h-[300px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onPointerDown={(event) => {
        pointerStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (start === null) return;
        const delta = event.clientX - start;
        if (Math.abs(delta) > 50) go(index + (delta < 0 ? 1 : -1));
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(index - 1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(index + 1);
        }
      }}
      tabIndex={0}
    >
      <div
        className="flex h-full transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            aria-hidden={i !== index}
            className={cn(
              "relative h-full w-full shrink-0 overflow-hidden",
              slide.tone === "brand"
                ? "bg-brand-700 text-surface "
                : "bg-brand-50 text-ink",
            )}
          >
            <div className="flex h-full items-center px-6 sm:px-10 lg:px-12">
              <div className="relative z-10 max-w-[56%] sm:max-w-[52%]">
                <h2 className="text-2xl leading-tight sm:text-3xl lg:text-[2.1rem]">
                  {slide.title}
                </h2>
                <p className="mt-3 hidden max-w-md text-sm leading-relaxed opacity-75 sm:block">
                  {slide.subtitle}
                </p>
                <Link
                  to={slide.cta_url}
                  className={cn(
                    "label mt-5 inline-flex h-10 items-center rounded-md px-5 shadow-button transition hover:-translate-y-px",
                    slide.tone === "brand"
                      ? "bg-canvas text-ink hover:bg-brand-50"
                      : "bg-brand-700 text-surface hover:bg-brand-800",
                  )}
                >
                  {slide.cta_label}
                </Link>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 end-0 hidden w-[45%] items-center justify-center sm:flex lg:w-[42%]">
              <img
                src={slide.image}
                alt=""
                width={320}
                height={320}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding="async"
                className="photo-lift h-[78%] w-auto max-w-none object-contain"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="absolute bottom-4 end-4 z-20 flex items-center gap-2 sm:bottom-5 sm:end-6">
        <div className="flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-2 border border-line">
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => go(index - 1)}
            className="grid size-7 place-items-center rounded-full text-ink transition hover:bg-surface-2 hover:text-brand-700"
          >
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <div className="flex items-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-brand-700 " : "w-1.5 bg-line hover:bg-ink-muted",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => go(index + 1)}
            className="grid size-7 place-items-center rounded-full text-ink transition hover:bg-surface-2 hover:text-brand-700"
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>

      <p aria-live="off" className="sr-only">
        {active ? active.title : ""}
      </p>
    </section>
  );
}
