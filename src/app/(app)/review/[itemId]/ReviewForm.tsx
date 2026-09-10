"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { resolveReviewAction, type ReviewFormState } from "./actions";

type Props = {
  reviewItemId: string;
  fieldPath: string;
  expectedRecordVersionId: string | null;
  initialValue: string;
  valueKind: "text" | "number" | "enum";
  enumValues: readonly string[] | null;
  suggestedValue: string | null;
};

function ActionButton({ action, children, variant, pendingText, title }: { action: string; children: React.ReactNode; variant: "primary" | "secondary" | "danger"; pendingText: string; title?: string }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-[var(--accent)] text-white border-[var(--accent)] hover:opacity-90"
      : variant === "danger"
        ? "bg-[var(--card)] text-[var(--bad)] border-[var(--bad)] hover:bg-[var(--bg)]"
        : "bg-[var(--card)] text-[var(--fg)] border-[var(--line)] hover:bg-[var(--bg)]";
  return (
    <button type="submit" name="action" value={action} disabled={pending} title={title} className={`inline-flex items-center rounded border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
      {pending ? pendingText : children}
    </button>
  );
}

const INPUT = "w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--fg)]";

export function ReviewForm({ reviewItemId, fieldPath, expectedRecordVersionId, initialValue, valueKind, enumValues, suggestedValue }: Props) {
  const [state, formAction] = useActionState<ReviewFormState, FormData>(resolveReviewAction, null);
  const [value, setValue] = useState(initialValue);
  const leaf = fieldPath.replace(/^.*\./, "");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <input type="hidden" name="fieldPath" value={fieldPath} />
      <input type="hidden" name="expectedRecordVersionId" value={expectedRecordVersionId ?? ""} />

      {state?.error ? (
        <div role="alert" className="rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">
          {state.error}
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-2">
          <span>Edited value for Edit &amp; Accept</span>
          <span className="font-mono">{leaf}</span>
          {suggestedValue !== null && suggestedValue !== value ? (
            <button type="button" onClick={() => setValue(suggestedValue)} className="ml-auto rounded border border-[var(--warn)] px-2 py-0.5 text-xs text-[var(--warn)] hover:bg-[var(--bg)]" title="Prefill the edit box with the verifier's corrected value">
              Use this value
            </button>
          ) : null}
        </span>
        {valueKind === "enum" && enumValues ? (
          <select name="newValue" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT}>
            <option value="">choose a value</option>
            {enumValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : valueKind === "number" ? (
          <input name="newValue" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT} />
        ) : (
          <textarea name="newValue" rows={Math.min(6, Math.max(2, Math.ceil(value.length / 80)))} value={value} onChange={(e) => setValue(e.target.value)} className={INPUT} />
        )}
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        Comment (optional, recorded with any action)
        <textarea name="comment" rows={2} className={INPUT} placeholder="Why this decision was made" />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action="accept" variant="primary" pendingText="Accepting..." title="Keep the candidate value as extracted">
          Accept
        </ActionButton>
        <ActionButton action="edit_accept" variant="secondary" pendingText="Saving..." title="Replace the candidate with the edited value and accept">
          Edit &amp; Accept
        </ActionButton>
        <ActionButton action="reject" variant="danger" pendingText="Rejecting..." title="Clear the value; a new record version is created with null">
          Reject
        </ActionButton>
        <ActionButton action="needs_source" variant="secondary" pendingText="Flagging..." title="Leave unresolved and flag the field as lacking source evidence">
          Needs more source
        </ActionButton>
      </div>
    </form>
  );
}
