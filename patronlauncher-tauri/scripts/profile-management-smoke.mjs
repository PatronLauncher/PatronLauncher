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
  await page.locator('.sidebar-create').click();
  await page.getByRole('dialog',{name:'Profil oluştur',exact:true}).getByRole('button',{name:/Sürümden oluştur/}).click();
  await page.getByRole('button',{name:'Minecraft 1.21 ailesini seç',exact:true}).click();
  await page.getByLabel('Ailedeki sürüm').selectOption('1.21.11');
  await page.getByRole('button',{name:'Fabric',exact:true}).click();
  await page.locator('#version-create').click();
  assert.equal(await page.getByLabel('Sürüm profil adı').inputValue(),'Minecraft 1.21.11 · Fabric');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/native-profile-creation.png'});
  await page.getByLabel('Sürüm profil adı').fill('Native Fabric');
  await page.getByRole('dialog',{name:'Profil oluştur',exact:true}).getByRole('button',{name:'Oluştur',exact:true}).click();
  await page.locator('.hero h2').filter({hasText:'Native Fabric'}).waitFor();await idle();
  let state=(await call('get_state')).state;const original=state.profiles.find(p=>p.name==='Native Fabric');assert.equal(original.loader,'Fabric');assert(original.loader_version);
  assert.equal(state.accounts.length,0);
  const dir=join(root,'instances',original.id);
  await mkdir(join(dir,'saves','TestWorld'),{recursive:true});await writeFile(join(dir,'saves','TestWorld','level.dat'),'synthetic-world');await writeFile(join(dir,'options.txt'),'fov:0.7');
  await page.locator('[data-p="profiles"]').click();
  await page.getByRole('button',{name:'İndir',exact:true}).click();
  await idle();
  state=(await call('get_state')).state;assert.equal(state.running,false);
  assert.equal((await call('profile_statuses'))[original.id],'installed');
  assert.equal(await readFile(join(dir,'options.txt'),'utf8'),'fov:0.7');
  await page.getByRole('button',{name:'Kopyala',exact:true}).click();
  await page.getByLabel('Profil adı',{exact:true}).fill('Fabric Copy');
  await page.getByRole('dialog').getByRole('button',{name:'Kopyala',exact:true}).click();await idle();
  state=(await call('get_state')).state;const copy=state.profiles.find(p=>p.name==='Fabric Copy');assert(copy);assert.notEqual(copy.id,original.id);assert.equal(copy.loader_version,original.loader_version);
  assert.equal(await readFile(join(root,'instances',copy.id,'saves','TestWorld','level.dat'),'utf8'),'synthetic-world');
  await page.locator('.profile-card.sel').getByRole('button',{name:'Yeniden adlandır',exact:true}).click();
  await page.getByLabel('Profil adı',{exact:true}).fill('Renamed Copy');await page.getByRole('button',{name:'Kaydet',exact:true}).click();await idle();
  const saved=JSON.parse(await readFile(join(root,'settings.json'),'utf8'));assert.equal(saved.profiles.find(p=>p.id===copy.id).name,'Renamed Copy');assert.equal(saved.profiles.find(p=>p.id===copy.id).loader,'Fabric');
  await page.screenshot({path:'test-results/native-profile-management.png'});
  await page.locator('.profile-card.sel').getByRole('button',{name:'Profili listeden kaldır',exact:true}).click();
  assert((await page.getByRole('dialog').innerText()).includes('Dünyalar silinmez'));
  await page.getByRole('button',{name:'Listeden kaldır',exact:true}).click();await idle();
  assert.equal(await readFile(join(root,'instances',copy.id,'saves','TestWorld','level.dat'),'utf8'),'synthetic-world');assert.equal(await readFile(join(dir,'saves','TestWorld','level.dat'),'utf8'),'synthetic-world');
  await call('create_configured_profile',{name:'Native Fabric',versionId:'1.21.11',loader:'Fabric',loaderVersion:original.loader_version,planId:null,confirmed:false});await idle();
  state=(await call('get_state')).state;assert.equal(state.profiles.length,2);assert(state.profiles.every(p=>p.loader==='Fabric'&&p.version==='1.21.11'));assert.notEqual(state.profiles[0].id,state.profiles[1].id);
  await assert.rejects(()=>call('rename_profile',{id:original.id,name:'bad\nname'}));
  await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(800);
  console.log('Native management passed: wizard/modal, real Fabric download without account or Java, install badge, copy/world isolation, rename persistence, non-destructive removal and duplicate version+loader profiles.');
} finally {
  if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);
  // Only the random directory created by this script is removed.
  await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
