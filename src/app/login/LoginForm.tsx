"use client";

import { useActionState } from "react";
import { FormButton } from "@/components/FormButton";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, { error: initialError });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full rounded border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>
      {state.error ? (
        <div role="alert" className="rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-2.5 py-1.5 text-sm text-[var(--bad)]">
          {state.error}
        </div>
      ) : null}
      <FormButton pendingText="Signing in..." className="w-full justify-center">
        Sign in
      </FormButton>
    </form>
  );
}
