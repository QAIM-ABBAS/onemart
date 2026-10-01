import { useToasts } from "@/stores/toast";
import { cn } from "@/lib/cn";

import { CloseIcon } from "./Icon";

const toneClasses = {
  positive: "border-leaf/40 bg-leaf text-paper",
  negative: "border-brick/50 bg-brick text-paper",
  info: "border-line-strong bg-ink text-paper",
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
            "pointer-events-auto flex w-full max-w-sm items-center gap-3 border px-4 py-3 text-sm shadow-panel",
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
              className="label shrink-0 border-b border-current pb-0.5"
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
