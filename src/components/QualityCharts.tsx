"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export type QualityPoint = { name: string; extraction: number; citations: number; recall: number };
export function QualityTrend({ data }: { data: QualityPoint[] }) {
  if (!data.length) return <p className="rounded-lg border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">Quality trends appear after the first evaluation.</p>;
  return <div className="rounded-lg border border-[var(--line)] bg-white p-4"><div className="mb-4 flex items-baseline justify-between"><h2 className="text-sm font-semibold">Quality over time</h2><span className="text-xs text-[var(--muted)]">Measured evaluation runs · %</span></div><div className="h-64 min-w-0" role="img" aria-label="Evaluation quality trend for extraction accuracy, citation precision and retrieval recall"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:600,height:256}}><AreaChart data={data} margin={{top:8,right:12,left:-22,bottom:0}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3eaef" /><XAxis dataKey="name" tick={{fontSize:11}} axisLine={false} tickLine={false}/><YAxis domain={[0,100]} tick={{fontSize:11}} axisLine={false} tickLine={false}/><Tooltip/><Legend iconType="circle" wrapperStyle={{fontSize:12}}/><Area isAnimationActive={false} type="linear" dataKey="extraction" name="Extraction" stroke="#236b63" fill="#236b63" fillOpacity={0.04} strokeWidth={2} dot={{r:3}}/><Area isAnimationActive={false} type="linear" dataKey="citations" name="Citation precision" stroke="#536bad" fill="transparent" strokeWidth={2} dot={{r:3}}/><Area isAnimationActive={false} type="linear" dataKey="recall" name="Recall@5" stroke="#b57827" fill="transparent" strokeWidth={2} dot={{r:3}}/></AreaChart></ResponsiveContainer></div></div>;
}
export function EvaluationCharts({ comparison, distribution, failures }: { comparison: { name:string; baseline?:number; latest:number }[]; distribution:{name:string;count:number}[]; failures:{name:string;count:number}[] }) {
  const charts = [
    { title: "Baseline vs latest · %", data: comparison },
    { title: "Confidence distribution · fields", data: distribution },
    { title: "Failed cases by category", data: failures.filter(item => item.count > 0) },
  ];
  return <div className="my-5 grid gap-4 lg:grid-cols-3">{charts.map((chart, index) => <div key={chart.title} className="rounded-lg border border-[var(--line)] bg-white p-4">
    <h2 className="mb-4 text-sm font-semibold">{chart.title}</h2>
    <div className="h-52" role="img" aria-label={chart.title}>
      {!chart.data.length ? <p className="pt-16 text-center text-sm text-[var(--muted)]">No failed cases</p> : <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:360,height:208}}>
        <BarChart layout="vertical" data={chart.data as {name:string;baseline?:number;latest?:number;count?:number}[]} margin={{left:0,right:18,bottom:0}}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e3eaef"/>
          <XAxis type="number" domain={index === 0 ? [0,100] : [0,"auto"]} allowDecimals={false} tick={{fontSize:10}}/>
          <YAxis type="category" dataKey="name" width={83} tick={{fontSize:11}} tickLine={false} axisLine={false}/>
          <Tooltip/>
          {index === 0 ? <><Legend wrapperStyle={{fontSize:11}}/><Bar isAnimationActive={false} name="Baseline" dataKey="baseline" fill="#bacdd8" radius={[0,3,3,0]}/><Bar isAnimationActive={false} name="Latest" dataKey="latest" fill="#236b63" radius={[0,3,3,0]}/></> : <Bar isAnimationActive={false} name="Count" dataKey="count" fill={index===2?"#ad6143":"#236b63"} radius={[0,3,3,0]}/>}
        </BarChart>
      </ResponsiveContainer>}
    </div>
  </div>)}</div>;
}
