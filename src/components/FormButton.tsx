"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-white border-[var(--accent)] hover:opacity-90",
  secondary: "bg-[var(--card)] text-[var(--fg)] border-[var(--line)] hover:bg-[var(--bg)]",
  danger: "bg-[var(--card)] text-[var(--bad)] border-[var(--bad)] hover:bg-[var(--bg)]",
};

export function FormButton({
  children,
  pendingText,
  variant = "primary",
  disabled,
  title,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: Variant;
  disabled?: boolean;
  title?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const sizing = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title={title}
      aria-disabled={disabled || pending}
      className={`inline-flex items-center gap-1.5 rounded border font-medium disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANT[variant]} ${className}`}
    >
      {pending ? (pendingText ?? "Working...") : children}
    </button>
  );
}
