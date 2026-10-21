// Opt-in regression check against the real owned desktop and Cua registry.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.env.CUA_ASSISTANT_LIVE_TEST !== '1') throw new Error('Set CUA_ASSISTANT_LIVE_TEST=1 on r2d2.');
const name = 'r2d2-assistant';
const cua = join(homedir(), '.local/bin/cua');
const socketPath = join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'cua-assistant.sock');
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 45000 });
function call(action) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/call', method: 'POST', timeout: 60000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { const r = JSON.parse(data); if (!r.ok) throw new Error(r.error); resolve(r.result); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Controller timeout')));
    req.end(JSON.stringify({ action, args: {} }));
  });
}
function state() {
  const container = JSON.parse(command('docker', ['inspect', name]))[0];
  assert.equal(container.Name, `/${name}`);
  assert.equal(container.Config.Labels['ai.cua.managed'], 'true');
  assert.equal(container.Config.Labels['cua.sandbox.name'], name);
  const row = JSON.parse(command(cua, ['spaces', 'ls', '--json'])).spaces.find(s => s.id === `local:${name}`);
  assert(row, 'Owned desktop must be registered with Cua');
  return { running: container.State.Running, paused: container.State.Paused, power: row.power_state, memory: container.HostConfig.Memory, cpus: container.HostConfig.NanoCpus };
}
const before = await call('snapshot');
assert(!before.gaming && !before.paused && !before.desktopBusy, 'Run only while not gaming or paused');
assert(!before.jobs.some(j => ['running', 'queued'].includes(j.state)), 'Wait for assistant jobs to finish');
for (let cycle = 1; cycle <= 2; cycle++) {
  await call('desktop.start');
  const started = state();
  console.log(`Cycle ${cycle} started`, started);
  assert.equal(started.running, true);
  assert.equal(started.power, 'running', 'Cua must show the started desktop as running');
  assert.equal(started.memory, 3 * 1024 ** 3);
  assert.equal(started.cpus, 2e9);
  command(cua, ['sb', 'exec', name, 'true']);
  await call('desktop.stop');
  const stopped = state();
  console.log(`Cycle ${cycle} stopped`, stopped);
  assert.equal(stopped.running, false, 'Stopping must release the container memory');
  assert(['stopped', 'suspended'].includes(stopped.power), 'Cua must show a nonrunning desktop with Resume available');
  await call('desktop.stop');
}
console.log('PASS: two cold starts, native registry state, guest readiness, limits, memory release and idempotent stop.');
