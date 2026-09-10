"use client";

import { useActionState } from "react";
import { FormButton } from "@/components/FormButton";
import { retryDeadLetterAction, type RetryState } from "./actions";

export function RetryButton({ runId, documentVersionId, failedStep, canRetry, retryable }: { runId: string; documentVersionId: string; failedStep: string; canRetry: boolean; retryable: boolean }) {
  const [state, action] = useActionState<RetryState, FormData>(retryDeadLetterAction, null);
  const disabled = !canRetry || !retryable;
  const title = !canRetry ? "Only admins can retry failed steps" : !retryable ? "This failure is marked non-retryable" : "Re-run this document from the failed step";
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="documentVersionId" value={documentVersionId} />
      <input type="hidden" name="failedStep" value={failedStep} />
      <span title={title} className="inline-block">
        <FormButton size="sm" variant="secondary" disabled={disabled} title={title} pendingText="Retrying...">
          Retry failed step
        </FormButton>
      </span>
      {state ? <span className={`text-xs ${state.ok ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}>{state.message}</span> : null}
    </form>
  );
}
