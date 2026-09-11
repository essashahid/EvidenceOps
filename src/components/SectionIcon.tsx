import { HUE, SECTIONS, type Hue, type SectionKey } from "@/lib/sections";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE = {
  sm: { tile: "size-7 rounded-[var(--r-md)]", icon: 14 },
  md: { tile: "size-9 rounded-[var(--r-lg)]", icon: 17 },
  lg: { tile: "size-11 rounded-[var(--r-lg)]", icon: 20 },
} as const;

/** A tinted tile that gives a page or card its section identity. */
export function SectionIcon({ section, icon, hue, size = "md", className = "" }: { section?: SectionKey; icon?: LucideIcon; hue?: Hue; size?: keyof typeof SIZE; className?: string }) {
  const s = section ? SECTIONS[section] : null;
  const Icon = icon ?? s?.icon;
  const h = HUE[hue ?? s?.hue ?? "accent"];
  if (!Icon) return null;
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center border", SIZE[size].tile, h.soft, h.border, h.fg, className)}>
      <Icon size={SIZE[size].icon} strokeWidth={2} />
    </span>
  );
}
