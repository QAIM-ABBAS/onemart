import { ORDER_FLOW, ORDER_STATUS_LABELS, formatDateTime } from "@/lib/format";
import type { OrderStatus, StatusEventOut } from "@/lib/types";
import { cn } from "@/lib/cn";

function eventForStatus(history: StatusEventOut[], status: OrderStatus): StatusEventOut | undefined {
  return history.find((e) => e.status === status);
}

export function OrderTimeline({ status, history }: { status: OrderStatus; history: StatusEventOut[] }) {
  if (status === "cancelled") {
    const cancelEvent = [...history].reverse().find((e) => e.status === "cancelled");
    return (
      <div className="border border-brick/40 bg-brick/5 px-4 py-4">
        <p className="label text-brick">Order cancelled</p>
        <p className="mt-1.5 text-sm text-ink">
          {cancelEvent?.note || "This order was cancelled."}
        </p>
        {cancelEvent ? (
          <p className="num mt-1 text-[0.8125rem] text-ink-soft">
            {formatDateTime(cancelEvent.created_at)}
          </p>
        ) : null}
      </div>
    );
  }

  const currentIndex = ORDER_FLOW.indexOf(status);

  return (
    <ol className="grid gap-0 sm:grid-cols-5">
      {ORDER_FLOW.map((step, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const event = eventForStatus(history, step);
        return (
          <li key={step} className="relative flex gap-3 sm:block sm:pt-7">
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-[7px] top-4 h-full w-px bg-line sm:left-0 sm:top-4 sm:h-px sm:w-full",
                i === ORDER_FLOW.length - 1 && "hidden",
              )}
            />
            <span
              className={cn(
                "relative z-10 mt-1 size-4 shrink-0 rounded-full border-2 sm:absolute sm:left-0 sm:top-0 sm:mt-0",
                done
                  ? "border-leaf bg-leaf"
                  : current
                    ? "border-forest bg-paper"
                    : "border-line-strong bg-paper",
              )}
            />
            <div className="pb-5 sm:pb-0 sm:pr-4">
              <p
                className={cn(
                  "label",
                  done ? "text-leaf" : current ? "text-forest" : "text-ink-soft",
                )}
              >
                {ORDER_STATUS_LABELS[step]}
              </p>
              {event ? (
                <p className="num mt-0.5 text-[0.75rem] text-ink-soft">
                  {formatDateTime(event.created_at)}
                </p>
              ) : current ? (
                <p className="mt-0.5 text-[0.75rem] text-ink-soft">In progress</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
