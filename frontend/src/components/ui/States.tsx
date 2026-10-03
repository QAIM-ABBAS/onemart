import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";

import { Button } from "./Button";

/** Loading placeholder — flat surface-2 block, no shadow, no colour. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />;
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

/** Real empty state: white card, hairline border, one clear action. */
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
        "rounded-md border border-line bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      <p className="label text-ink-faint">Nothing here</p>
      <h3 className="mt-3 text-xl">{title}</h3>
      {body ? <p className="mt-2 text-sm text-ink-muted max-w-md mx-auto">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Real error state: danger tint + hairline border + retry. */
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
    <div className={cn("rounded-md border border-danger/20 bg-danger/5 px-6 py-10 text-center", className)}>
      <p className="label text-danger">Could not load</p>
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
        "rounded-md border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-[0.8125rem] text-danger",
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
    positive: "bg-success/8 border-success/25 text-success",
    info: "bg-info/8 border-info/25 text-info",
    warning: "bg-warning/15 border-warning/40 text-ink",
  } as const;
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", tones[tone], className)}>{children}</div>
  );
}
