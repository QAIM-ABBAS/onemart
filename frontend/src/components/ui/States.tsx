import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";

import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-mist rounded-sm", className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center",
        className,
      )}
    >
      <p className="label text-ink-soft">Nothing here</p>
      <h3 className="mt-3 text-xl">{title}</h3>
      {body ? <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong while loading this section.";
  return (
    <div className={cn("border border-brick/40 bg-brick/5 px-6 py-10 text-center", className)}>
      <p className="label text-brick">Could not load</p>
      <p className="mt-3 text-sm text-ink max-w-md mx-auto">{message}</p>
      {onRetry ? (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        "border border-brick/40 bg-brick/5 px-3.5 py-2.5 text-[0.8125rem] text-brick",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Notice({
  children,
  tone = "positive",
  className,
}: {
  children: ReactNode;
  tone?: "positive" | "info" | "warning";
  className?: string;
}) {
  const tones = {
    positive: "border-leaf/40 bg-leaf/8 text-leaf",
    info: "border-forest/30 bg-forest/8 text-forest",
    warning: "border-amber/40 bg-amber/8 text-amber",
  } as const;
  return (
    <div className={cn("border px-4 py-3 text-sm", tones[tone], className)}>{children}</div>
  );
}
