"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Calls router.refresh() on an interval while `active` is true. */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--info-border)] bg-[var(--info-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--info)]">
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      Live, refreshing every {Math.round(intervalMs / 1000)} s
    </span>
  );
}
