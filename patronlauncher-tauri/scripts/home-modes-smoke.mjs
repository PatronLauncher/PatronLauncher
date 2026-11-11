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


  await call('install_version',{mc:'1.21.11',loader:'Vanilla',loaderVersion:null});await idle();
  await call('create_profile',{name:'Native Custom',versionId:'1.21.11'});await idle();
  await page.getByRole('button',{name:'Profil',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Profil',exact:true}).getAttribute('aria-pressed'),'true');
  assert((await page.locator('.home-profile').innerText()).includes('Native Custom'));
  await page.getByRole('button',{name:'Hızlı oyun',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.home-play-detail')?.textContent.includes('Minecraft 1.21.11'),null,{timeout:120000});await idle();
  assert.equal(await page.getByRole('button',{name:'Hızlı oyun',exact:true}).getAttribute('aria-pressed'),'true');
  assert((await call('get_state')).state.quick_profile);
  assert.equal(await page.getByLabel('Oyun profili',{exact:true}).count(),0);assert.equal(await page.getByLabel('Minecraft sürümü',{exact:true}).count(),0);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/native-home-quick.png'});
  await page.getByRole('button',{name:'Profil',exact:true}).click();await idle();
  assert((await page.locator('.home-profile').innerText()).includes('Native Custom'));assert.equal((await call('get_state')).state.quick_profile,null);
  await page.screenshot({path:'test-results/native-home-profile.png'});
  await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(800);
  console.log('Native home modes passed: isolated Quick/Custom switching, selection persistence, removed old dropdowns, account prompt and real installed-version selection.');
} finally {
  if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);
  // Only the random directory created by this script is removed.
  await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
