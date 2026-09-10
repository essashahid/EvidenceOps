import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { FormButton } from "@/components/FormButton";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/documents", label: "Documents" },
  { href: "/review", label: "Review" },
  { href: "/ask", label: "Ask" },
  { href: "/runs", label: "Runs" },
  { href: "/evals", label: "Evals" },
];

export function AppNav({ email, role, workspaceName, signOutAction }: { email: string; role: string; workspaceName: string; signOutAction: () => Promise<void> }) {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--card)]">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2">
        <Link href="/" className="text-sm font-semibold tracking-tight text-[var(--accent)]">
          EvidenceOps
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded px-2 py-1 text-[var(--fg)] hover:bg-[var(--bg)]">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted)]">
          <span className="hidden sm:inline" title="workspace">
            {workspaceName}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--fg)]">{email}</span>
            <StatusBadge status={role} />
          </span>
          <form action={signOutAction}>
            <FormButton variant="secondary" size="sm" pendingText="Signing out...">
              Sign out
            </FormButton>
          </form>
        </div>
      </div>
    </header>
  );
}
