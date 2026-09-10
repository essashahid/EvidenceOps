import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">The page or record you asked for does not exist in this workspace.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-[var(--accent)] underline">
        Back to dashboard
      </Link>
    </main>
  );
}
