import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoaderCircleIcon, SmartphoneIcon } from "lucide-react";

type Call=<T>(action:string,args?:Record<string,unknown>)=>Promise<T>;
type Devices={devices:{device:string;host:string;running:boolean;owned:boolean}[];ios_error?:string;gaming:boolean;idle_stop_minutes:number};
export function DevicesPanel({call}:{call:Call}) {
  const [state,setState]=useState<Devices>();
  const [device,setDevice]=useState("android-phone");
  const [app,setApp]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [image,setImage]=useState("");
  const refresh=useCallback(()=>call<Devices>("mobile.status").then(s=>{setState(s);setError("");}).catch(e=>setError(e.message)),[call]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},30000);return()=>clearInterval(timer);},[refresh]);
  const run=async(action:string,args:Record<string,unknown>)=>{setBusy(true);setError("");try{const result=await call<{image?:string}>(action,args);if(result.image)setImage(result.image);else setImage("");await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="min-h-0 flex-1 overflow-y-auto p-6" data-mobile-panel><div className="mx-auto max-w-3xl">
    <h2 className="text-lg font-semibold">On-demand devices</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Android runs on r2d2. iPhone and iPad use your Mac while it is awake. Your assistant can open apps, read controls, type, tap and take screenshots.</p>
    {error?<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>:null}{state?.ios_error?<p className="mt-4 text-sm text-destructive">Mac connection: {state.ios_error}</p>:null}
    <div className="mt-6 grid gap-3 sm:grid-cols-2">{state?.devices.map(d=><button key={d.device} disabled={busy} onClick={()=>{setDevice(d.device);setImage("");}} className={`rounded-xl border p-4 text-left ${device===d.device?"border-brand bg-brand/5":""}`}><SmartphoneIcon className="mb-3 size-5 text-muted-foreground"/><span className="block text-sm font-medium">{d.device.replaceAll("-"," ")}</span><span className="mt-1 block text-xs text-muted-foreground">{d.host} · {d.running?(d.owned?"Running for this assistant":"In use outside this assistant"):"Off"}</span></button>)}</div>
    <form className="mt-6 rounded-xl border p-5" onSubmit={e=>{e.preventDefault();void run("mobile.open",{device,app});}}><label className="block text-xs font-medium" htmlFor="mobile-app">App ID or URL for {device}</label><input id="mobile-app" className="mt-3 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-brand" value={app} onChange={e=>setApp(e.target.value)} placeholder={device.startsWith("android")?"http://10.0.2.2:5173":"http://127.0.0.1:15173"} disabled={busy}/><div className="mt-4 flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy||!app.trim()||state?.gaming}>{busy?<LoaderCircleIcon className="mr-2 size-3 animate-spin"/>:null}Open app</Button><Button type="button" size="sm" variant="outline" disabled={busy||!state?.devices.find(d=>d.device===device)?.owned} onClick={()=>void run("mobile.screenshot",{device})}>Screenshot</Button><Button type="button" size="sm" variant="outline" disabled={busy||!state?.devices.find(d=>d.device===device)?.owned} onClick={()=>void run("mobile.close",{device})}>Stop device</Button></div><p className="mt-3 text-xs leading-5 text-muted-foreground">Booting can take a few minutes. Close the device after a task. Assistant-owned devices also stop after 15 idle minutes and during CS2.</p></form>
    {image?<figure className="mt-6"><img src={`data:image/png;base64,${image}`} alt={`Current app on ${device}`} className="mx-auto max-h-[650px] max-w-full rounded-xl border object-contain"/><figcaption className="mt-2 text-center text-xs text-muted-foreground">Captured on request. Ask in Chat to interact with the app.</figcaption></figure>:null}
    <details className="mt-6 text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Development server addresses</summary><p className="mt-2">Android: http://10.0.2.2:3000 or :5173 or :8081</p><p>iOS: http://127.0.0.1:13000 → r2d2:3000, :15173 → :5173, :18081 → :8081.</p><p className="mt-2">Devices already running outside this assistant are left with their current task. Your physical phone is not exposed by these tools.</p></details>
  </div></div>;
}
