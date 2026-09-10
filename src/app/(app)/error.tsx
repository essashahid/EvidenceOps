"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex justify-center py-16">
      <div className="flex max-w-lg flex-col items-center text-center">
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-[var(--bad-soft)] text-[var(--bad)]">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Something went wrong</h1>
        <p className="mt-1.5 text-[13.5px] leading-6 text-[var(--muted)]">This page could not be rendered. The error below is what the server reported.</p>
        <pre className="scroll-thin mt-4 max-h-40 w-full overflow-auto rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] p-3 text-left font-mono text-[12px] leading-5">
          {error.message}
          {error.digest ? `\n\ndigest ${error.digest}` : ""}
        </pre>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to the overview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
