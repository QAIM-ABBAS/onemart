import { useToasts } from "@/stores/toast";
import { cn } from "@/lib/cn";

import { CloseIcon } from "./Icon";

const toneClasses = {
  positive: "bg-brand-600 text-surface",
  negative: "bg-danger text-surface",
  info: "bg-brand-700 text-surface",
} as const;

export function Toaster() {
  const { toasts, dismiss } = useToasts();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md px-4 py-3 text-sm shadow-button",
            toneClasses[item.tone ?? "info"],
          )}
        >
          <span className="flex-1">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                dismiss(item.id);
              }}
              className="label shrink-0 rounded-full bg-canvas/20 px-2.5 py-1 transition hover:bg-canvas/30"
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(item.id)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
          >
            <CloseIcon width={15} height={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
