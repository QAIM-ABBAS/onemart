import { ORDER_FLOW, ORDER_STATUS_LABELS, formatDateTime } from "@/lib/format";
import type { OrderStatus, StatusEventOut } from "@/lib/types";
import { cn } from "@/lib/cn";

import { STATUS_STYLE } from "@/components/ui/Badge";

/**
 * Vertical status timeline, built from OrderStatusHistory.
 *
 * Every step shows its status, timestamp, and the note written when that
 * transition happened. Dot colours are the StatusBadge colours, token for
 * token:
 *
 *  - done steps        → filled with their status colour
 *  - the current step  → filled + ring, on a highlighted card
 *  - future steps      → muted outline (they may never happen)
 *  - a cancelled order → the flow stops at the last step that really
 *                        happened, then Cancelled is drawn as the terminal
 *                        red step. The steps that will never happen are
 *                        simply not drawn.
 */
export function OrderTimeline({
  status,
  history,
}: {
  status: OrderStatus;
  history: StatusEventOut[];
}) {
  const cancelled = status === "cancelled";
  const currentIndex = ORDER_FLOW.indexOf(status);

  const eventFor = (step: OrderStatus): StatusEventOut | undefined =>
    history.find((event) => event.status === step);

  const cancelEvent = cancelled
    ? [...history].reverse().find((event) => event.status === "cancelled")
    : undefined;

  const steps = cancelled
    ? ORDER_FLOW.filter((step) => eventFor(step) !== undefined)
    : ORDER_FLOW;

  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const event = eventFor(step);
        const done = cancelled || i < currentIndex;
        const current = !cancelled && i === currentIndex;
        const terminalFlowStep = !cancelled && i === steps.length - 1;
        const style = STATUS_STYLE[step];

        return (
          <li key={step} className="relative flex gap-3.5 pb-5 last:pb-0">
            {/* rail into the next step */}
            {terminalFlowStep ? null : (
              <span aria-hidden="true" className="absolute left-[7px] top-5 h-full w-px bg-line" />
            )}

            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2",
                done && cn("border-transparent", style.dot),
                current && cn("border-transparent", style.dot, "ring-4", style.ring),
                !done && !current && "border-line bg-canvas",
              )}
            />

            <div
              className={cn(
                "min-w-0 flex-1",
                current && "-mx-3 rounded-md border border-line bg-surface px-3 py-1.5 shadow-pressed",
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p
                  className={cn(
                    "label",
                    done ? "text-ink" : current ? "text-ink" : "text-ink-faint",
                    (done || current) && "font-semibold",
                  )}
                >
                  {ORDER_STATUS_LABELS[step]}
                </p>
                {current ? <span className="label text-brand-600">In progress</span> : null}
              </div>
              {event ? (
                <p className="num mt-0.5 text-[0.75rem] text-ink-muted">
                  {formatDateTime(event.created_at)}
                </p>
              ) : null}
              {event?.note ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{event.note}</p>
              ) : null}
            </div>
          </li>
        );
      })}

      {cancelled ? (
        <li className="relative flex gap-3.5 pt-0.5">
          <span
            aria-hidden="true"
            className="relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-transparent bg-danger ring-4 ring-danger/30"
          />
          <div className="-mx-3 min-w-0 flex-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-1.5">
            <p className="label font-semibold text-danger">Cancelled</p>
            {cancelEvent ? (
              <p className="num mt-0.5 text-[0.75rem] text-ink-muted">
                {formatDateTime(cancelEvent.created_at)}
              </p>
            ) : null}
            {cancelEvent?.note ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{cancelEvent.note}</p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">This order was cancelled.</p>
            )}
          </div>
        </li>
      ) : null}
    </ol>
  );
}
