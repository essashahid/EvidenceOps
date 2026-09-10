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
  return <span className="text-xs text-[var(--muted)]">Auto-refreshing every {Math.round(intervalMs / 1000)} s</span>;
}
