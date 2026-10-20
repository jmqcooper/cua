// SPDX-License-Identifier: FSL-1.1-MIT
// Native Cua MCP with lazy desktop startup. No model or account proxying.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {request} from 'node:http';
import {homedir} from 'node:os';
import {join} from 'node:path';

const sandbox='local:r2d2-assistant';
const socketPath=process.env.CUA_ASSISTANT_SOCKET || join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,'cua-assistant.sock');
function call(action){
  return new Promise((resolve,reject)=>{
    const req=request({socketPath,path:'/call',method:'POST',timeout:900000},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const r=JSON.parse(data);if(!r.ok)throw new Error(r.error);resolve(r.result);}catch(e){reject(e);}});
    });
    req.on('error',()=>reject(new Error('Cua assistant service is unavailable.')));
    req.on('timeout',()=>req.destroy(new Error('Desktop startup timed out.')));
    req.end(JSON.stringify({action,args:{}}));
  });
}
const child=spawn(join(homedir(),'.local/bin/cua'),['mcp','--permissions','sandbox:readonly,computer:all','--sandbox',sandbox],{stdio:['pipe','pipe','inherit'],env:{...process.env,CUA_TELEMETRY:'0',DO_NOT_TRACK:'1'}});
child.stdout.pipe(process.stdout);
child.on('error',()=>process.exit(1));
child.on('close',code=>process.exit(code||0));
child.stdin.on('error',()=>{});
let chain=Promise.resolve();
for await (const line of createInterface({input:process.stdin})){
  chain=chain.then(async()=>{
    let message;
    try{message=JSON.parse(line);}catch{return;}
    if(message.method==='tools/call' && message.params?.name?.startsWith('computer_')){
      try{
        const args=message.params.arguments ||= {};
        if(args.sandbox && ![sandbox,'r2d2-assistant'].includes(args.sandbox))throw new Error('This connection controls only the dedicated r2d2 assistant desktop.');
        args.sandbox=sandbox;
        await call('desktop.start');
      }catch(e){
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:e.message}]}})+'\n');
        return;
      }
    }
    child.stdin.write(JSON.stringify(message)+'\n');
  });
}
await chain;
child.stdin.end();
