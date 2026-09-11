import Link from "next/link";
import { ArrowRight, GitBranch, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { getWorkflowSnapshot } from "@/lib/queries/workflow";
import { buildStages } from "@/lib/workflow";
import { HUE, NAV_ORDER, SECTIONS } from "@/lib/sections";
import { PageHeader } from "@/components/PageHeader";
import { WorkflowStrip } from "@/components/WorkflowStrip";
import { PipelineExplainer } from "@/components/PipelineExplainer";
import { SectionIcon } from "@/components/SectionIcon";
import { Panel, PanelBody, PanelHeader, SectionTitle } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PRINCIPLES = [
  { icon: ShieldCheck, title: "No citation, no value", body: "Every extracted field and every sentence in an answer must point at a source block and quote it. Quotes are checked verbatim in code." },
  { icon: UserCheck, title: "A second model checks the first", body: "An independent verifier re-reads the evidence without seeing the extractor's confidence, so agreement means something." },
  { icon: GitBranch, title: "Code scores, people decide", body: "Confidence is a weighted sum of five measured components, never a model's opinion. Below the bar, a human decides." },
  { icon: Lock, title: "Nothing is overwritten", body: "Uploads, records and decisions create new versions. You can always see what changed, when, and on what evidence." },
];

const SHORTCUTS = [
  { keys: ["A"], where: "Review item", does: "Accept the candidate value" },
  { keys: ["E"], where: "Review item", does: "Jump to the editor to correct it" },
  { keys: ["R"], where: "Review item", does: "Reject the value" },
  { keys: ["⌘", "↵"], where: "Ask & draft", does: "Send the question" },
];

export default async function HowItWorksPage() {
  const { workspace } = await requireWorkspace();
  const snapshot = await getWorkflowSnapshot(workspace.workspaceId);
  const stages = buildStages(snapshot);

  return (
    <>
      <PageHeader section="help" title="How EvidenceOps works" subtitle="Five stages, four rules, and where each thing lives. The strip below is live: it reflects this workspace right now." />

      <SectionTitle title="The flow" description="Work moves left to right. Each stage links to its screen." />
      <WorkflowStrip stages={stages} className="mb-7" />

      <div className="mb-7 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="What happens to a document" description="After the upload, in the order it happens." />
          <PanelBody>
            <PipelineExplainer columns={2} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="The four rules" description="These are enforced in code, not in a prompt." />
          <ul className="divide-y divide-[var(--line)]">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <p.icon size={14} aria-hidden strokeWidth={2.1} />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold">{p.title}</span>
                  <span className="block text-[12.5px] leading-5 text-[var(--muted)]">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <SectionTitle title="Where things live" description="Every area of the product and what it is for." />
      <ul className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAV_ORDER.filter((k) => k !== "overview").map((k) => {
          const s = SECTIONS[k];
          const h = HUE[s.hue];
          return (
            <li key={k}>
              <Link href={s.href} className="group flex h-full gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-md)]">
                <SectionIcon section={k} size="md" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                    {s.label}
                    <ArrowRight size={13} aria-hidden className={cn("opacity-0 transition-opacity group-hover:opacity-100", h.fg)} />
                  </span>
                  <span className="block text-[12.5px] leading-5 text-[var(--muted)]">{s.blurb}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Panel>
        <PanelHeader dense title="Keyboard" />
        <ul className="divide-y divide-[var(--line)]">
          {SHORTCUTS.map((s) => (
            <li key={s.keys.join("+") + s.where} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="flex w-16 gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="rounded border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-1.5 font-mono text-[11px] font-semibold">
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="w-28 text-[var(--muted)]">{s.where}</span>
              <span>{s.does}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
