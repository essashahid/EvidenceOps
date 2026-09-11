"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, CornerDownLeft, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { AnswerMode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { CheckboxField, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type ModeOption = { value: AnswerMode; label: string; hint: string };
export type Suggestion = { text: string; mode: AnswerMode };

const MAX = 2000;

/**
 * What the system is actually doing while an answer is produced. The steps are
 * real (retrieve, draft, check) and advance on a timer so a slow model still
 * reads as progress rather than a frozen button.
 */
const THINKING = [
  { label: "Retrieving the closest source blocks", icon: Search },
  { label: "Drafting only from what was retrieved", icon: Sparkles },
  { label: "Checking every citation against its source", icon: ShieldCheck },
];

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, THINKING.length - 1)), 1100);
    return () => clearInterval(t);
  }, []);
  return (
    <ol className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4" aria-live="polite" aria-label="Answering">
      {THINKING.map((s, n) => {
        const Icon = s.icon;
        return (
          <li key={s.label} className={cn("flex items-center gap-1.5 text-[12.5px] transition-colors", n < i ? "text-[var(--muted)]" : n === i ? "font-medium text-[var(--fg)]" : "text-[var(--faint)]")}>
            {n < i ? <Check size={13} aria-hidden className="text-[var(--ok)]" /> : n === i ? <Loader2 size={13} aria-hidden className="animate-spin text-[var(--sec-ask)]" /> : <Icon size={13} aria-hidden />}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function Footer({ canAsk, disabled, includeSuperseded }: { canAsk: boolean; disabled: boolean; includeSuperseded: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-2.5 text-[12px] text-[var(--muted)]">
      {pending ? (
        <Thinking />
      ) : (
        <CheckboxField name="includeSuperseded" defaultChecked={includeSuperseded} label="Include superseded versions" title="By default only current document versions are retrieved" />
      )}
      <span className="ml-auto flex items-center gap-3">
        {!canAsk ? <span>Sign in to run a new request.</span> : pending ? null : (
          <span className="hidden items-center gap-1 sm:inline-flex" aria-hidden>
            <kbd className="rounded border border-[var(--line-strong)] bg-[var(--surface)] px-1 font-mono text-[10.5px]">⌘</kbd>
            <kbd className="rounded border border-[var(--line-strong)] bg-[var(--surface)] px-1 font-mono text-[10.5px]">↵</kbd>
            <span className="ml-0.5">to send</span>
          </span>
        )}
        <Button type="submit" disabled={!canAsk || disabled || pending} className="min-w-[96px]">
          {pending ? (
            <>
              <Loader2 size={14} aria-hidden className="animate-spin" />
              Answering…
            </>
          ) : (
            <>
              <Sparkles size={14} aria-hidden />
              Ask
            </>
          )}
        </Button>
      </span>
    </div>
  );
}

export function AskComposer({
  action,
  modes,
  suggestions,
  initialQuestion,
  initialMode,
  includeSuperseded,
  canAsk,
}: {
  action: (formData: FormData) => Promise<void>;
  modes: ModeOption[];
  suggestions: Suggestion[];
  initialQuestion: string;
  initialMode: AnswerMode;
  includeSuperseded: boolean;
  canAsk: boolean;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [mode, setMode] = useState<AnswerMode>(initialMode);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = modes.find((m) => m.value === mode) ?? modes[0];
  const empty = question.trim().length === 0;

  return (
    <form ref={formRef} action={action} className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)] focus-within:border-[var(--sec-ask-border)] focus-within:shadow-[0_0_0_3px_var(--sec-ask-soft)]">
      <div className="p-4">
        <label htmlFor="ask-question" className="sr-only">
          Question or drafting request
        </label>
        <Textarea
          id="ask-question"
          ref={inputRef}
          name="question"
          rows={3}
          required
          maxLength={MAX}
          value={question}
          disabled={!canAsk}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !empty) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          placeholder={mode === "answer" ? "Ask anything the documents can answer…" : `Describe the ${current?.label.toLowerCase()} you need…`}
          className="min-h-[84px] resize-y p-0 text-[15px] leading-6"
          // The form frame carries the focus ring, so the field itself is bare.
          style={{ border: 0, boxShadow: "none", background: "transparent" }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <fieldset className="contents">
            <legend className="sr-only">Mode</legend>
            <div className="inline-flex flex-wrap gap-0.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-0.5">
              {modes.map((m) => (
                <label
                  key={m.value}
                  title={m.hint}
                  className={cn(
                    "cursor-pointer rounded-[var(--r-sm)] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                    mode === m.value ? "bg-[var(--surface)] text-[var(--sec-ask)] shadow-[var(--shadow-sm)]" : "text-[var(--muted)] hover:text-[var(--fg)]",
                  )}
                >
                  <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="sr-only" />
                  {m.label}
                </label>
              ))}
            </div>
          </fieldset>
          <span className="text-[12px] text-[var(--muted)]">{current?.hint}</span>
          <span className={cn("tnum ml-auto text-[11.5px]", question.length > MAX * 0.9 ? "text-[var(--warn)]" : "text-[var(--faint)]")} aria-live="polite">
            {question.length > 0 ? `${question.length} / ${MAX}` : null}
          </span>
        </div>

        {canAsk && suggestions.length > 0 && empty ? (
          <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">Try one of these</div>
            <ul className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <li key={s.text} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(s.text);
                      setMode(s.mode);
                      inputRef.current?.focus();
                    }}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-left text-[12.5px] text-[var(--fg)] transition-colors hover:border-[var(--sec-ask-border)] hover:bg-[var(--sec-ask-soft)] hover:text-[var(--sec-ask)]"
                  >
                    <CornerDownLeft size={11} aria-hidden className="shrink-0 text-[var(--faint)]" />
                    <span className="truncate">{s.text}</span>
                    {s.mode !== "answer" ? <span className="shrink-0 rounded-full bg-[var(--surface-sunken)] px-1.5 text-[10.5px] text-[var(--muted)]">{modes.find((m) => m.value === s.mode)?.label}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Footer canAsk={canAsk} disabled={empty} includeSuperseded={includeSuperseded} />
    </form>
  );
}
