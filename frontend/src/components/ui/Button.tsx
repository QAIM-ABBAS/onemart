import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-forest text-paper border border-forest hover:bg-ink hover:border-ink active:translate-y-px",
  secondary:
    "bg-surface text-ink border border-line-strong hover:border-ink hover:bg-mist active:translate-y-px",
  ghost: "bg-transparent text-ink-soft border border-transparent hover:text-ink hover:bg-mist",
  danger:
    "bg-surface text-brick border border-brick/50 hover:bg-brick hover:text-surface hover:border-brick active:translate-y-px",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-[0.8125rem] gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-7 text-[0.9375rem] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, block = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium tracking-[0.01em] transition-colors select-none",
        "disabled:opacity-45 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? "Working…" : children}
    </button>
  );
});
