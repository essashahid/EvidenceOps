"use client";

import { useActionState } from "react";
import { FormButton } from "@/components/FormButton";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/panel";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, { error: initialError });
  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="login-email">
        <Input id="login-email" name="email" type="email" required autoComplete="username" autoFocus placeholder="you@example.com" />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <Input id="login-password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
      </Field>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <FormButton pendingText="Signing in…" className="mt-1 w-full">
        Sign in
      </FormButton>
    </form>
  );
}
