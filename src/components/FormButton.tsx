"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Submit button wired to the enclosing form's pending state. Shows a spinner and
 * swaps its label so long server actions never look unresponsive.
 */
export function FormButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  disabled,
  title,
  className = "",
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
  title?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} variant={variant} size={size} disabled={disabled || pending} aria-disabled={disabled || pending} title={title} className={className}>
      {pending ? (
        <>
          <Loader2 size={14} aria-hidden className="animate-spin" />
          {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
