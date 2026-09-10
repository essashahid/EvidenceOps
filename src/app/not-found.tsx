import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)] shadow-[var(--shadow-sm)]">
          <FileQuestion size={20} aria-hidden />
        </span>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Not found</h1>
        <p className="mt-1.5 text-[13.5px] leading-6 text-[var(--muted)]">
          The page or record you asked for does not exist in this workspace, or you do not have access to it.
        </p>
        <Button asChild className="mt-5">
          <Link href="/">Back to the overview</Link>
        </Button>
      </div>
    </main>
  );
}
