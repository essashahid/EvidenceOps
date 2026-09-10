import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The single button in the product. Every clickable affordance that looks like a
 * button (including links styled as buttons, via `asChild`) goes through this.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--r-md)] border font-medium transition-[background-color,border-color,color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "border-[var(--accent)] bg-[var(--accent)] text-white shadow-[var(--shadow-sm)] hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)]",
        secondary: "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-sm)] hover:border-[var(--faint)] hover:bg-[var(--surface-hover)]",
        ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg)]",
        danger: "border-[var(--bad-border)] bg-[var(--surface)] text-[var(--bad)] shadow-[var(--shadow-sm)] hover:bg-[var(--bad-soft)]",
        link: "h-auto border-transparent bg-transparent p-0 font-normal text-[var(--accent)] underline-offset-2 hover:underline",
      },
      size: {
        xs: "h-7 px-2 text-[12px]",
        sm: "h-8 px-2.5 text-[13px]",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-10 px-4 text-[14px]",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
