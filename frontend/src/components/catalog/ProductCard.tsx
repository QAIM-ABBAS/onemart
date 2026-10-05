/* ═══════════════════════════════════════════════════════════════════════
   PRODUCT CARD
   ═══════════════════════════════════════════════════════════════════════
   The main product card used across the Browse page, the home shelves,
   and the "Top Saver" section.

   LAYOUT BLUEPRINT (vertical order — matches the strawberry reference):

   ┌─────────────────────────────────────┐
   │  1. IMAGE           (aspect-square) │  ← large image area on top,
   │      [wishlist ♥ overlay]           │     wishlist button overlays it
   ├─────────────────────────────────────┤
   │  2. CATEGORY + DISCOUNT             │  ← label left, discount badge right
   │  3. PRODUCT NAME                    │  ← h3, bold, links to detail page
   │  4. RATING          (stars + text)  │
   │  5. PRICE          (bold + strike)  │
   │  6. DESCRIPTION                    │  ← goes DIRECTLY to purchase
   │  7. PURCHASE CONTROLS               │     controls (no feature rows)
   │     [qty stepper] [ADD TO CART]     │  ← pinned to bottom via mt-auto
   └─────────────────────────────────────┘

   STYLING RULES (visual identity — do NOT flatten the card):
   - Depth comes from `shadow-card` (rest) / `shadow-lift` (hover).
   - Card background is `bg-surface` (a gradient utility from index.css).
   - Corners: card = `rounded-md`, image top = `rounded-t-md`,
     buttons/controls = `rounded-md` / `rounded-lg`.
   - All colors come from design tokens in `src/index.css`
     (`text-ink`, `text-brand-600`, `bg-deal`, `bg-brand-700`, `text-warning`, …).
   - There is intentionally NO feature/attribute row (Organic/Fresh/etc.);
     the description flows straight into the purchase controls.

   DESIGN SYSTEM CHEAT SHEET (defined in src/index.css):
   - Shadows : shadow-card (rest) · shadow-lift (hover) ·
               shadow-button (CTA) · shadow-pressed (wells/steppers)
   - Text    : text-ink (headings) · text-ink-muted (secondary/body)
   - Brand   : text-brand-600 / bg-brand-700 (primary brand) · bg-deal (discount)
   - Type    : `label` utility = uppercase, 11px, letterspaced,
               600 weight · `num` = tabular numbers (aligned digits)
   - Display font (Inter, applied to h1–h4 via @layer base in index.css).
   ═══════════════════════════════════════════════════════════════════════ */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn"; // className merge helper (clsx + tailwind-merge)
import { money } from "@/lib/format"; // currency formatter → "₹50.00"
import type { ProductListItem } from "@/lib/types"; // the data shape for each card
import { useQuickAdd } from "@/hooks/useQuickAdd"; // add-to-cart logic + toasts
import { useWishlist } from "@/hooks/useWishlist"; // server-backed wishlist (guests get a login prompt)

import { QuantityStepper } from "@/components/ui/Price"; // the − qty + control
import { Skeleton } from "@/components/ui/States"; // loading shimmer blocks
import { StarIcon } from "@/components/ui/Icon"; // star SVG for ratings

/* ───────────────────────────────────────────────────────────────────────
   FALLBACK IMAGE
   Shown when a product has no thumbnail. Renders the first two initials
   of the product name (e.g. "Cadbury Dairy Milk" → "CD") centred on a
   muted background.
   TO EDIT: change `text-4xl` (initials size) or `text-brand-700/25`
   (initials color/opacity) or `bg-surface-2` (background fill).
   ─────────────────────────────────────────────────────────────────────── */
