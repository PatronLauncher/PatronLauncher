// Real IPC, filesystem and React management checks in a disposable # data root.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, link, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const base = await mkdtemp(join(tmpdir(), 'patronlauncher-management-'));
const root = join(base, '#PatronLauncher');
await mkdir(root);
// Link immutable download cache only, never profile data, natives or runtimes.
async function cache(from, to) {
  await mkdir(to, {recursive:true});
  for (const e of await readdir(from, {withFileTypes:true})) {
    if (e.name === 'natives' || e.name.endsWith('.part')) continue;
    if (e.isDirectory()) await cache(join(from,e.name), join(to,e.name));
    else if(e.isFile()) { try { await link(join(from,e.name),join(to,e.name)); } catch { await copyFile(join(from,e.name),join(to,e.name)); } }
  }
}
for (const dir of ['assets','libraries','versions']) await cache(join(process.env.APPDATA,'PLauncher','minecraft',dir),join(root,'minecraft',dir));
await writeFile(join(root,'settings.json'),JSON.stringify({discord_client_id:'',java_path:'C:/missing-java-for-download-test/java.exe'}));
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,WEBVIEW2_USER_DATA_FOLDER:join(base,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19352 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
let browser;
try {
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19352',{timeout:1000});break;}catch{await delay(300);}}
  assert(browser);
  let page;for(let i=0;i<50;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}assert(page);
  await page.locator('.hero').waitFor();
  const call=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  async function idle(){for(let i=0;i<900;i++){const s=(await call('get_state')).state;if(!s.busy){await delay(600);if(!(await call('get_state')).state.busy)return;}await delay(200);}throw Error('Worker timed out');}
  await idle();


  await page.locator('[data-p="versions"]').click();
  await page.getByRole('button',{name:'Minecraft 1.21 ailesini seç',exact:true}).click();
  await page.getByLabel('Ailedeki sürüm').selectOption('1.21.11');
  await page.getByRole('button',{name:'Fabric',exact:true}).click();
  await page.getByLabel('Performans paketi',{exact:true}).check();
  await page.getByRole('button',{name:'Kur',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Mod indirmesini onayla'});await dialog.waitFor();
  assert((await dialog.innerText()).includes('Sodium'));
  await dialog.getByRole('button',{name:'Onayla ve kur',exact:true}).click();
  await page.getByRole('button',{name:'Kuruldu ✓',exact:true}).waitFor({timeout:180000});
  assert.equal((await call('list_profiles')).state.profiles.length,0);
  const quick=(await call('list_profiles',{kind:'Quick'})).state.profiles.find(p=>p.loader==='Fabric');assert(quick);
  const mods=await readdir(join(root,'instances',quick.id,'mods'));assert(mods.filter(n=>n.endsWith('.jar')).length>=3);
  await page.screenshot({path:'test-results/native-version-installed.png'});
  await page.getByRole('button',{name:'Oyna',exact:true}).click();
  await page.locator('.hero').waitFor();assert((await page.locator('.hero .bd.m').innerText()).includes('FABR'));
  assert.equal((await call('get_state')).state.quick_profile.id,quick.id);
  await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(800);
  console.log('Versions native UI passed: real approved performance pack, shared installation, hidden Quick, installed badge and home selection without launching.');
} finally {
  if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);
  // Only the random directory created by this script is removed.
  await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
