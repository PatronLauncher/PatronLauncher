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

  await call('install_version',{mc:'1.21.11',loader:'Vanilla',loaderVersion:null});
  await call('cancel_operation');await idle();
  assert.equal((await call('list_profiles',{kind:'Quick'})).state.profiles.length,0);
  for(const loader of ['Vanilla','Fabric']) {
    await call('install_version',{mc:'1.21.11',loader,loaderVersion:null});await idle();
    assert.equal(await call('is_installed',{mc:'1.21.11',loader,loaderVersion:null}),true);
  }
  let quick=(await call('list_profiles',{kind:'Quick'})).state.profiles;
  assert.equal(quick.length,2);assert(quick.every(p=>p.kind==='Quick'));
  assert.equal((await call('list_profiles')).state.profiles.length,0);
  assert.equal((await call('get_state')).state.profiles.length,0);
  const installed=await call('list_installed_versions');assert(installed.some(v=>v.mc==='1.21.11'&&v.loader==='Fabric'&&v.quick_id));
  const vanilla=quick.find(p=>p.loader==='Vanilla');const dir=join(root,'instances',vanilla.id);
  await writeFile(join(dir,'options.txt'),'fov:0.6');
  await call('profile_action',{id:vanilla.id,operation:'backup'});await idle();
  await writeFile(join(dir,'options.txt'),'fov:0.9');
  await call('restore_profile',{confirmed:true});await idle();assert.equal(await readFile(join(dir,'options.txt'),'utf8'),'fov:0.6');
  await call('create_profile',{name:'Custom shared',versionId:'1.21.11'});await idle();
  const custom=(await call('list_profiles')).state.profiles;assert.equal(custom.length,1);assert.equal(custom[0].kind,'Custom');assert.equal((await call('profile_statuses'))[custom[0].id],'installed');
  await assert.rejects(()=>call('remove_version',{mc:'1.21.11',loader:'Vanilla',loaderVersion:null,confirmed:false}));
  const jar=join(root,'minecraft','versions','1.21.11','1.21.11.jar');const bytes=await readFile(jar);
  // Break only this temporary hard-link, then corrupt the isolated file.
  const {unlink}=await import('node:fs/promises');await unlink(jar);await writeFile(jar,'corrupt');
  assert.equal(await call('is_installed',{mc:'1.21.11',loader:'Vanilla',loaderVersion:null}),false);
  await writeFile(jar,bytes);assert.equal(await call('is_installed',{mc:'1.21.11',loader:'Vanilla',loaderVersion:null}),true);
  await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(800);
  console.log('Shared-store native IPC passed: install cancellation/retry, Vanilla/Fabric Quick persistence and isolation, Custom filtering, shared install status, full checksum detection, reference warning, Quick backup/restore.');
} finally {
  if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);
  // Only the random directory created by this script is removed.
  await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
