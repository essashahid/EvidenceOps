"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Blocks, BookOpenCheck, FileText, LayoutDashboard, ListChecks, MessagesSquare, Upload } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { FormButton } from "@/components/FormButton";
const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/review", label: "Review queue", icon: ListChecks },
  { href: "/rag", label: "Ask & draft", icon: MessagesSquare },
  { href: "/evals", label: "Evaluations", icon: BookOpenCheck },
  { href: "/runs", label: "Run activity", icon: Activity },
  { href: "/upload", label: "Upload", icon: Upload },
];
export function AppNav({ email, role, workspaceName, isPublic, signOutAction }: { email: string; role: string; workspaceName: string; isPublic?: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return <header className="border-b border-[var(--line)] bg-[var(--card)]">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:block focus:p-3">Skip to content</a>
    <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight"><span className="grid size-9 place-items-center rounded-lg bg-[var(--accent)] text-white"><Blocks size={20} aria-hidden /></span><span className="text-lg">EvidenceOps<span className="ml-2 rounded border border-[var(--line)] px-1.5 py-0.5 align-middle text-[10px] font-medium tracking-wider text-[var(--muted)]">WORKBENCH</span></span></Link>
      <div className="flex items-center gap-3 text-xs text-[var(--muted)]"><span className="hidden lg:block">{workspaceName}</span><span className="max-w-[210px] truncate">{email}</span><StatusBadge status={role} />{isPublic ? <Link href="/login" className="rounded-md border border-[var(--line)] px-3 py-2 font-medium text-[var(--fg)]">Sign in</Link> : <form action={signOutAction}><FormButton variant="secondary" size="sm">Sign out</FormButton></form>}</div>
    </div>
    <nav aria-label="Main navigation" className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-5 sm:px-8">{LINKS.map(({ href, label, icon: Icon }) => { const active = href === "/" ? pathname === href : pathname.startsWith(href) || (href === "/rag" && pathname === "/ask"); return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${active ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}><Icon size={16} aria-hidden />{label}</Link>; })}</nav>
  </header>;
}
