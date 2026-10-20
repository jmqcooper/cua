import {createServer} from "node:http";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it} from "vitest";
import {assistantMethods} from "../src/bridge/assistant";
import type {BridgeContext} from "../src/bridge/context";

const saved=process.env.CUA_ASSISTANT_SOCKET;
afterEach(()=>{if(saved)process.env.CUA_ASSISTANT_SOCKET=saved;else delete process.env.CUA_ASSISTANT_SOCKET;});

it.skipIf(process.platform!=="linux")("carries assistant requests over a private socket and propagates controller failures",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"cua-assistant-bridge-"));
  const path=join(dir,"assistant.sock");process.env.CUA_ASSISTANT_SOCKET=path;
  const server=createServer(async(req,res)=>{
    let body="";for await(const c of req)body+=c;
    const input=JSON.parse(body);
    expect(req.url).toBe("/call");expect(req.method).toBe("POST");
    res.end(JSON.stringify(input.action==="status"?{ok:true,result:{host:"r2d2"}}:{ok:false,error:"Desktop is paused for CS2"}));
  });
  await new Promise<void>(r=>server.listen(path,r));
  try{
    const handler=assistantMethods({} as BridgeContext)["assistant.call"]!;
    await expect(handler({action:"status"},{})).resolves.toEqual({host:"r2d2"});
    await expect(handler({action:"desktop.start"},{})).rejects.toMatchObject({code:"failed",message:"Desktop is paused for CS2"});
    await expect(handler({},{})).rejects.toMatchObject({code:"bad_args"});
  }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});
