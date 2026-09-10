import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-[var(--line)] bg-[var(--card)] px-4 py-6 text-center text-sm">
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 text-[var(--muted)]">{children}</div> : null}
    </div>
  );
}
