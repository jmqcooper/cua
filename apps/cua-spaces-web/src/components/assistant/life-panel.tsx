import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

type Call = <T>(action:string,args?:Record<string,unknown>)=>Promise<T>;
type Metric = {source:string;metric:string;unit:string;source_name:string;samples:number;first_at:string;last_at:string};
type Measurement = {start_at:string;value:number|null;value_text:string|null;unit:string;source_name:string;import_id:string};
type Overview = {
  checkedAt:string; metrics:Metric[];
  status:{health_measurements:number;meeting_sources:number;local_transcription:{ready:boolean};inboxes:Record<string,string>;errors:{source:string;error:string}[];sync:Record<string,{state?:string;checked_at?:string;finished_at?:string;errors?:string[]}>};
  meetings:{title:string;account:string;source_url?:string;modified_at:string;slugs:string[]}[];
};
const input="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-brand";
const date=(value?:string)=>value?new Date(value).toLocaleString():"Not yet";
const name=(metric:string)=>metric.replace(/^HK(?:Quantity|Category)TypeIdentifier/,"").replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ");

export function LifePanel({call}:{call:Call}) {
  const [data,setData]=useState<Overview>();
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [series,setSeries]=useState("");
  const [period,setPeriod]=useState("30");
  const [rows,setRows]=useState<Measurement[]>([]);
  const [loading,setLoading]=useState(false);
  const refresh=useCallback(()=>call<Overview>("life.overview").then(d=>{setData(d);setError("");}).catch(e=>setError(String(e.message||e))),[call]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},30000);return()=>clearInterval(timer);},[refresh]);
  const metric=data?.metrics.find(m=>JSON.stringify([m.source,m.metric,m.unit,m.source_name])===series);
  useEffect(()=>{
    let current=true;setRows([]);
    if(!metric)return;
    setLoading(true);
    void call<Measurement[]>("life.measurements",{...metric,...(period!=="all"?{start:new Date(Date.now()-Number(period)*86400000).toISOString()}:{})}).then(r=>{if(current)setRows(r);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[call,metric,period]);
  return <div className="min-h-0 flex-1 overflow-y-auto p-6" data-life-dashboard>
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Sources & health</h2><p className="mt-1 text-xs text-muted-foreground">Last checked {date(data?.checkedAt)}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setBusy(true);setNotice("");void call("life.scan").then(()=>{setNotice("Import requested. This view refreshes every 30 seconds. The worker waits during CS2.");return refresh();}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?<LoaderCircleIcon className="mr-2 size-3 animate-spin"/>:<RefreshCwIcon className="mr-2 size-3"/>}Check for new sources</Button></div>
      {error?<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>:null}
      {notice?<p role="status" className="text-xs text-muted-foreground">{notice}</p>:null}
      {!data&&!error?<p className="text-sm text-muted-foreground">Reading sources on r2d2…</p>:null}
      {data?<>
        <section aria-label="Import status" className="grid gap-4 sm:grid-cols-3">{[["Health measurements",data.status.health_measurements],["Meeting sources",data.status.meeting_sources],["Local transcription",data.status.local_transcription.ready?"Ready":"Unavailable"]].map(([label,value])=><div key={label} className="border-t-2 border-brand/40 pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-medium tabular-nums">{typeof value==="number"?value.toLocaleString():value}</p></div>)}</section>
        {data.status.errors.length?<div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-4 text-sm">{data.status.errors.map((e,i)=><p key={i}><span className="font-medium">{e.source}</span>: {e.error}</p>)}</div>:null}
        <section><h3 className="mb-3 text-sm font-medium">Google Meet</h3><div className="divide-y rounded-xl border">{Object.entries(data.status.sync).filter(([key])=>key.startsWith("google:")).map(([key,state])=><div key={key} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-xs"><span>{key.slice(7)}</span><span className="text-muted-foreground">{state.state==="waiting_for_meet_folder"?"Waiting for a Meet recordings folder":state.state?.replaceAll("_"," ")||"Not checked"}</span></div>)}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">New transcripts in Meet Recordings are archived every 15 minutes. Recording links stay in Drive. Recording must be enabled in Meet.</p>
          {data.meetings.length?<div className="mt-4 divide-y">{data.meetings.map((m,i)=><article key={i} className="py-3"><p className="text-sm font-medium">{m.source_url&&/^https:\/\/(?:docs|drive)\.google\.com\//.test(m.source_url)?<a className="hover:underline" href={m.source_url} target="_blank" rel="noreferrer">{m.title}</a>:m.title}</p><p className="mt-1 text-xs text-muted-foreground">{m.account} · {date(m.modified_at)}</p><p className="mt-1 break-all text-xs text-muted-foreground">{m.slugs.join(", ")}</p></article>)}</div>:<p className="mt-4 text-sm text-muted-foreground">No meeting transcripts imported yet.</p>}
        </section>
        <section><h3 className="text-sm font-medium">Health measurements</h3>{!data.metrics.length?<div className="mt-3 rounded-xl border border-dashed p-6"><p className="text-sm">Waiting for your first health export</p><p className="mt-2 text-xs leading-6 text-muted-foreground">Import Apple Health XML/ZIP or WHOOP CSV/ZIP. This view will show the available measurements, dates and device sources.</p></div>:<>
          <div className="mt-4 flex flex-wrap gap-3"><select aria-label="Health metric and device" className={`${input} min-w-0 max-w-full flex-1`} value={series} onChange={e=>setSeries(e.target.value)}><option value="">Choose a measured series</option>{data.metrics.map(m=><option key={JSON.stringify(m)} value={JSON.stringify([m.source,m.metric,m.unit,m.source_name])}>{name(m.metric)} · {m.unit} · {m.source_name} · {m.source}</option>)}</select><select aria-label="Health period" className={input} value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All dates</option></select></div>
          {metric?<><p className="mt-3 text-xs leading-5 text-muted-foreground">{metric.samples.toLocaleString()} archived samples · {date(metric.first_at)} to {date(metric.last_at)}. Showing the latest {rows.length} matching records, up to 200. Original units retained. WHOOP scores are supplied by WHOOP.</p>{loading?<p className="mt-4 text-sm">Reading measurements…</p>:rows.length?<><MeasurementPlot rows={rows} unit={metric.unit}/><div className="mt-4 max-h-80 overflow-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{["Recorded","Value","Device source","Import source"].map(h=><th key={h} className="border-b px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td className="whitespace-nowrap px-3 py-2">{date(r.start_at)}</td><td className="px-3 py-2 tabular-nums">{r.value??r.value_text} {r.unit}</td><td className="px-3 py-2">{r.source_name}</td><td className="max-w-40 truncate px-3 py-2" title={r.import_id}>{r.import_id}</td></tr>)}</tbody></table></div></>:<p className="mt-4 text-sm text-muted-foreground">No measurements in this period.</p>}</>:null}
        </>}</section>
        <section><h3 className="text-sm font-medium">Import inboxes on r2d2</h3><dl className="mt-3 space-y-3 text-xs">{Object.entries(data.status.inboxes).map(([key,path])=><div key={key} className="grid gap-1 sm:grid-cols-[7rem_1fr]"><dt className="capitalize text-muted-foreground">{key}</dt><dd className="break-all font-mono select-all">{path}</dd></div>)}</dl><details className="mt-4 rounded-xl border p-4 text-xs leading-6"><summary className="cursor-pointer font-medium">Export and import steps</summary><p className="mt-3">Apple Health: open Health on your iPhone, tap your profile picture, then Export All Health Data. Save export.zip.</p><p className="mt-2">WHOOP: More → App Settings → Data Export → Create Export. Download the export from its email link.</p><p className="mt-2">Copy either export into the health inbox above. Put existing meeting transcripts in the transcripts inbox, or audio/video files in audio for local transcription. The originals are preserved. Keep files in place until import finishes.</p><p className="mt-2">Eight Sleep has no data connection yet. Apple and WHOOP imports are file based; they do not continuously sync your devices.</p></details></section>
      </>:null}
    </div>
  </div>;
}

function MeasurementPlot({rows,unit}:{rows:Measurement[];unit:string}) {
  const points=rows.filter(r=>r.value!==null&&Number.isFinite(r.value)&&Number.isFinite(Date.parse(r.start_at))).toReversed();
  if(!points.length)return null;
  const low=Math.min(...points.map(r=>r.value!)),high=Math.max(...points.map(r=>r.value!));
  const first=Date.parse(points[0]!.start_at),last=Date.parse(points.at(-1)!.start_at);
  return <figure className="mt-5 rounded-xl border p-4"><figcaption className="mb-3 text-xs text-muted-foreground">Recorded samples · {unit}</figcaption><svg viewBox="0 0 720 200" role="img" aria-label={`Recorded measurements from ${date(points[0]!.start_at)} to ${date(points.at(-1)!.start_at)}, ${low} to ${high} ${unit}`} className="w-full"><text x="0" y="12" className="fill-muted-foreground text-[10px]">{high.toLocaleString()} {unit}</text><text x="0" y="176" className="fill-muted-foreground text-[10px]">{low.toLocaleString()} {unit}</text><line x1="65" x2="710" y1="180" y2="180" className="stroke-border"/>{points.map((r,i)=><circle key={i} cx={65+(Date.parse(r.start_at)-first)/Math.max(last-first,1)*640} cy={165-(r.value!-low)/Math.max(high-low,1)*145} r="3" className="fill-brand"><title>{date(r.start_at)}: {r.value} {unit} · {r.source_name}</title></circle>)}<text x="65" y="198" className="fill-muted-foreground text-[10px]">{new Date(first).toLocaleDateString()}</text><text x="710" y="198" textAnchor="end" className="fill-muted-foreground text-[10px]">{new Date(last).toLocaleDateString()}</text></svg></figure>;
}
