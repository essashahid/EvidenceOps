"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type GuideStep = { key: string; label: string; detail: string; href: string; done: boolean };

/**
 * A five-step guide that ticks itself off from real data. It hides once every
 * step is done or the user dismisses it; the dismissal is remembered per
 * workspace in this browser only.
 */
const CHANGE = "eo:guide-change";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE, cb);
  };
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function GettingStarted({ steps, storageKey }: { steps: GuideStep[]; storageKey: string }) {
  // localStorage is read as an external store: null on the server, the real value on the client.
  const stored = useSyncExternalStore(
    subscribe,
    () => readDismissed(storageKey),
    () => null,
  );
  const [hiddenNow, setHiddenNow] = useState(false);
  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;

  // Render nothing until the stored preference is known, so the guide never flashes.
  if (stored === null || stored || hiddenNow || complete) return null;

  const next = steps.find((s) => !s.done);

  return (
    <section aria-labelledby="guide-title" className="mb-6 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id="guide-title" className="text-[13.5px] font-semibold">
            Getting started
          </h2>
          <span className="tnum text-[12px] text-[var(--muted)]">
            {done} of {steps.length} done
          </span>
          <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-sunken)] sm:block" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(storageKey, "1");
              window.dispatchEvent(new Event(CHANGE));
            } catch {
              /* storage unavailable: hide for this view only */
            }
            setHiddenNow(true);
          }}
          className="inline-flex h-7 items-center gap-1 rounded-[var(--r-md)] px-2 text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--fg)]"
          title="Hide this guide"
        >
          <X size={13} aria-hidden />
          Hide
        </button>
      </div>
      <ol className="grid gap-px bg-[var(--line)] sm:grid-cols-5">
        {steps.map((s, i) => {
          const isNext = next?.key === s.key;
          return (
            <li key={s.key} className="bg-[var(--surface)]">
              <Link
                href={s.href}
                aria-current={isNext ? "step" : undefined}
                className={cn("flex h-full gap-2.5 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]", isNext && "bg-[var(--accent-soft)]/60 hover:bg-[var(--accent-soft)]")}
              >
                <span
                  className={cn(
                    "mt-px grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    s.done ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]" : isNext ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line-strong)] text-[var(--muted)]",
                  )}
                  aria-hidden
                >
                  {s.done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("flex items-center gap-1 text-[13px] font-medium", s.done && "text-[var(--muted)] line-through decoration-[var(--line-strong)]")}>
                    {s.label}
                    {isNext ? <ArrowRight size={12} aria-hidden className="text-[var(--accent)]" /> : null}
                  </span>
                  <span className="block text-[12px] leading-4 text-[var(--muted)]">{s.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
