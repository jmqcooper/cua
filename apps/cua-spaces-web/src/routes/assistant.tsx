// SPDX-License-Identifier: FSL-1.1-MIT
// R2D2's subscription-backed assistant, inside the Cua Spaces shell.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpIcon, BotIcon, CheckIcon, CirclePauseIcon, CirclePlayIcon, ClockIcon, LoaderCircleIcon, MonitorIcon, PlusIcon, SearchIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DevicesPanel } from "@/components/assistant/devices-panel";
import { LifePanel } from "@/components/assistant/life-panel";
import { cn } from "@/lib/utils";
import { electronTransport } from "@/bridge/transport";
import type { HostWindow } from "@/bridge/detect";

export const Route = createFileRoute("/assistant")({ component: AssistantPage });

type Thread = { id:string; title:string; provider:string; role:string; session_id:string|null };
type Message = { id:string; role:string; content:string; job_id:string };
type Job = { id:string; thread_id:string; state:string; error:string|null };
type Routine = { id:string; thread_id:string; title:string; every_minutes:number; next_run:number; enabled:number };
type Snapshot = { threads:Thread[]; messages:Message[]; jobs:Job[]; activity:{id:number;job_id:string;name:string;state:string}[]; routines:Routine[]; selectedId:string; paused:boolean; gaming:boolean; desktopBusy:boolean; desktop:{state:string;name:string;reason?:string}; workspace:string };
type Status = { host:string; providers:{id:string;name:string;signedIn:boolean;plan:string}[]; accounts:string[]; googleChecked:boolean; brain:boolean; cuaInstalled:boolean;telegramManagedByHermes:boolean };

export async function assistantCall<T>(action:string,args:Record<string,unknown>={}):Promise<T> {
  const transport=electronTransport(window as HostWindow);
  if(!transport)throw new Error("Open the r2d2 Cua application to use the assistant.");
  const reply=await transport.post({id:crypto.randomUUID(),method:"assistant.call",args:{action,args}}) as {ok:boolean;result:T;error?:{message:string}};
  if(!reply.ok)throw new Error(reply.error?.message||"The assistant could not complete this request.");
  return reply.result;
}

const field="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
const activeStates=new Set(["running","queued"]);

function AssistantPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [status,setStatus]=useState<Status|null>(null);
  const [selected,setSelected]=useState<string>();
  const [error,setError]=useState<string|null>(null);
  const [draft,setDraft]=useState("");
  const [sending,setSending]=useState(false);
  const [creating,setCreating]=useState(false);
  const [tab,setTab]=useState<"chat"|"memory"|"routines"|"sources"|"devices">("chat");
  const [desktopLoading,setDesktopLoading]=useState(false);
  const bottom=useRef<HTMLDivElement>(null);
  const lastMessage=useRef("");
  const refresh=useCallback(async()=>{
    try{const next=await assistantCall<Snapshot>("snapshot",selected?{threadId:selected}:{});setSnapshot(next);setError(null);if(!selected)setSelected(next.selectedId);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
  },[selected]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},1800);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=>{const probe=()=>assistantCall<Status>("status").then(setStatus).catch(()=>{});void probe();const timer=setInterval(()=>void probe(),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const latest=snapshot?.messages.at(-1);const key=latest?`${latest.id}:${latest.content.length}`:"";if(key!==lastMessage.current){bottom.current?.scrollIntoView({behavior:"smooth",block:"end"});lastMessage.current=key;}},[snapshot?.messages]);
  const thread=snapshot?.threads.find(t=>t.id===(selected||snapshot.selectedId));
  const provider=status?.providers.find(p=>p.id===thread?.provider);
  const jobs=snapshot?.jobs.filter(j=>j.thread_id===thread?.id)||[];
  const working=jobs.find(j=>activeStates.has(j.state));
  const run=async(action:string,args:Record<string,unknown>={})=>{try{await assistantCall(action,args);setError(null);await refresh();return true;}catch(e){setError(e instanceof Error?e.message:String(e));return false;}};
  const submit=async(e?:FormEvent)=>{
    e?.preventDefault();if(!draft.trim()||!thread||sending)return;
    setSending(true);const message=draft;
    try{await assistantCall("chat",{threadId:thread.id,message});setDraft("");await refresh();}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSending(false);}
  };
  const desktop=async(start:boolean)=>{
    setDesktopLoading(true);try{await run(start?"desktop.start":"desktop.stop");}finally{setDesktopLoading(false);}
  };

  return <div className="flex h-full min-h-0" data-assistant-page>
    <aside className="flex w-52 shrink-0 flex-col border-r bg-background/80 max-lg:w-44">
      <div className="flex h-16 items-center justify-between border-b px-4"><span className="text-xs font-medium text-muted-foreground">YOUR ASSISTANTS</span><Button variant="ghost" size="icon-sm" aria-label="New assistant" onClick={()=>setCreating(true)}><PlusIcon className="size-4"/></Button></div>
      <div className="flex-1 overflow-y-auto p-2">{snapshot?.threads.map(t=><button key={t.id} onClick={()=>{setSelected(t.id);setTab("chat");}} className={cn("mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/70",thread?.id===t.id&&"bg-brand/10")}>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground",t.provider==="hermes-codex"&&"bg-brand/15 text-brand-strong")}><BotIcon className="size-5"/></span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{t.title}</span><span className="block text-2xs text-muted-foreground">{t.provider==="claude-code"?"Claude Code":"Hermes · Codex"}</span></span>
      </button>)}</div>
      <div className="border-t p-4 text-xs leading-5 text-muted-foreground"><span className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full",snapshot?.gaming?"bg-amber-500":"bg-brand")}/>Running on r2d2</span><span>Continues when this window closes.</span></div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6"><div className="flex items-center gap-3"><h1 className="text-base font-semibold">{thread?.title||"Assistant"}</h1><span className="rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{provider?.plan||"Subscription"}</span></div><Button variant="ghost" size="sm" onClick={()=>void run("pause",{paused:!snapshot?.paused})}>{snapshot?.paused?<CirclePlayIcon className="mr-1.5 size-3.5"/>:<CirclePauseIcon className="mr-1.5 size-3.5"/>}{snapshot?.paused?"Resume queue":"Pause queue"}</Button></header>
      <nav className="flex shrink-0 gap-6 border-b px-6" aria-label="Assistant views">{(["chat","sources","devices","memory","routines"] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={cn("border-b-2 border-transparent py-3 text-xs capitalize text-muted-foreground",tab===t&&"border-brand font-medium text-foreground")}>{t}</button>)}</nav>
      {snapshot?.paused?<div className="border-b border-amber-500/20 bg-amber-500/5 px-6 py-2.5 text-xs text-amber-700 dark:text-amber-400" role="status">{snapshot.gaming?"CS2 is running. Agent work is paused and new messages will wait in the queue.":"New work is paused. Your queued messages are saved."}</div>:null}
      {error?<div className="border-b bg-destructive/5 px-6 py-3 text-xs text-destructive" role="alert">{error}</div>:null}
      {tab==="chat"?<>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7" data-chat-messages>
          {!snapshot?.messages.length?<div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center pb-14 text-center"><div className="mb-5 flex size-16 items-center justify-center rounded-3xl bg-brand/10 text-brand-strong"><BotIcon className="size-8" strokeWidth={1.4}/></div><h2 className="text-xl font-semibold">Your work, with context.</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Talk to {thread?.title||"your assistant"}. Your connected accounts and shared knowledge stay on r2d2.</p><div className="mt-7 flex w-full flex-col gap-2">{["Which Google accounts are connected?","Find recent decisions in my knowledge brain.","Help me plan the next step on a project."].map(s=><button key={s} onClick={()=>setDraft(s)} className="rounded-xl border px-4 py-3 text-left text-xs transition-colors hover:border-brand/40 hover:bg-brand/5">{s}</button>)}</div></div>:snapshot.messages.map(m=><article key={m.id} className={cn("mx-auto mb-7 max-w-3xl",m.role==="user"&&"flex justify-end")} data-message-role={m.role}><div className={cn("max-w-full",m.role==="user"&&"max-w-[85%] rounded-2xl rounded-tr-sm bg-muted px-4 py-3")}>{m.role==="assistant"?<div className="mb-2 flex items-center gap-2 text-xs font-medium text-brand-strong"><BotIcon className="size-3.5"/>{thread?.title}</div>:null}<div className="whitespace-pre-wrap break-words text-sm leading-7">{m.content||<span className="inline-flex items-center gap-2 text-muted-foreground"><LoaderCircleIcon className="size-3 animate-spin"/>Working…</span>}</div></div></article>)}<div ref={bottom}/>
        </div>
        <div className="shrink-0 px-6 pb-5">
          {working?<div className="mx-auto mb-2 flex max-w-3xl items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-2">{working.state==="queued"?<ClockIcon className="size-3.5"/>:<LoaderCircleIcon className="size-3.5 animate-spin"/>}{working.state==="queued"?"Queued":"Working"}{snapshot?.activity.find(a=>a.job_id===working.id)&&working.state==="running"?` · ${snapshot.activity.find(a=>a.job_id===working.id)?.name}`:""}</span><button className="flex items-center gap-1 hover:text-foreground" onClick={()=>void run("jobs.cancel",{id:working.id})}><SquareIcon className="size-2.5"/>Stop</button></div>:null}
          {jobs[0]?.state==="failed"||jobs[0]?.state==="interrupted"?<div className="mx-auto mb-3 max-w-3xl rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{jobs[0].error}<button className="ml-2 underline" onClick={()=>setDraft(snapshot?.messages.filter(m=>m.role==="user").at(-1)?.content||"")}>Review and retry</button></div>:null}
          <form className="mx-auto max-w-3xl rounded-2xl border bg-background shadow-sm focus-within:border-brand/40" onSubmit={e=>void submit(e)}><textarea aria-label="Message your assistant" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void submit();}}} placeholder={snapshot?.paused?"Write a message to queue for later…":"Ask, plan, or give your assistant a task…"} className="max-h-48 min-h-20 w-full resize-y bg-transparent px-4 pt-3 text-sm leading-6 outline-none"/><div className="flex items-center justify-between px-3 pb-3"><span className="flex items-center gap-1.5 pl-1 text-2xs text-muted-foreground">{provider?.signedIn?<CheckIcon className="size-3 text-brand-strong"/>:null}{provider?.signedIn?"Uses your subscription":"Checking subscription sign-in"}</span><Button type="submit" size="icon-sm" aria-label="Send message" disabled={!draft.trim()||sending||!thread||!provider?.signedIn}><ArrowUpIcon className="size-4"/></Button></div></form>
        </div>
      </>:tab==="devices"?<DevicesPanel call={assistantCall}/>:tab==="sources"?<LifePanel call={assistantCall}/>:tab==="memory"?<MemoryPanel/>:<RoutinesPanel routines={snapshot?.routines||[]} thread={thread} onRun={run}/>}
    </section>
    <aside className="hidden w-64 shrink-0 overflow-y-auto border-l bg-muted/15 p-5 lg:block">
      <h2 className="mb-4 text-xs font-medium">Computer</h2><div className="rounded-xl border bg-background p-4"><MonitorIcon className="mb-3 size-6 text-muted-foreground" strokeWidth={1.5}/><div className="text-sm font-medium">Linux desktop</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{desktopLoading||snapshot?.desktopBusy?"Preparing the desktop…":snapshot?.desktop.state==="running"?"Running in its own Cua Space.":"Starts only when needed. Uses up to 3 GB RAM while running."}</div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={desktopLoading||snapshot?.desktopBusy||snapshot?.gaming} onClick={()=>void desktop(snapshot?.desktop.state!=="running")}>{desktopLoading?<LoaderCircleIcon className="mr-1 size-3 animate-spin"/>:null}{snapshot?.desktop.state==="running"?"Stop desktop":"Start desktop"}</Button>{snapshot?.desktop.state==="running"?<Link to="/spaces" className="self-center text-xs text-brand-strong hover:underline">Open Spaces</Link>:null}</div></div>
      <h2 className="mb-3 mt-7 text-xs font-medium">Connections</h2><div className="space-y-3 text-xs"><Connection label="Knowledge brain" ready={status?.brain}/><Connection label="Telegram" ready={status?.telegramManagedByHermes}/>{status?.accounts.map(a=><Connection key={a} label={a} ready={status.googleChecked}/>)}{!status?.accounts.length?<p className="text-muted-foreground">Checking Google connections…</p>:null}</div>
      <h2 className="mb-3 mt-7 text-xs font-medium">Recent activity</h2><div className="space-y-3">{snapshot?.activity.slice(0,8).map(a=><div key={a.id} className="flex gap-2 text-2xs text-muted-foreground">{a.state==="running"?<span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand"/>:<CheckIcon className="mt-0.5 size-3 shrink-0"/>}<span className="min-w-0 break-words">{a.name}</span></div>)}{!snapshot?.activity.length?<p className="text-xs leading-5 text-muted-foreground">Tool activity appears here as your assistant works.</p>:null}</div>
    </aside>
    {creating?<NewAssistant onClose={()=>setCreating(false)} onCreate={async(args)=>{try{const t=await assistantCall<Thread>("threads.create",args);setSelected(t.id);setCreating(false);setTab("chat");}catch(e){setError(e instanceof Error?e.message:String(e));}}}/>:null}
  </div>;
}

function Connection({label,ready}:{label:string;ready?:boolean}){return <div className="flex items-start gap-2"><span className={cn("mt-1 size-1.5 shrink-0 rounded-full",ready?"bg-brand":"bg-muted-foreground/40")}/><span className="min-w-0 break-all text-muted-foreground">{label}</span></div>;}

function NewAssistant({onClose,onCreate}:{onClose:()=>void;onCreate:(args:Record<string,unknown>)=>Promise<void>}){
  const [title,setTitle]=useState("");const [provider,setProvider]=useState("hermes-codex");const [role,setRole]=useState("");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" onClick={onClose}><form role="dialog" aria-modal="true" aria-labelledby="new-assistant-title" className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();void onCreate({title,provider,role});}}><h2 id="new-assistant-title" className="text-lg font-semibold">New assistant</h2><p className="mt-1 text-sm text-muted-foreground">A separate conversation with access to your shared tools.</p><label className="mt-5 block text-xs">Name<input autoFocus className={cn(field,"mt-2")} value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} required/></label><label className="mt-4 block text-xs">Subscription<select className={cn(field,"mt-2")} value={provider} onChange={e=>setProvider(e.target.value)}><option value="hermes-codex">Hermes with Codex</option><option value="claude-code">Claude Code with Claude Max</option></select></label><label className="mt-4 block text-xs">What should it focus on?<textarea className={cn(field,"mt-2 min-h-20")} value={role} onChange={e=>setRole(e.target.value)} maxLength={4000}/></label><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!title.trim()}>Create assistant</Button></div></form></div>;
}

function MemoryPanel(){
  const [query,setQuery]=useState("");const [result,setResult]=useState<{facts?:{fact:string;provenance?:string}[];results?:{slug?:string;title?:string;content?:string;excerpt?:string}[]}|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  return <div className="min-h-0 flex-1 overflow-y-auto p-6"><div className="mx-auto max-w-2xl"><h2 className="text-lg font-semibold">Shared knowledge</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Search the same GBrain used by your assistant and coding agents. Original sources stay on r2d2.</p><form className="mt-6 flex gap-2" onSubmit={e=>{e.preventDefault();setBusy(true);setError("");void assistantCall<typeof result>("brain.search",{query}).then(setResult).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><input className={field} aria-label="Search shared knowledge" placeholder="People, projects, decisions…" value={query} onChange={e=>setQuery(e.target.value)}/><Button disabled={busy||!query.trim()} aria-label="Search">{busy?<LoaderCircleIcon className="size-4 animate-spin"/>:<SearchIcon className="size-4"/>}</Button></form>{error?<p className="mt-4 text-sm text-destructive">{error}</p>:null}<div className="mt-6 space-y-4">{result?.facts?.map((f,i)=><article key={i} className="rounded-xl border p-4"><p className="whitespace-pre-wrap text-sm leading-6">{f.fact}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">{f.provenance}</p></article>)}{result?.results?.map((r,i)=><article key={i} className="rounded-xl border p-4"><h3 className="text-sm font-medium">{r.title||r.slug}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{r.excerpt||r.content}</p></article>)}{result&&!result.facts?.length&&!result.results?.length?<p className="text-sm text-muted-foreground">No saved evidence matched this search.</p>:null}</div></div></div>;
}

function RoutinesPanel({routines,thread,onRun}:{routines:Routine[];thread?:Thread;onRun:(action:string,args:Record<string,unknown>)=>Promise<boolean>}){
  const [title,setTitle]=useState("");const [prompt,setPrompt]=useState("");const [minutes,setMinutes]=useState(1440);
  return <div className="min-h-0 flex-1 overflow-y-auto p-6"><div className="mx-auto max-w-2xl"><h2 className="text-lg font-semibold">Routines</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Saved on r2d2 and run while the app is closed. Routines wait during gaming and use the selected assistant's subscription.</p><div className="mt-6 space-y-3">{routines.map(r=><article key={r.id} className="flex items-center justify-between rounded-xl border p-4"><div><h3 className="text-sm font-medium">{r.title}</h3><p className="mt-1 text-xs text-muted-foreground">Every {r.every_minutes} minutes · {r.enabled?`Next ${new Date(r.next_run).toLocaleString()}`:"Paused"}</p></div><Button size="sm" variant="outline" onClick={()=>void onRun("routines.toggle",{id:r.id,enabled:!r.enabled})}>{r.enabled?"Pause":"Enable"}</Button></article>)}</div><form className="mt-7 space-y-4 rounded-xl border p-5" onSubmit={e=>{e.preventDefault();if(thread)void onRun("routines.add",{threadId:thread.id,title,prompt,minutes}).then(ok=>{if(ok){setTitle("");setPrompt("");}});}}><h3 className="text-sm font-medium">Add a routine for {thread?.title}</h3><input className={field} aria-label="Routine title" placeholder="Routine name" value={title} onChange={e=>setTitle(e.target.value)} required/><textarea className={cn(field,"min-h-24")} aria-label="Routine instructions" placeholder="What should your assistant do?" value={prompt} onChange={e=>setPrompt(e.target.value)} required/><label className="flex items-center gap-3 text-xs text-muted-foreground">Repeat every<input type="number" className={cn(field,"w-28")} aria-label="Routine interval in minutes" min={5} max={10080} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/>minutes</label><Button type="submit" disabled={!thread||!title.trim()||!prompt.trim()}>Save routine</Button></form></div></div>;
}