function FallbackImage({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="grid h-full w-full place-items-center bg-surface-2">
      <span className="font-display text-4xl font-semibold text-brand-700/25 select-none">
        {initials}
      </span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   WISHLIST BUTTON (heart icon)
   A circular button floating in the top-right corner of the image.

   BEHAVIOUR:
   - Always visible on mobile; hidden until card hover on desktop
     (md:opacity-0 → md:group-hover:opacity-100).
   - Click calls preventDefault + stopPropagation so it does NOT trigger
     the image link underneath it.
   - Filled red heart when saved, outline when not.

   TO EDIT:
   - Position  : `end-2 top-2` (distance from right / top of image)
   - Size      : `size-8` (button circle), svg 16×16
   - Visibility: remove the `md:opacity-0 …` line to show it always
   - Colors    : `bg-surface/95` (bg), `text-danger` (saved state)
   ─────────────────────────────────────────────────────────────────────── */
function WishlistButton({ productId, name }: { productId: number; name: string }) {
  const wishlist = useWishlist();
  const saved = wishlist.has(productId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        wishlist.toggle(productId, name);
      }}
      className={cn(
        "absolute end-2 top-2 z-20 grid size-8 place-items-center rounded-full bg-surface/95 text-ink-muted border border-line transition-all hover:shadow-lift",
        "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        saved ? "text-danger" : "hover:text-danger",
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" />
      </svg>
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   STAR RATING (read-only display)
   Renders 5 stars + "4.5 (12 reviews)" text.

   STAR FILL LOGIC:
   - full stars = floor(rating)
   - a star is also filled if the fractional part is ≥ 0.5 (half-warning
     approximation — note: it fills the whole star, it does not render
     a clipped half star)
   - empty stars get `opacity-30` but still occupy space (keeps the
     row width constant)

   TO EDIT:
   - Star size    : `width={12} height={12}`
   - Star color   : `text-warning` (token = warm/bronze in both themes)
   - Rating text  : the <span> below (currently `text-[11px] text-ink-muted`)
   - Text format  : `{rating.toFixed(1)} ({reviewCount} reviews)`
   ─────────────────────────────────────────────────────────────────────── */
function StarRating({ rating, reviewCount }: { rating: number; reviewCount: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.5;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5 text-warning">
        {Array.from({ length: 5 }, (_, i) => (
          <StarIcon
            key={i}
            width={12}
            height={12}
            fill={i < fullStars ? "currentColor" : hasHalf && i === fullStars ? "currentColor" : "none"}
            className={i < fullStars || (hasHalf && i === fullStars) ? "" : "opacity-30"}
          />
        ))}
      </div>
      <span className="text-[11px] text-ink-muted num">
        {rating.toFixed(1)} ({reviewCount} reviews)
      </span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   PROPS
   - item      : the product data (see ProductListItem in src/lib/types.ts)
   - className : optional extra classes from the parent (e.g. grid tweaks)
   - deal      : sold/stock counters (declared for TopSaver-style cards;
                 currently unused inside the component body — kept for
                 API compatibility with existing callers)
   ─────────────────────────────────────────────────────────────────────── */
export interface ProductCardProps {
  item: ProductListItem;
  className?: string;
  deal?: { sold: number; stock: number };
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CARD COMPONENT
   ═══════════════════════════════════════════════════════════════════════
   STRUCTURE (3 vertical sections):
     SECTION 1 — IMAGE AREA (the <div className="relative"> block)
     SECTION 2 — INFO (category → name → rating → price → description)
     SECTION 3 — PURCHASE CONTROLS (qty stepper + Add to cart, pinned
                 to the bottom of the card with `mt-auto`)

   The card itself is a flex COLUMN (`flex flex-col`) and `h-full`, so
   in a grid where cards in a row are equal height, the purchase controls
   always sit flush at the bottom regardless of how much text is above.
   ═══════════════════════════════════════════════════════════════════════ */
export function ProductCard({ item, className }: ProductCardProps) {
  /* ── STATE ──────────────────────────────────────────────────────────
     quickAdd : hook that POSTs to the cart API and fires a toast
     qty      : current quantity chosen in the stepper (1–99)
     adding   : true while the add-to-cart request is in flight
                (disables the button + swaps the label to "Adding…")
     ───────────────────────────────────────────────────────────────── */
  const quickAdd = useQuickAdd();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  /* ── DERIVED VALUES ────────────────────────────────────────────────
     discount    : rounded % off, e.g. price 50 / compare 155 → 68.
                   If there is no valid compare_at_price, discount = 0
                   and the red badge is hidden (see JSX below).
     rating      : product rating, defaults to 4.5 if missing
     reviewCount : review total, defaults to 0
     description : falls back to a generated sentence if none in data
     unit        : trailing unit label, e.g. "per unit" / "per kg"
     ───────────────────────────────────────────────────────────────── */
  const discount =
    item.compare_at_price && item.compare_at_price > item.price
      ? Math.round(((item.compare_at_price - item.price) / item.compare_at_price) * 100)
      : 0;

  const rating = item.rating ?? 4.5;
  const reviewCount = item.review_count ?? 0;
  const description = item.description ?? `Fresh ${item.category} — quality you can trust.`;
  const unit = item.unit ?? "per unit";

  /* ── ADD TO CART HANDLER ───────────────────────────────────────────
     Sets `adding` → calls quickAdd → resets qty to 1 → always clears
     `adding` in `finally` so the button never gets stuck disabled.
     `void` in `void addToCart()` just tells TS "we intentionally ignore
     the returned promise" (the catch-less async is safe because of finally).
     ───────────────────────────────────────────────────────────────── */
  async function addToCart() {
    setAdding(true);
    try {
      await quickAdd(item, qty);
      setQty(1);
    } finally {
      setAdding(false);
    }
  }

  return (
    /* ── CARD SHELL ──────────────────────────────────────────────────
       group           : parent ref for group-hover (image zoom, wishlist)
       relative        : positioning context for the wishlist overlay
       @container      : makes this card a CONTAINER-QUERY context, so the
                         purchase controls (stepper + button) can size
                         themselves to the CARD's width instead of the
                         viewport — that is what keeps the 35/65 row correct
                         in every grid column count (see Section 3).
       flex flex-col   : vertical stacking of image / info / controls
       h-full          : stretch to equal row height in the grid
       rounded-md      : card corner radius (light theme tweak)
       bg-surface      : gradient card background (see .bg-surface)
       shadow-card     : resting elevation (inset highlight + drop shadow)
       hover:-translate-y-1 + hover:shadow-lift : lift effect on hover
       focus-within:z-30 hover:z-30 : raise card above neighbours when
                       hovered/focused so the lifted shadow isn't clipped
       ───────────────────────────────────────────────────────────────── */
    <article
      className={cn(
        "group relative @container flex h-full flex-col rounded-md bg-surface border border-line transition duration-200",
        "hover:-translate-y-1 hover:shadow-lift focus-within:z-30 hover:z-30",
        className,
      )}
    >
      {/* ═══ SECTION 1 — PRODUCT IMAGE ═════════════════════════════════
          A link wrapping the image (whole image → detail page), with the
          wishlist button absolutely positioned over it.

          IMAGE SIZING: `aspect-square` = image area is as tall as it is
          wide (1:1), so the image occupies a substantial top portion of
          the card. To make it taller use aspect-[4/5]; shorter → aspect-[4/3].

          TREATMENT (keep as-is):
          - rounded-t-md : rounded top corners matching the card
          - bg-surface-2       : placeholder fill while image loads / behind it
          - object-cover  : crop-to-fill, never letterbox
          - group-hover:scale-[1.03] : subtle zoom on card hover
          - loading="lazy" + decoding="async" : performance
          ═══════════════════════════════════════════════════════════════ */}
      <div className="relative">
        <Link
          to={`/p/${item.slug}`}
          aria-label={item.name}
          className="block aspect-square overflow-hidden rounded-t-md bg-surface-2"
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              width={400}
              height={400}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <FallbackImage name={item.name} />
          )}
        </Link>

        {/* Heart button — overlaps the image's top-right corner */}
        <WishlistButton productId={item.id} name={item.name} />
      </div>

      {/* ═══ SECTIONS 2 + 3 — INFORMATION & PURCHASE CONTROLS ══════════
          p-4            : padding around the whole info block
          flex-1         : this block takes ALL remaining card height
          flex-col       : children stack vertically in reference order
          The last child uses `mt-auto` to pin itself to the bottom,
          which is what creates the "gap before the purchase controls"
          when the card is taller than its content.
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col p-4">
        {/* ── CATEGORY + DISCOUNT BADGE (one row, pushed apart) ───────
            Same horizontal level: category label on the LEFT,
            discount badge aligned to the RIGHT (justify-between).

            TO EDIT:
            - Category style  : `label text-brand-600`
              (`label` = uppercase, 11px, letterspaced utility)
            - Discount style  : `label bg-deal px-2 py-0.5 rounded-xs
                                shrink-0 whitespace-nowrap text-surface`
                                (rounded-xs = 4px — just a slight
                                softening of the corners;
                                shrink-0 + whitespace-nowrap = the badge
                                NEVER wraps its text to a second line —
                                if the row gets tight, the category
                                label wraps instead)
            - Remove the badge entirely → delete the `{discount > 0 …}`
              conditional below.
            ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <p className="label text-brand-600">{item.category}</p>
          {discount > 0 ? (
            <span className="label shrink-0 whitespace-nowrap bg-deal px-2 py-0.5 rounded-xs text-surface">
              {discount}% off
            </span>
          ) : null}
        </div>

        {/* ── PRODUCT NAME (below the category row) ───────────────────
            mt-2                : space under the category row
            text-lg font-bold   : prominent title (18px, bold)
            leading-snug        : tight-ish line height for 2-line names
            The <Link> makes only the text clickable to the detail page.
            Hover/focus recolor to the leaf brand green.
            ─────────────────────────────────────────────────────────── */}
        <h3 className="mt-2 text-lg leading-snug font-bold text-ink">
          <Link
            to={`/p/${item.slug}`}
            className="transition-colors hover:text-brand-600 focus-visible:text-brand-600"
          >
            {item.name}
          </Link>
        </h3>

        {/* ── RATING ROW (directly below the name) ────────────────────
            mt-2 = spacing. Renders <StarRating> above.
            TO EDIT star size/count → see StarRating component.
            ─────────────────────────────────────────────────────────── */}
        <div className="mt-2">
          <StarRating rating={rating} reviewCount={reviewCount} />
        </div>

        {/* ── PRICE ROW (below rating, above description) ─────────────
            mt-3                 : space under the rating row
            flex items-baseline  : aligns price + struck price + unit on
                                   the text baseline (looks like one line)
            text-lg font-bold    : current price (18px — one step down
                                   from text-xl so it sits calmer under
                                   the smaller rating row)
            Compare price branch:
              • if compare_at_price > price → show struck-through
                original + unit, e.g. "₹155.00 per unit"
              • else → show only the unit label
            `num` = tabular numerals so digits line up.
            ─────────────────────────────────────────────────────────── */}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-lg font-bold text-ink num">{money(item.price)}</span>
          {item.compare_at_price && item.compare_at_price > item.price ? (
            <span className="text-xs text-ink-muted line-through num">
              {money(item.compare_at_price)} {unit}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">{unit}</span>
          )}
        </div>

        {/* ── DESCRIPTION (directly above the purchase controls) ──────
            mt-3                  : space under the price row
            text-sm               : 14px body copy
            leading-relaxed       : comfortable line spacing
            line-clamp-3          : truncates to max 3 lines with "…"
                                    (change the 3 to allow more/fewer lines;
                                    remove the class to show full text)

            NOTE: by design there is NO feature/attribute row here
            (no Organic / Fresh / Free delivery / origin icons) — the
            description flows straight into the purchase controls,
            matching the reference layout.
            ─────────────────────────────────────────────────────────── */}
        <p className="mt-3 text-sm leading-relaxed text-ink-muted line-clamp-3">
          {description}
        </p>

        {/* ═══ SECTION 3 — PURCHASE CONTROLS (pinned to card bottom) ═══
            ONE clear action area at the bottom of the card, exactly like
            the reference: quantity selector on the LEFT, Add-to-cart on
            the RIGHT, equal heights (h-12), side by side.

            mt-auto : pushes this block to the BOTTOM of the card no
                      matter how tall the card grows in a grid row.
                      This is what creates the spacious gap between the
                      description and the controls (like the reference).
            pt-4    : extra breathing room above the controls.

            WIDTH SPLIT (responsive to the CARD, not the viewport —
            the <article> carries the `@container` class):
              stepper = 35% of the row · button = 65% of the row
              container < 320px → stepper uses smaller −/+ buttons
                (never overflows the 35% column)
              container ≥ 320px → full reference proportions
                (phones, 1–2 column layouts)

            TO EDIT:
            - Gap above controls   : change `pt-4`
            - Space between them   : `gap-2` on the inner row
            - Width split          : `w-[35%]` / `w-[65%]`
                                     (keep summing to 100 — the gap
                                     comes out of both)
            - Row height           : `h-12` on the button AND `h-12` on
                                     the outline stepper (change together)
            - Stepper look         : QuantityStepper variant="outline"
                                     in src/components/ui/Price.tsx
            ─────────────────────────────────────────────────────────── */}
        <div className="mt-auto pt-4">
          <div className="flex items-center gap-2">
            {/* ── QUANTITY SELECTOR — LEFT, 35% ──
                variant="outline" → the reference look: ONE raised bordered
                pill with − 1 + (big bold number, flat buttons — no inner
                chips, no unit text).
                Controlled by `qty`; clamped to min 1 / max 99.
                ─────────────────────────────────────────────────── */}
            <QuantityStepper
              variant="outline"
              value={qty}
              onChange={setQty}
              min={1}
              max={99}
              className="w-[35%]"
            />

            {/* ── ADD TO CART — RIGHT, 65% ──
                Single line like the reference:
                    Add to cart · ₹50.00
                (sentence case, running total after a · separator).
                flex-wrap: on very narrow cards the total drops to a
                second line instead of overflowing.

                KEPT FROM THE ORIGINAL CARD (identity):
                bg-brand-700 + → brand colour with glossy gradient
                shadow-button → inner top edge only (no cast shadow)
                hover rise + bg change → same interaction feel

                STATES:
                • adding       → "Adding…", disabled, total hidden
                • out of stock → "Out of stock", disabled
                • disabled     → opacity-50 + not-allowed cursor
                ─────────────────────────────────────────────────── */}
            <button
              type="button"
              onClick={() => void addToCart()}
              disabled={adding || !item.in_stock}
              className={cn(
                "h-12 w-[65%] rounded-md bg-brand-700 text-surface shadow-button transition hover:bg-brand-800",
                "flex items-center justify-center hover:-translate-y-px",
                "disabled:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <span className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 leading-none">
                <span className="whitespace-nowrap font-bold text-sm">
                  {adding ? "Adding…" : item.in_stock ? "Add to cart" : "Out of stock"}
                </span>
                {item.in_stock && !adding ? (
                  <>
                    <span aria-hidden="true" className="whitespace-nowrap">
                      ·
                    </span>
                    <span className="num whitespace-nowrap font-bold text-sm">
                      {money(item.price * qty)}
                    </span>
                  </>
                ) : null}
              </span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   CARD SKELETON (loading placeholder)
   Mirrors the real card's shape so there is NO layout shift when data
   arrives: same rounded-md shell, same aspect-square image area.

   TO EDIT: adjust the inner Skeleton blocks to match any content
   changes you make in the real card (rough heights are enough — they
   are deliberately approximate).
   ─────────────────────────────────────────────────────────────────────── */
export function ProductCardSkeleton() {
  return (
    <div className="h-full rounded-md bg-surface border border-line">
      <Skeleton className="aspect-square rounded-t-md" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-3 w-16" /> {/* category label */}
        <Skeleton className="h-4 w-full" /> {/* product name */}
        <Skeleton className="h-3 w-24" /> {/* rating row */}
        <Skeleton className="h-4 w-20 mt-3" /> {/* price */}
        <Skeleton className="h-8 w-full mt-3" /> {/* description */}
        <Skeleton className="h-12 w-full mt-4" /> {/* purchase controls row */}
      </div>
    </div>
  );
}

/**
 * Row of product cards.
 *
 * The grid decides its own column count from the space it has
 * (`repeat(auto-fit, minmax(…))` in `.card-grid` in src/index.css), so
 * the same markup gives one column on a phone, two on a small tablet,
 * three on a tablet, four on a desktop and five on a wide or 4K screen —
 * no breakpoint per size, and every card in a row keeps the same width.
 *
 * TO EDIT column counts: change the `minmax(min(100%, 13rem), 1fr)`
 * value in `.card-grid` (src/index.css) — a larger minimum = fewer
 * columns, smaller = more.
 */
export function ProductGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card-grid", className)}>{children}</div>;
}

/** Loading version of ProductGrid — `count` skeletons in the same grid. */
export function ProductGridSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ProductGrid className={className}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </ProductGrid>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   SECTION HEADING (used above card grids, e.g. "Top Savers  See all")
   - eyebrow : small uppercase green label above the title (optional)
   - title   : large display heading (Fraunces via h1–h4 base styles)
   - href    : when provided, renders the "See all" link on the right
   TO EDIT: spacing → `pb-1` / `mt-1.5`; title size → `text-2xl sm:text-[1.75rem]`
   ─────────────────────────────────────────────────────────────────────── */
export function SectionHeading({
  eyebrow,
  title,
  href,
  linkLabel = "See all",
  className,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 pb-1", className)}>
      <div>
        {eyebrow ? <p className="label text-brand-600">{eyebrow}</p> : null}
        <h2 className="mt-1.5 text-2xl sm:text-[1.75rem]">{title}</h2>
      </div>
      {href ? (
        <Link
          to={href}
          className="label border-b border-ink/30 pb-0.5 text-ink transition-colors hover:border-brand-600 hover:text-brand-600"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
