import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

export const fieldBase =
  "w-full rounded-sm border bg-surface px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-soft/70 " +
  "transition-colors focus:outline-none focus:border-leaf focus:ring-1 focus:ring-leaf/40 " +
  "disabled:bg-mist disabled:text-ink-soft";

export const fieldIdle = "border-line-strong";
export const fieldError = "border-brick focus:border-brick focus:ring-brick/30";

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
      <label htmlFor={htmlFor} className="label text-ink-soft">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[0.8125rem] text-brick">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-ink-soft">{hint}</p>
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
        "h-11 appearance-none pr-9 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%235f6b63%22 stroke-width=%221.7%22><path d=%22m4 6 4 4 4-4%22/></svg>')] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat",
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
        className="size-4 rounded-[1px] accent-[#1F3D2B] cursor-pointer"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
});
