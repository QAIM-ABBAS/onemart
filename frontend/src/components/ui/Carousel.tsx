import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

export function useCarousel<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [bounds, setBounds] = useState({ prev: false, next: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth - 2;
    setBounds({
      prev: el.scrollLeft > 2,
      next: el.scrollLeft < max,
    });
  }, []);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.8, 160),
      behavior: reduced ? "auto" : "smooth",
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  return { ref, scrollBy, canPrev: bounds.prev, canNext: bounds.next, update };
}

interface CarouselProps {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function Carousel({
  children,
  className,
  ariaLabel,
  containerRef,
  onKeyDown,
}: CarouselProps) {
  return (
    <div
      ref={containerRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      tabIndex={0}
      className={cn(
        "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain hide-scrollbar",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
