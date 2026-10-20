// Opt-in installed-host smoke. Uses the repository's Playwright Electron workflow.
import { _electron } from '@playwright/test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
if(process.env.CUA_ASSISTANT_LIVE_TEST!=='1')throw new Error('Set CUA_ASSISTANT_LIVE_TEST=1 on the assistant host.');
const desktop=resolve('../cua-spaces-desktop');
const executablePath=process.env.CUA_ASSISTANT_APP || createRequire(`${desktop}/package.json`)('electron');
const args=process.env.CUA_ASSISTANT_APP?[]:['--no-sandbox',desktop];
const app=await _electron.launch({executablePath,args,cwd:desktop,env:{...process.env,DISPLAY:':1',XAUTHORITY:'/run/user/1000/gdm/Xauthority',CUA_SPACES_E2E_HIDDEN:'1',CUA_SPACES_USER_DATA:resolve(process.env.HOME,'.config/Cua Spaces'),CUA_TELEMETRY:'0',DO_NOT_TRACK:'1'},timeout:60000});
try{
  const page=await app.firstWindow();console.log('Window URL',page.url());
  page.on('pageerror',e=>console.error('Page error:',e.message));
  await page.locator('[data-assistant-page]').waitFor({timeout:90000});
  await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
  await page.getByRole('button',{name:/^R2D2/}).click();
  await page.getByRole('textbox',{name:'Message your assistant'}).fill('Connection check. Reply exactly: Cua native UI connection works. No tools.');
  await page.getByRole('button',{name:'Send message',exact:true}).click({timeout:45000});
  await page.getByText('Cua native UI connection works.',{exact:true}).waitFor({timeout:120000});
  assert((await page.locator('body').innerText()).includes('Running on r2d2'));
  await page.getByRole('button',{name:'memory',exact:true}).click();
  await page.getByRole('textbox',{name:'Search shared knowledge'}).fill('Cua subscription assistant');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Search"]')?.disabled);
  await page.getByRole('button',{name:'routines',exact:true}).click();
  await page.getByRole('textbox',{name:'Routine title'}).waitFor();
  await page.getByRole('button',{name:'chat',exact:true}).click();
  await page.getByRole('button',{name:'Pause queue',exact:true}).click();
  await page.getByRole('button',{name:'Resume queue',exact:true}).waitFor();
  await page.getByRole('button',{name:'Resume queue',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();});
  await page.screenshot({path:'/tmp/r2d2-cua-assistant.png'});
  console.log('PASS: native assistant route, subscription state, GBrain search, routines view and queue control.');
}catch(e){const p=app.windows()[0];if(p){await p.screenshot({path:'/tmp/r2d2-cua-assistant-failure.png'});console.log((await p.locator('body').innerText()).slice(0,5000));}throw e;}finally{await app.close();}
