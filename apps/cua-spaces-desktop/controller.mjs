// SPDX-License-Identifier: FSL-1.1-MIT
// R2D2 integration for Cua Spaces. Native provider credentials stay with their CLIs.
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdirSync, chmodSync, existsSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const LIVE = new Set(['queued', 'running']);
const PROVIDERS = new Set(['hermes-codex', 'claude-code']);
const MAX_PROMPT = 64000;
const DESKTOP_NAME = 'r2d2-assistant';
const CONTEXT = 'You are operating through the Cua assistant on r2d2. Follow the workspace AGENTS.md. Preserve dated original evidence in the shared GBrain. Use the cua MCP tools for a separate Linux desktop when graphical work is required; start it only as needed. The host desktop is for the owner. Google accounts must be selected explicitly. Do not send messages or change remote accounts unless the owner explicitly requests that action. All model work uses the signed-in native subscription; never enable a paid API fallback. Do not run iOS simulators on Linux; the Mac is the iOS host.';

function text(value, name, max = MAX_PROMPT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}

export function safeDiagnostic(value) {
  return String(value).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-3000);
}

export function decodeEvent(provider, event) {
  const out = {};
  if (event.type === 'system' && event.session_id) out.session = event.session_id;
  if (event.type === 'text') out.delta = event.text || '';
  if (event.type === 'tool_use') out.activity = { name: event.name || 'Tool', state: 'running' };
  if (event.type === 'tool_result') out.activity = { name: event.name || 'Tool', state: event.is_error ? 'failed' : 'done' };
  if (provider === 'claude-code' && event.type === 'assistant') {
    for (const block of event.message?.content || []) {
      if (block.type === 'text') out.delta = (out.delta || '') + block.text;
      if (block.type === 'tool_use') out.activity = { name: block.name, state: 'running' };
    }
  }
  if (event.type === 'result') {
    out.final = provider === 'claude-code' ? event.result || '' : event.text || '';
    out.error = event.is_error || event.exit_code ? event.error || out.final || 'The provider could not finish this turn.' : null;
    out.session = event.session_id;
  }
  return out;
}

export function providerCommand(thread, config) {
  if (thread.provider === 'hermes-codex') {
    const args = ['chat', '--provider', 'openai-codex', '--query-file', '-', '--format', 'stream-json', '--source', 'cua', '--in', config.workspace, '--max-turns', '30'];
    if (thread.session_id) args.push('--resume', thread.session_id);
    return [config.hermes, args];
  }
  if (thread.provider === 'claude-code') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', 'mcp__cua__*,mcp__gbrain__*,mcp__r2d2-google__*,Read,Glob,Grep', '--disallowedTools', 'mcp__gbrain__synthesize,mcp__gbrain__submit_agent'];
    if (thread.session_id) args.push('--resume', thread.session_id);
    return [config.claude, args];
  }
  throw new Error('Unsupported subscription provider');
}

export function loadConfig() {
  const home = homedir();
  const path = process.env.CUA_ASSISTANT_CONFIG || join(home, '.config/r2d2-cua/config.json');
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return {
    home,
    workspace: join(home, 'assistant'),
    stateDir: join(home, '.local/state/cua-assistant'),
    socket: join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'cua-assistant.sock'),
    gamingMarker: join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'r2d2-gaming/paused'),
    cua: join(home, '.local/bin/cua'),
    hermes: join(home, '.local/bin/hermes'),
    claude: join(home, '.local/bin/claude'),
    codex: join(home, '.local/bin/codex'),
    desktopIdleMinutes: 10,
    ...saved,
  };
}

