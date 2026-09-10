"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Field, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { resolveReviewAction, type ReviewFormState } from "./actions";

type Props = {
  reviewItemId: string;
  fieldPath: string;
  expectedRecordVersionId: string | null;
  initialValue: string;
  valueKind: "text" | "number" | "enum" | "json";
  enumValues: readonly string[] | null;
  suggestedValue: string | null;
};

/** Keyboard hint rendered next to an action. */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 rounded border border-current/25 px-1 text-[10px] font-semibold uppercase opacity-70">{children}</kbd>;
}

function ActionButton({ action, children, variant, pendingText, title, shortcut }: { action: string; children: React.ReactNode; variant: "primary" | "secondary" | "danger"; pendingText: string; title?: string; shortcut?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="action" value={action} variant={variant} size="md" disabled={pending} title={title} data-review-action={action}>
      {pending ? (
        <>
          <Loader2 size={14} aria-hidden className="animate-spin" />
          {pendingText}
        </>
      ) : (
        <>
          {children}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </>
      )}
    </Button>
  );
}

export function ReviewForm({ reviewItemId, fieldPath, expectedRecordVersionId, initialValue, valueKind, enumValues, suggestedValue }: Props) {
  const [state, formAction] = useActionState<ReviewFormState, FormData>(resolveReviewAction, null);
  const [value, setValue] = useState(initialValue);
  const formRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>(null);
  const leaf = fieldPath.replace(/^.*\./, "");

  /**
   * Queue shortcuts (spec: A accept, E edit, R reject). They stay inert while the
   * reviewer is typing so a comment never triggers a decision.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === "e") {
        e.preventDefault();
        editRef.current?.focus();
        return;
      }
      if (key === "a" || key === "r") {
        const action = key === "a" ? "accept" : "reject";
        const button = formRef.current?.querySelector<HTMLButtonElement>(`[data-review-action="${action}"]`);
        if (button) {
          e.preventDefault();
          button.click();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const editorId = "review-edited-value";

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <input type="hidden" name="fieldPath" value={fieldPath} />
      <input type="hidden" name="expectedRecordVersionId" value={expectedRecordVersionId ?? ""} />

      {state?.error ? <Notice tone="bad">{state.error}</Notice> : null}

      <Field
        htmlFor={editorId}
        label={
          <span className="flex w-full items-center gap-2">
            <span>Edited value</span>
            <span className="font-mono text-[11px] text-[var(--faint)]">{leaf}</span>
            {suggestedValue !== null && suggestedValue !== value ? (
              <button
                type="button"
                onClick={() => setValue(suggestedValue)}
                className="ml-auto rounded-[var(--r-sm)] border border-[var(--warn-border)] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--warn)] transition-colors hover:brightness-98"
                title="Prefill the editor with the verifier's corrected value"
              >
                Use verifier value
              </button>
            ) : null}
          </span>
        }
        hint={valueKind === "json" ? "List items are edited as JSON objects." : undefined}
      >
        {valueKind === "enum" && enumValues ? (
          <select id={editorId} ref={editRef as React.Ref<HTMLSelectElement>} name="newValue" value={value} onChange={(e) => setValue(e.target.value)} className="w-full px-2.5 py-1.5">
            <option value="">Choose a value</option>
            {enumValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : valueKind === "number" ? (
          <input id={editorId} ref={editRef as React.Ref<HTMLInputElement>} name="newValue" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="w-full px-2.5 py-1.5" />
        ) : (
          <Textarea
            id={editorId}
            ref={editRef as React.Ref<HTMLTextAreaElement>}
            name="newValue"
            rows={valueKind === "json" ? 6 : Math.min(6, Math.max(2, Math.ceil(value.length / 60)))}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cn(valueKind === "json" && "font-mono text-[12px] leading-5")}
          />
        )}
      </Field>

      <Field label="Comment" hint="Recorded with whichever action you take.">
        <Textarea name="comment" rows={2} placeholder="Why this decision was made" />
      </Field>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        <ActionButton action="accept" variant="primary" pendingText="Accepting…" shortcut="A" title="Keep the candidate value as extracted">
          Accept
        </ActionButton>
        <ActionButton action="edit_accept" variant="secondary" pendingText="Saving…" shortcut="E" title="Replace the candidate with the edited value and accept">
          Edit &amp; accept
        </ActionButton>
        <ActionButton action="reject" variant="danger" pendingText="Rejecting…" shortcut="R" title="Clear the value; a new record version is created with null">
          Reject
        </ActionButton>
        <ActionButton action="needs_source" variant="secondary" pendingText="Flagging…" title="Leave unresolved and flag the field as lacking source evidence">
          Needs source
        </ActionButton>
      </div>
    </form>
  );
}
