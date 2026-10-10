/* ═══════════════════════════════════════════════════════════════════════
   FLASH DEAL STRIP (homepage)
   ═══════════════════════════════════════════════════════════════════════
   The storefront's urgency section: one live flash deal, its countdown
   ticking from the SERVER's end time, and a horizontal card rail.

   RULES (from the Phase 3 brief):
   - Countdown is client-side but anchored to `ends_at` from the server —
     never to a locally started timer.
   - Every card carries a "X% claimed" progress bar driven by
     `claimed_percent` (server-computed from the deal counter).
   - The rail scrolls horizontally on mobile (and beyond — one row always).
   - The whole strip HIDES when no deal is live: empty list, error, or
     expired → render nothing rather than an empty shell.
   - Deal red-orange (`deal-*` tokens) is used ONLY here and on discount
     badges — never for ordinary sale prices elsewhere.

   Skeleton: while the first fetch is in flight the strip reserves its
   shape (header + 4 cards) so the homepage doesn't jump when it lands.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { FlashDealItemOut } from "@/lib/types";
import { useActiveDeals } from "@/hooks/queries/deals";

import { CountdownPill } from "@/components/ui/CountdownPill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/States";

/* ── One deal card ─────────────────────────────────────────────────────
   width   : fixed so the rail scrolls instead of wrapping (mobile AND
             desktop — a single horizontal row keeps the urgency feel).
   progress: bar + "X% claimed · N left" caption. claimed_percent is a
             server string; clamp so a stale cache can't overflow the bar.
   ─────────────────────────────────────────────────────────────────────── */
function DealCard({ item }: { item: FlashDealItemOut }) {
  const dealPrice = Number(item.deal_price);
  const listPrice = Number(item.list_price);
  const claimed = Math.min(100, Math.max(0, Number(item.claimed_percent) || 0));
  const percentOff = Math.round(Number(item.percent_off) || 0);

  return (
    <Link
      to={`/p/${item.product_slug}`}
      className="group w-44 shrink-0 snap-start overflow-hidden rounded-md border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-1 hover:shadow-lift focus-visible:-translate-y-1 sm:w-56"
      aria-label={`${item.product_name}, deal price ${money(dealPrice)}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-t-md bg-surface-2">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span className="font-display text-3xl font-semibold text-brand-700/25 select-none">
              {item.product_name
                .split(/\s+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
          </div>
        )}
        {percentOff > 0 ? (
          <span className="label absolute start-2 top-2 rounded-xs bg-deal px-2 py-0.5 text-surface">
            {percentOff}% off
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-bold text-ink">
          {item.product_name}
        </h3>
        <p className="label mt-1 text-ink-faint">{item.variant_name}</p>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="num text-lg font-bold text-deal">{money(dealPrice)}</span>
          <span className="num text-xs text-ink-muted line-through">{money(listPrice)}</span>
        </div>

        {/* Claimed progress — deal-50 track, deal-600 fill (tokens only). */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-deal-50">
          <div
            className="h-full rounded-full bg-deal-600 transition-[width] duration-500"
            style={{ width: `${claimed}%` }}
          />
        </div>
        <p className="num mt-1.5 text-[11px] text-ink-muted">
          {Math.round(claimed)}% claimed · {item.remaining} left
        </p>
      </div>
    </Link>
  );
}

function StripSkeleton() {
  return (
    <div className="mt-5 flex gap-4 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="w-44 shrink-0 rounded-md border border-line bg-surface sm:w-56">
          <Skeleton className="aspect-square rounded-t-md" />
          <div className="space-y-2.5 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FlashStrip() {
  const deals = useActiveDeals();
  const qc = useQueryClient();

  // When the countdown hits zero, refresh now instead of waiting for poll.
  const onExpire = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["deals"] });
  }, [qc]);

  // Hidden by default: error or no live deal → the homepage shows nothing.
  const deal = deals.data?.[0];
  const showSkeleton = deals.isLoading && !deals.data;
  if (!showSkeleton && (!deal || deal.items.length === 0)) return null;

  const headingId = "flash-deals-heading";

  return (
    <section aria-labelledby={headingId} className="section-block">
      <SectionHeader id={headingId} title={deal?.name ?? "Flash deals"}>
        <span className="label rounded-xs bg-deal-50 px-2 py-0.5 text-deal-700">
          Limited stock
        </span>
        {deal?.ends_at ? <CountdownPill endsAt={deal.ends_at} onExpire={onExpire} /> : null}
      </SectionHeader>

      {showSkeleton ? (
        <StripSkeleton />
      ) : (
        <div
          className={cn(
            "mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto hide-scrollbar",
            "pb-1 -mx-1 px-1",
          )}
          role="list"
          aria-label="Flash deal items"
        >
          {deal?.items.map((item) => (
            <div key={item.id} role="listitem">
              <DealCard item={item} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
