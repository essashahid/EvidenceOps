"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, CornerDownLeft, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AnswerPart = { kind: "text"; value: string } | { kind: "cite"; value: string; n: number };
export type CiteRef = { n: number; valid: boolean; quote: string; href: string | null; locator: string | null; label: string; claim: string };

/**
 * The answer and its citations, rendered together so that pointing at a
 * citation chip lights up the source it stands on, and vice versa. Everything
 * here is static data; the only state is which citation is being looked at.
 */
export function AnswerView({ parts, refs, plainText }: { parts: AnswerPart[]; refs: CiteRef[]; plainText: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const byN = new Map(refs.map((r) => [r.n, r]));

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is on screen to select */
    }
  }

  return (
    <>
      <div className="p-5">
        <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
          {parts.map((p, i) => {
            if (p.kind === "text") return <span key={i}>{p.value}</span>;
            const ref = byN.get(p.n);
            const on = active === p.n;
            const cls = cn(
              "mx-0.5 inline-flex align-baseline rounded-[var(--r-sm)] border px-1.5 font-mono text-[11.5px] leading-5 transition-colors",
              ref?.valid ? (on ? "border-[var(--sec-ask)] bg-[var(--sec-ask)] text-white" : "border-[var(--sec-ask-border)] bg-[var(--sec-ask-soft)] text-[var(--sec-ask)]") : "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)] line-through",
            );
            const label = `[${p.n}]`;
            const handlers = { onMouseEnter: () => setActive(p.n), onMouseLeave: () => setActive(null), onFocus: () => setActive(p.n), onBlur: () => setActive(null) };
            return ref?.href && ref.valid ? (
              <Link key={i} href={ref.href} title={`Open the cited source: “${ref.quote}”`} className={cls} {...handlers}>
                {label}
              </Link>
            ) : (
              <span key={i} title={ref ? `Source not found: “${ref.quote}”` : p.value} className={cls} tabIndex={0} {...handlers}>
                {label}
              </span>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="xs" onClick={copy} title="Copy the answer as plain text">
            {copied ? <Check size={13} aria-hidden className="text-[var(--ok)]" /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy answer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              const el = document.getElementById("ask-question") as HTMLTextAreaElement | null;
              el?.focus();
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            <CornerDownLeft size={13} aria-hidden />
            Ask a follow-up
          </Button>
        </div>
      </div>

      {refs.length > 0 ? (
        <ol className="divide-y divide-[var(--line)] border-t border-[var(--line)]" aria-label="Citations">
          {refs.map((r) => {
            const on = active === r.n;
            return (
              <li
                key={r.n}
                onMouseEnter={() => setActive(r.n)}
                onMouseLeave={() => setActive(null)}
                className={cn("flex gap-3 px-4 py-2.5 text-[13px] transition-colors", on && "bg-[var(--sec-ask-soft)]/60")}
              >
                <span className={cn("h-fit shrink-0 rounded-[var(--r-sm)] border px-1.5 py-0.5 font-mono text-[11px] transition-colors", r.valid ? (on ? "border-[var(--sec-ask)] bg-[var(--sec-ask)] text-white" : "border-[var(--sec-ask-border)] bg-[var(--sec-ask-soft)] text-[var(--sec-ask)]") : "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)] line-through")}>
                  [{r.n}]
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {r.href ? (
                      <Link href={r.href} className="font-medium transition-colors hover:text-[var(--sec-ask)] hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-[var(--muted)]">{r.label}</span>
                    )}
                    {r.locator ? <span className="font-mono text-[11.5px] text-[var(--muted)]">{r.locator}</span> : null}
                    {!r.valid ? <span className="text-[11.5px] font-medium text-[var(--bad)]">not found in the retrieved text</span> : null}
                  </div>
                  <p className="mt-0.5 flex gap-1.5 text-[var(--muted)]">
                    <Quote size={12} aria-hidden className="mt-1 shrink-0 text-[var(--faint)]" />
                    <span className="italic">{r.quote || r.claim}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </>
  );
}