export class Controller {
  constructor(config) {
    this.config = config;
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    chmodSync(config.stateDir, 0o700);
    this.db = new DatabaseSync(join(config.stateDir, 'assistant.sqlite'));
    chmodSync(join(config.stateDir, 'assistant.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',session_id TEXT,created INTEGER,updated INTEGER);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),prompt TEXT NOT NULL,state TEXT NOT NULL,created INTEGER,started INTEGER,ended INTEGER,error TEXT,unit TEXT);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),role TEXT NOT NULL,content TEXT NOT NULL,created INTEGER,job_id TEXT);
      CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,job_id TEXT,name TEXT,state TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS routines(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),title TEXT,prompt TEXT,every_minutes INTEGER,next_run INTEGER,enabled INTEGER);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);`);
    if (!this.db.prepare('SELECT id FROM threads LIMIT 1').get()) this.createThread({ title: 'R2D2', provider: 'hermes-codex', role: 'Personal assistant for Mike. Use the shared knowledge brain and existing Google connections.' });
    this.active = null;
    this.ticking = false;
    this.cachedStatus = null;
    this.statusAt = 0;
    this.desktopBusy = false;
    this.stopping = false;
  }

  paused() { return existsSync(this.config.gamingMarker) || this.db.prepare("SELECT value FROM meta WHERE key='paused'").get()?.value === 'true'; }
  gaming() { return existsSync(this.config.gamingMarker); }
  thread(id) { const row = this.db.prepare('SELECT * FROM threads WHERE id=?').get(id); if (!row) throw new Error('Conversation not found'); return row; }

  createThread(args) {
    const title = text(args.title, 'name', 80);
    if (!PROVIDERS.has(args.provider)) throw new Error('Choose a subscription provider');
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(id, title, args.provider, String(args.role || '').slice(0,4000), null, now, now);
    return this.thread(id);
  }

  enqueue(threadId, prompt, outerTransaction = false) {
    this.thread(threadId);
    prompt = text(prompt, 'message');
    const id = randomUUID(), now = Date.now();
    if (!outerTransaction) this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO jobs(id,thread_id,prompt,state,created) VALUES(?,?,?,?,?)').run(id, threadId, prompt, 'queued', now);
      this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(randomUUID(), threadId, 'user', prompt, now, id);
      this.db.prepare('UPDATE threads SET updated=? WHERE id=?').run(now, threadId);
      if (!outerTransaction) this.db.exec('COMMIT');
    } catch (e) { if (!outerTransaction) this.db.exec('ROLLBACK'); throw e; }
    return { id, state: 'queued' };
  }

  snapshot(threadId) {
    const threads = this.db.prepare('SELECT * FROM threads ORDER BY updated DESC').all();
    const selected = threadId ? this.thread(threadId) : threads[0];
    const messages = selected ? this.db.prepare('SELECT * FROM (SELECT * FROM messages WHERE thread_id=? ORDER BY created DESC LIMIT 200) ORDER BY created').all(selected.id) : [];
    const jobs = this.db.prepare('SELECT id,thread_id,state,created,started,ended,error FROM jobs ORDER BY created DESC LIMIT 30').all();
    const activity = selected ? this.db.prepare("SELECT a.id,a.job_id,a.name,CASE WHEN j.state != 'running' AND a.state='running' THEN 'done' ELSE a.state END AS state,a.created FROM activity a JOIN jobs j ON j.id=a.job_id WHERE j.thread_id=? ORDER BY a.id DESC LIMIT 24").all(selected.id) : [];
    const routines = this.db.prepare('SELECT id,thread_id,title,every_minutes,next_run,enabled FROM routines ORDER BY next_run').all();
    return { threads, messages, jobs, activity, routines, selectedId: selected?.id, paused: this.paused(), gaming: this.gaming(), desktopBusy: this.desktopBusy, desktop: this.desktopState(), workspace: this.config.workspace };
  }

  desktopState() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='desktop'").get();
    return row ? JSON.parse(row.value) : { name: DESKTOP_NAME, state: 'off' };
  }
  setDesktop(value) { this.db.prepare("INSERT INTO meta VALUES('desktop',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value)); }

  async status() {
    if (this.cachedStatus && Date.now() - this.statusAt < 60000) return this.cachedStatus;
    const env = { ...process.env, PATH: `${join(this.config.home, '.local/bin')}:${process.env.PATH || '/usr/bin:/bin'}` };
    const probe = async (command, args) => {
      try { const r = await exec(command, args, { env, timeout: 12000, maxBuffer: 128000 }); return { ok: true, output: r.stdout + r.stderr }; }
      catch { return { ok: false, output: '' }; }
    };
    const [codex, claude, accounts, telegram] = await Promise.all([
      probe(this.config.codex, ['login', 'status']), probe(this.config.claude, ['auth', 'status']), probe(join(this.config.home, '.local/bin/r2d2-google'), ['accounts']), probe('systemctl',['--user','is-active','hermes-gateway.service']),
    ]);
    let claudeInfo = {};
    try { claudeInfo = JSON.parse(claude.output); } catch {}
    const emails = [...new Set(accounts.output.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])];
    this.cachedStatus = {
      host: 'r2d2', providers: [
        { id: 'hermes-codex', name: 'Codex through Hermes', signedIn: codex.ok && /ChatGPT/i.test(codex.output), plan: 'ChatGPT subscription' },
        { id: 'claude-code', name: 'Claude Code', signedIn: claudeInfo.loggedIn === true && claudeInfo.authMethod === 'claude.ai', plan: claudeInfo.subscriptionType ? `Claude ${claudeInfo.subscriptionType}` : 'Claude subscription' },
      ],
      accounts: emails, googleChecked: accounts.ok,
      brain: existsSync(join(this.config.workspace, 'vault')), cuaInstalled: existsSync(this.config.cua),
      telegramManagedByHermes: telegram.ok && telegram.output.trim() === 'active',
    };
    this.statusAt = Date.now();
    return this.cachedStatus;
  }

  async cancel(id) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!job || !LIVE.has(job.state)) return { ok: true };
    this.db.prepare("UPDATE jobs SET state='cancelled',ended=? WHERE id=?").run(Date.now(), id);
    this.db.prepare("UPDATE messages SET content='Stopped.' WHERE job_id=? AND role='assistant' AND content=''").run(id);
    if (job.unit) await exec('systemctl', ['--user', 'stop', job.unit], { timeout: 15000 }).catch(() => {});
    return { ok: true };
  }

  async recover() {
    for (const job of this.db.prepare("SELECT * FROM jobs WHERE state='running'").all()) {
      if (job.unit) await exec('systemctl', ['--user', 'stop', job.unit], { timeout: 15000 }).catch(() => {});
      this.db.prepare("UPDATE jobs SET state='interrupted',ended=?,error=? WHERE id=?").run(Date.now(), 'The assistant restarted during this turn. Review the conversation before retrying.', job.id);
    }
    // Desktop state is private metadata, not authority. Recheck only our own container.
    const state = this.desktopState();
    if (state.container) {
      try {
        const r = await exec('docker', ['inspect', '--format', '{{.State.Running}}', state.container], { timeout: 5000 });
        if (r.stdout.trim() !== 'true') this.setDesktop({ ...state, state: 'off' });
      } catch { this.setDesktop({ name: DESKTOP_NAME, state: 'off' }); }
    }
  }

  async run(job) {
    const thread = this.thread(job.thread_id);
    const [binary, args] = providerCommand(thread, this.config);
    const unit = `cua-assistant-job-${job.id}.service`;
    this.db.prepare("UPDATE jobs SET state='running',started=?,unit=? WHERE id=?").run(Date.now(), unit, job.id);
    const messageId = randomUUID();
    this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(messageId, thread.id, 'assistant', '', Date.now(), job.id);
    const nativeEnv = { ...process.env, PATH: `${join(this.config.home,'.local/bin')}:${process.env.PATH || '/usr/bin:/bin'}` };
    // Authentication must stay with the native CLI's stored subscription session.
    for (const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','OPENAI_BASE_URL']) delete nativeEnv[key];
    const command = ['--user', '--quiet', '--collect', '--wait', '--pipe', `--unit=${unit}`, '--slice=app-r2d2-workers.slice', '--property=MemoryMax=4G', '--property=CPUWeight=20', '--property=IOWeight=20', '--property=UnsetEnvironment=OPENAI_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_BASE_URL', `--working-directory=${this.config.workspace}`, `--setenv=PATH=${nativeEnv.PATH}`, '--setenv=HERMES_QUIET=1', binary, ...args];
    const child = spawn('systemd-run', command, { cwd: this.config.workspace, env: nativeEnv, stdio: ['pipe','pipe','pipe'] });
    this.active = { id: job.id, child };
    let buffer = '', stderr = '', answer = '', terminal = false, failure = null, flushed = 0;
    const update = (force = false) => {
      if (force || Date.now() - flushed > 150) {
        this.db.prepare('UPDATE messages SET content=? WHERE id=?').run(answer, messageId); flushed = Date.now();
      }
    };
    const onLine = line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const decoded = decodeEvent(thread.provider, event);
      if (decoded.session) this.db.prepare('UPDATE threads SET session_id=? WHERE id=?').run(decoded.session, thread.id);
      if (decoded.delta) { answer += decoded.delta; update(); }
      if (decoded.activity) this.db.prepare('INSERT INTO activity(job_id,name,state,created) VALUES(?,?,?,?)').run(job.id, decoded.activity.name, decoded.activity.state, Date.now());
      if ('final' in decoded) { terminal = true; if (decoded.final) answer = decoded.final; failure = decoded.error; update(true); }
    };
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) { failure = 'Provider output exceeded the maximum event size'; void this.cancel(job.id); return; }
      let i; while ((i = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0,i)); buffer = buffer.slice(i+1); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.stdin.on('error', () => {});
    child.stdin.end(`${CONTEXT}\n\nRole: ${thread.role}\n\n${job.prompt}`);
    const code = await new Promise(resolveExit => {
      child.once('error', error => { failure = error.message; resolveExit(1); });
      child.once('close', code => resolveExit(code ?? 1));
    });
    if (buffer.trim()) onLine(buffer);
    update(true);
    const current = this.db.prepare('SELECT state FROM jobs WHERE id=?').get(job.id);
    if (current?.state !== 'cancelled') {
      if (code || failure || !terminal) {
        const error = safeDiagnostic(failure || stderr || 'The provider exited before returning a result.');
        this.db.prepare("UPDATE jobs SET state='failed',ended=?,error=? WHERE id=?").run(Date.now(), error, job.id);
        if (!answer) this.db.prepare('UPDATE messages SET content=? WHERE id=?').run('This turn did not finish. See the job details and retry when ready.', messageId);
      } else this.db.prepare("UPDATE jobs SET state='done',ended=? WHERE id=?").run(Date.now(),job.id);
    }
    this.db.prepare('UPDATE threads SET updated=? WHERE id=?').run(Date.now(),thread.id);
    this.active = null;
  }

  async tick() {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      const desktop = this.desktopState();
      if (!this.desktopBusy && desktop.state === 'running' && (this.gaming() || (!this.active && Date.now() - (desktop.lastUsed || 0) > this.config.desktopIdleMinutes * 60000))) await this.stopDesktop(this.gaming() ? 'gaming' : 'idle');
      if (this.paused() || this.active) return;
      const now = Date.now();
      for (const r of this.db.prepare('SELECT * FROM routines WHERE enabled=1 AND next_run<=?').all(now)) {
        this.db.exec('BEGIN IMMEDIATE');
        try { this.enqueue(r.thread_id, r.prompt, true); this.db.prepare('UPDATE routines SET next_run=? WHERE id=?').run(now + r.every_minutes * 60000, r.id); this.db.exec('COMMIT'); } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      }
      const job = this.db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created LIMIT 1").get();
      if (job) void this.run(job).catch(error => {
        this.db.prepare("UPDATE jobs SET state='failed',ended=?,error=? WHERE id=?").run(Date.now(),safeDiagnostic(error.message),job.id); this.active = null;
      });
    } finally { this.ticking = false; }
  }

  async ownedContainer() {
    try {
      const r = await exec('docker', ['inspect', DESKTOP_NAME], { timeout: 5000, maxBuffer: 256000 });
      const row = JSON.parse(r.stdout)[0];
      if (row.Name !== `/${DESKTOP_NAME}` || row.Config?.Labels?.['cua.sandbox.name'] !== DESKTOP_NAME || row.Config?.Labels?.['ai.cua.managed'] !== 'true') throw new Error('The desktop container is not managed by Cua.');
      return row;
    } catch (error) {
      if (/No such (object|container)/.test(error.stderr || '')) return null;
      throw error;
    }
  }

  async startDesktop() {
    if (this.gaming()) throw new Error('The desktop stays off while CS2 is running.');
    if (this.desktopPromise) return this.desktopPromise;
    this.desktopBusy = true;
    this.desktopPromise = (async () => {
      let container = await this.ownedContainer();
      if (!container) {
        await exec(this.config.cua, ['spaces','create','linux','--on','local','--kind','container','--name',DESKTOP_NAME,'--cpus','2','--memory-mb','3072','--json'], { timeout: 900000, maxBuffer: 2*1024*1024 });
        container = await this.ownedContainer();
      }
      if (!container) throw new Error('Cua did not create the expected desktop container.');
      if (!container.State.Running) await exec('docker', ['start', container.Id], { timeout: 45000 });
      if (container.State.Paused) await exec('docker', ['unpause', container.Id], { timeout: 10000 });
      if (!container.State.Running || container.State.Paused) {
        // A cold guest replaces its RPC transport. Drop the daemon's old connection.
        await exec('systemctl',['--user','restart','cua-daemon.service'],{timeout:15000});
        let ready=false;
        for(let i=0;i<30;i++){try{await exec(this.config.cua,['sb','exec',DESKTOP_NAME,'true'],{timeout:3000,maxBuffer:32000});ready=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}
        if(!ready)throw new Error('The desktop started but is not ready. Retry shortly.');
      }
      if (this.gaming()) {
        await exec('docker', ['stop','--time','5',container.Id], {timeout:15000});
        this.setDesktop({name: DESKTOP_NAME, container:container.Id, state:'off', reason:'gaming'});
        throw new Error('CS2 started while the desktop was preparing. The desktop was stopped.');
      }
      this.setDesktop({name: DESKTOP_NAME, container:container.Id, state:'running', lastUsed:Date.now(), reason:null});
      return this.desktopState();
    })();
    try { return await this.desktopPromise; }
    finally { this.desktopBusy = false; this.desktopPromise = null; }
  }

  async stopDesktop(reason = 'manual') {
    const state = this.desktopState();
    if (state.container) { const owned=await this.ownedContainer(); if (owned?.Id===state.container) await exec('docker',['stop','--time','10',state.container],{timeout:20000}); }
    this.setDesktop({ ...state, state: 'off', reason });
    return this.desktopState();
  }

  async call(action, args = {}) {
    switch (action) {
      case 'snapshot': return this.snapshot(args.threadId);
      case 'status': return this.status();
      case 'threads.create': return this.createThread(args);
      case 'chat': return this.enqueue(text(args.threadId,'conversation',100),args.message);
      case 'jobs.cancel': return this.cancel(text(args.id,'job',100));
      case 'pause': this.db.prepare("INSERT INTO meta VALUES('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(args.paused ? 'true' : 'false'); return { paused:this.paused() };
      case 'routines.add': {
        this.thread(args.threadId); const minutes=Number(args.minutes);
        if (!Number.isInteger(minutes) || minutes<5 || minutes>10080) throw new Error('Choose an interval between 5 minutes and one week.');
        const id=randomUUID();
        this.db.prepare('INSERT INTO routines VALUES(?,?,?,?,?,?,?)').run(id,args.threadId,text(args.title,'title',120),text(args.prompt,'routine'),minutes,Date.now()+minutes*60000,1);
        return {id};
      }
      case 'routines.toggle': this.db.prepare('UPDATE routines SET enabled=? WHERE id=?').run(args.enabled?1:0,text(args.id,'routine',100)); return {ok:true};
      case 'brain.search': {
        const input=JSON.stringify({query:text(args.query,'search',500),limit:8,budget_tokens:2500});
        const r=await exec(join(this.config.home,'.local/bin/gbrain'),['call','recall',input],{timeout:30000,maxBuffer:128000}); return JSON.parse(r.stdout);
      }
      case 'desktop.start': return this.startDesktop();
      case 'desktop.stop': return this.stopDesktop();
      case 'desktop.touch': { const d=this.desktopState();this.setDesktop({...d,lastUsed:Date.now()});return {ok:true}; }
      default: throw new Error('Unknown assistant action');
    }
  }

  close() { this.stopping=true; this.db.close(); }
}

export async function serve(config = loadConfig()) {
  if (existsSync(config.socket)) {
    const s=statSync(config.socket);
    if (!s.isSocket() || s.uid!==process.getuid()) throw new Error('The assistant socket is not owned by this account.');
    const alive=await new Promise(resolveAlive=>{ const req=httpRequest({socketPath:config.socket,path:'/health',timeout:1000},r=>{r.resume();resolveAlive(true);}); req.on('error',()=>resolveAlive(false));req.on('timeout',()=>{req.destroy();resolveAlive(false);});req.end();});
    if (alive) throw new Error('The assistant is already running.');
    unlinkSync(config.socket);
  }
  const controller = new Controller(config);
  await controller.recover();
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    res.setHeader('Cache-Control','no-store');
    if(req.method==='GET'&&req.url==='/health'){res.end(JSON.stringify({ok:true}));return;}
    if(req.method!=='POST'||req.url!=='/call'){res.writeHead(404);res.end('{}');return;}
    try {
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>128000)throw new Error('Request too large');}
      const {action,args}=JSON.parse(raw);const result=await controller.call(action,args);
      res.end(JSON.stringify({ok:true,result}));
    }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:safeDiagnostic(e.message)}));}
  });
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(config.socket,resolveListen);});
  chmodSync(config.socket,0o600);
  const clock=setInterval(()=>void controller.tick().catch(()=>{}),1500);
  console.log('Cua assistant is ready on its private local socket.');
  let closing=false;
  const stop=async()=>{
    if(closing)return;closing=true;controller.stopping=true;clearInterval(clock);
    if(controller.active)await controller.cancel(controller.active.id);
    server.close();controller.close();try{unlinkSync(config.socket);}catch{}process.exit(0);
  };
  process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
  return {server,controller,stop};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await serve();
