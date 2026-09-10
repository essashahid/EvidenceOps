import type { ReactNode, Ref, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Form primitives. Sizing, borders and focus rings come from globals.css so a
 * bare `<input>` in a page already matches; these add labels, hints and layout.
 */
export function Field({ label, hint, htmlFor, children, className = "", inline = false }: { label?: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string; inline?: boolean }) {
  return (
    <div className={cn("min-w-0", inline ? "flex items-center gap-2" : "flex flex-col gap-1", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-[var(--muted)]">
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="text-[12px] text-[var(--faint)]">{hint}</p> : null}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full px-2.5 py-1.5", className)} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={cn("w-full px-2.5 py-1.5", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} {...props} className={cn("w-full px-2.5 py-2 leading-6", className)} />;
}

export function CheckboxField({ name, label, defaultChecked, disabled, title, id }: { name: string; label: ReactNode; defaultChecked?: boolean; disabled?: boolean; title?: string; id?: string }) {
  return (
    <label title={title} className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-[13px]", disabled && "cursor-not-allowed opacity-50")}>
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} />
      {label}
    </label>
  );
}

/**
 * Filter bar above a table. Fields sit on one row on desktop and wrap to a
 * two-column grid on small screens instead of forming a ragged stack.
 */
export function FilterBar({ children, actions, meta, className = "" }: { children: ReactNode; actions?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]", className)}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        {children}
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        {meta ? <div className="ml-auto self-center text-[12px] text-[var(--muted)]">{meta}</div> : null}
      </div>
    </div>
  );
}
