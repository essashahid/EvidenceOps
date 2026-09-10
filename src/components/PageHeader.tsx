import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight leading-tight">{title}</h1>
        {subtitle ? <div className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, count, actions, id }: { title: ReactNode; count?: number; actions?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-2 mt-6 flex items-center justify-between gap-3 first:mt-0">
      <h2 className="text-sm font-semibold">
        {title}
        {count !== undefined ? <span className="ml-2 font-normal text-[var(--muted)]">{count}</span> : null}
      </h2>
      {actions}
    </div>
  );
}
