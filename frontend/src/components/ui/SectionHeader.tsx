import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";

import { ChevronLeftIcon, ChevronRightIcon } from "./Icon";

export function ArrowButton({
  direction,
  onClick,
  disabled = false,
  label,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-ink border border-line transition hover:bg-surface-2 hover:shadow-lift disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon width={16} height={16} />
    </button>
  );
}

interface SectionHeaderProps {
  title: string;
  href?: string;
  linkLabel?: string;
  children?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  id?: string;
  className?: string;
}

export function SectionHeader({
  title,
  href,
  linkLabel = "See all",
  children,
  onPrev,
  onNext,
  canPrev,
  canNext,
  id,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-4 gap-y-1">
        <h2 id={id} className="text-xl sm:text-[1.375rem]">
          {title}
        </h2>
        {href ? (
          <Link
            to={href}
            className="label inline-flex items-center gap-1 border-b border-ink/30 pb-0.5 text-ink-muted transition-colors hover:border-brand-600 hover:text-brand-600"
          >
            {linkLabel}
            <ChevronRightIcon width={13} height={13} />
          </Link>
        ) : null}
        {children}
      </div>
      {onPrev && onNext ? (
        <div className="flex items-center gap-1.5">
          <ArrowButton
            direction="prev"
            onClick={onPrev}
            disabled={!canPrev}
            label={`Scroll ${title} backwards`}
          />
          <ArrowButton
            direction="next"
            onClick={onNext}
            disabled={!canNext}
            label={`Scroll ${title} forwards`}
          />
        </div>
      ) : null}
    </div>
  );
}
