import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Controller,decodeEvent,providerCommand} from './controller.mjs';

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'cua-assistant-test-'));
  const c=new Controller({stateDir:dir,gamingMarker:join(dir,'gaming'),workspace:dir,desktopIdleMinutes:10});
  t.after(()=>{c.close();rmSync(dir,{recursive:true,force:true});});return c;
}
test('gaming defers queued work and due routines, then resumes without duplicates',async t=>{
  const c=fixture(t),thread=c.snapshot().threads[0];let runs=[];
  c.run=async job=>{runs.push(job.id);c.db.prepare("UPDATE jobs SET state='done' WHERE id=?").run(job.id);};
  c.enqueue(thread.id,'a task');
  await c.call('routines.add',{threadId:thread.id,title:'check',prompt:'routine',minutes:5});
  c.db.prepare('UPDATE routines SET next_run=0').run();
  writeFileSync(c.config.gamingMarker,'paused');await c.tick();
  assert.equal(runs.length,0);assert.equal(c.snapshot().jobs.length,1);
  rmSync(c.config.gamingMarker);await c.tick();await c.tick();await c.tick();
  assert.equal(runs.length,2);assert.equal(new Set(runs).size,2);
  assert(c.snapshot().jobs.every(j=>j.state==='done'));
});
test('recovery preserves completed work and flags an unfinished turn for review',async t=>{
  const c=fixture(t),thread=c.snapshot().threads[0];const {id}=c.enqueue(thread.id,'do not automatically repeat');
  c.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(id);
  await c.recover();assert.equal(c.snapshot().jobs[0].state,'interrupted');
  await c.recover();assert.equal(c.snapshot().jobs.length,1);
  assert.equal(c.snapshot().messages[0].content,'do not automatically repeat');
});
test('cancellation removes pending work without launching a provider',async t=>{
  const c=fixture(t),thread=c.snapshot().threads[0];const {id}=c.enqueue(thread.id,'cancel this');
  await c.cancel(id);let called=false;c.run=async()=>{called=true;};await c.tick();
  assert.equal(called,false);assert.equal(c.snapshot().jobs[0].state,'cancelled');
});
test('subscription commands use stdin, resume sessions and pin Hermes to Codex',()=>{
  const config={workspace:'/tmp/work',hermes:'/bin/hermes',claude:'/bin/claude'};
  const [binary,args]=providerCommand({provider:'hermes-codex',session_id:'a'},config);
  assert.equal(binary,'/bin/hermes');assert(args.includes('openai-codex'));assert.equal(args.at(-1),'a');
  assert.equal(args[args.indexOf('--query-file')+1],'-');assert(!args.includes('--yolo'));
  assert.throws(()=>providerCommand({provider:'api'},config),/Unsupported subscription provider/);
});
test('provider events expose text and tool names without retaining tool arguments',()=>{
  assert.deepEqual(decodeEvent('hermes-codex',{type:'tool_use',name:'accounts',input:{secret:'private'}}),{activity:{name:'accounts',state:'running'}});
  assert.deepEqual(decodeEvent('claude-code',{type:'result',result:'done',is_error:false,session_id:'a'}),{final:'done',error:null,session:'a'});
});
