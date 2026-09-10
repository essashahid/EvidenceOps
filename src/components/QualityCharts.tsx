"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const VIZ = { primary: "#1c6259", secondary: "#2c4f86", tertiary: "#8f5510", muted: "#c3ced1", grid: "#e6eaeb", bad: "#9c2c34" };
const AXIS = { fontSize: 11, fill: "#5c6c74" } as const;

const TOOLTIP = {
  contentStyle: { borderRadius: 8, border: "1px solid #e2e6e7", boxShadow: "0 8px 28px rgb(16 32 39 / 0.1)", fontSize: 12, padding: "6px 10px" },
  labelStyle: { color: "#16242c", fontWeight: 600, marginBottom: 2 },
  cursor: { fill: "rgba(28,98,89,0.06)" },
} as const;

export type QualityPoint = { name: string; extraction: number; citations: number; recall: number };

/**
 * Quality trend across evaluation runs. The y-axis is clamped to the region the
 * data actually occupies (with padding) so a healthy, near-flat suite still
 * reads as movement rather than three lines pinned to the top of an empty box.
 */
export function QualityTrend({ data }: { data: QualityPoint[] }) {
  if (data.length === 0) return null;
  const values = data.flatMap((d) => [d.extraction, d.citations, d.recall]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, (max - min) * 0.35);
  const domain: [number, number] = [Math.max(0, Math.floor(min - pad)), Math.min(100, Math.ceil(max + pad))];

  return (
    <div className="h-[196px] w-full min-w-0" role="img" aria-label="Evaluation quality trend across recent runs: extraction accuracy, citation precision and retrieval recall">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 196 }}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={domain} tick={AXIS} axisLine={false} tickLine={false} width={46} tickCount={5} tickFormatter={(v: number) => `${Math.round(v)}%`} />
          <Tooltip {...TOOLTIP} formatter={(v) => `${Number(v).toFixed(1)}%`} />
          <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="extraction" name="Extraction accuracy" stroke={VIZ.primary} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: VIZ.primary }} activeDot={{ r: 4 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="citations" name="Citation precision" stroke={VIZ.secondary} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: VIZ.secondary }} activeDot={{ r: 4 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="recall" name="Retrieval recall@5" stroke={VIZ.tertiary} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: VIZ.tertiary }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--fg)]">{title}</h3>
        {subtitle ? <span className="text-[11px] text-[var(--muted)]">{subtitle}</span> : null}
      </div>
      <div className="h-[184px] min-w-0">{children}</div>
    </div>
  );
}

export function EvaluationCharts({
  comparison,
  distribution,
  failures,
}: {
  comparison: { name: string; baseline?: number; latest: number }[];
  distribution: { name: string; count: number }[];
  failures: { name: string; count: number }[];
}) {
  const failing = failures.filter((f) => f.count > 0);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ChartFrame title="Baseline vs latest" subtitle="%">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 184 }}>
          <BarChart layout="vertical" data={comparison} margin={{ left: 0, right: 16, top: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid horizontal={false} strokeDasharray="2 4" stroke={VIZ.grid} />
            <XAxis type="number" domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={78} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={9} />
            <Bar isAnimationActive={false} name="Baseline" dataKey="baseline" fill={VIZ.muted} radius={[0, 3, 3, 0]} maxBarSize={12} />
            <Bar isAnimationActive={false} name="Latest" dataKey="latest" fill={VIZ.primary} radius={[0, 3, 3, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="Confidence distribution" subtitle="extracted fields">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 184 }}>
          <BarChart layout="vertical" data={distribution} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="2 4" stroke={VIZ.grid} />
            <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={78} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} />
            <Bar isAnimationActive={false} name="Fields" dataKey="count" fill={VIZ.primary} radius={[0, 3, 3, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="Failed cases by category" subtitle={failing.length ? "cases" : undefined}>
        {failing.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <span className="text-[13px] font-medium text-[var(--ok)]">Every case passed</span>
            <span className="text-[12px] text-[var(--muted)]">No failures to break down.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 184 }}>
            <BarChart layout="vertical" data={failing} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} strokeDasharray="2 4" stroke={VIZ.grid} />
              <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={78} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip {...TOOLTIP} />
              <Bar isAnimationActive={false} name="Failed cases" dataKey="count" fill={VIZ.bad} radius={[0, 3, 3, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartFrame>
    </div>
  );
}
