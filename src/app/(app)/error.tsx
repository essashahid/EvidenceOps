"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-lg font-semibold text-[var(--bad)]">Something went wrong</h1>
      <p className="mt-2 break-words font-mono text-xs text-[var(--muted)]">{error.message}</p>
      {error.digest ? <p className="mt-1 font-mono text-xs text-[var(--muted)]">digest {error.digest}</p> : null}
      <div className="mt-4 flex justify-center gap-3 text-sm">
        <button type="button" onClick={reset} className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-1.5">
          Try again
        </button>
        <Link href="/" className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-1.5">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
