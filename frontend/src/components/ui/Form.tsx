import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

export const fieldBase =
  "w-full rounded-md border border-line bg-surface px-4 text-[0.9375rem] text-ink placeholder:text-ink-faint " +
  "transition focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 " +
  "disabled:bg-surface-2 disabled:text-ink-muted";

export const fieldIdle = "";
export const fieldError =
  "bg-danger/5 border-danger/50 ring-1 ring-danger/40 focus:ring-danger/60 focus:border-danger";

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="label text-ink-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[0.8125rem] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(fieldBase, invalid ? fieldError : fieldIdle, "h-11", className)}
      {...rest}
    />
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldBase, invalid ? fieldError : fieldIdle, "py-2.5 leading-relaxed", className)}
      {...rest}
    />
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        invalid ? fieldError : fieldIdle,
        "h-11 appearance-none pr-9 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%236b6f68%22 stroke-width=%221.7%22><path d=%22m4 6 4 4 4-4%22/></svg>')] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className={cn("inline-flex items-center gap-2.5 text-sm cursor-pointer", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="size-4 rounded-[1px] accent-brand-700 cursor-pointer"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
});
