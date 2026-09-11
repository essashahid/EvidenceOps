import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { HUE } from "@/lib/sections";
import type { NextAction, Stage } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The product's flow as one row: upload → extract → review → ask → evaluate.
 * Each stage is a link carrying the number that matters and a state, so the
 * strip answers "where are we, and what is waiting" without a paragraph.
 */
export function WorkflowStrip({ stages, className = "" }: { stages: Stage[]; className?: string }) {
  return (
    <ol className={cn("scroll-thin flex min-w-0 gap-2 overflow-x-auto pb-1", className)} aria-label="Workflow">
      {stages.map((s, i) => {
        const h = HUE[s.hue];
        const Icon = s.icon;
        return (
          <li key={s.key} className="flex min-w-[168px] flex-1 items-stretch gap-2">
            <Link
              href={s.href}
              className={cn(
                "group flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--r-lg)] border bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-[var(--shadow-md)]",
                s.state === "attention" ? h.border : "border-[var(--line)]",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className={cn("grid size-7 place-items-center rounded-[var(--r-md)] border", h.soft, h.border, h.fg)}>
                    <Icon size={14} aria-hidden strokeWidth={2.1} />
                  </span>
                  <span className="text-[12.5px] font-semibold">{s.label}</span>
                </span>
                <StateMark state={s.state} hueFg={h.fg} />
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className={cn("tnum text-[22px] font-semibold leading-7 tracking-[-0.02em]", s.state === "attention" ? h.fg : "text-[var(--fg)]")}>{s.value}</span>
              </span>
              <span className="truncate text-[12px] leading-4 text-[var(--muted)]">{s.caption}</span>
            </Link>
            {i < stages.length - 1 ? <ArrowRight size={14} aria-hidden className="mt-4 shrink-0 self-start text-[var(--faint)]" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function StateMark({ state, hueFg }: { state: Stage["state"]; hueFg: string }) {
  if (state === "done") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]" title="Done">
        <Check size={12} aria-hidden strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--info)]" title="Running">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
        Live
      </span>
    );
  }
  if (state === "attention") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", hueFg)} title="Needs attention">
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        Waiting
      </span>
    );
  }
  return <span className="size-1.5 rounded-full bg-[var(--line-strong)]" title="Not started" />;
}

/** The one recommended action, sized to be noticed. */
export function NextActionCard({ action, className = "" }: { action: NextAction; className?: string }) {
  const h = HUE[action.hue];
  return (
    <div className={cn("flex flex-col justify-between gap-3 rounded-[var(--r-lg)] border p-4 shadow-[var(--shadow-sm)]", h.border, h.soft, className)}>
      <div>
        <div className={cn("mb-1 text-[11px] font-semibold uppercase tracking-[0.06em]", h.fg)}>Next up</div>
        <div className="text-[15px] font-semibold leading-5">{action.title}</div>
        <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">{action.body}</p>
      </div>
      <Button asChild variant={action.kind === "act" ? "primary" : "secondary"} size="md" className="self-start">
        <Link href={action.href}>
          {action.cta}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
