import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const base=await mkdtemp(join(tmpdir(),'patron-wizard-acl-'));
const root=join(base,'#PatronLauncher');await mkdir(root);
await writeFile(join(root,'settings.json'),JSON.stringify({discord_client_id:''}));
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{
  windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,
  WEBVIEW2_USER_DATA_FOLDER:join(base,'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19349 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
let browser;
try {
 for(let i=0;i<80;i++) {if(app.exitCode!==null)throw Error('Native launcher exited');try{browser=await chromium.connectOverCDP('http://127.0.0.1:19349',{timeout:1000});break;}catch{await delay(400);}}
 assert(browser,'WebView2 endpoint unavailable');
 const context=browser.contexts()[0];let page;
 for(let i=0;i<60;i++){page=context.pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}
 assert(page,'Native page unavailable');await page.locator('.hero').waitFor();
 const call=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 let state;
 for(let i=0;i<200;i++){state=(await call('get_state')).state;if(state.versions.length && !state.busy)break;await delay(300);}
 assert(state.versions.length && !state.busy,'Official version manifest did not load');
 const idle=async()=>{for(let i=0;i<100;i++){await delay(200);if(!(await call("get_state")).state.busy){await delay(300);if(!(await call("get_state")).state.busy)return;}}throw Error("Background job did not finish");};
 const versionId=state.versions.find(v=>v.type==='release').id;
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#d5253c';ctx.fillRect(0,0,128,128);return c.toDataURL('image/png');});
 for(const [icon,background] of [[false,false],[true,false],[false,true],[true,true]]) {
   await idle();
   const reply=await call('create_wizard_profile',{name:`Native ${Number(icon)}${Number(background)}`,versionId,loader:'Vanilla',loaderVersion:null,appearance:{description:'Native ACL test',icon:icon?image:null,background:background?image:null}});
   const p=reply.state.profiles.find(p=>p.id===reply.state.selected_profile);
   assert.equal(p.kind,'Custom');
   assert.equal(p.appearance.icon,icon?image:'builtin:profile-icon');
   assert.equal(p.appearance.background,background?image:'builtin:profile-background');
   const disk=JSON.parse(await readFile(join(root,'instances',p.id,'.patronlauncher-profile.json'),'utf8'));
   assert.equal(disk.appearance.background,p.appearance.background);
 }
 await idle();
 const before=await readdir(join(root,'instances'));
 await assert.rejects(()=>call('create_wizard_profile',{name:'Bad image',versionId,loader:'Vanilla',loaderVersion:null,appearance:{description:'',icon:'file:///bad.png',background:null}}));
 assert.deepEqual(await readdir(join(root,'instances')),before,'Validation left partial files');
 // Exercise the real modal's no-image path through Tauri's ACL, not a mock.
 await page.locator('.sidebar-create').click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:/Sıfırdan oluştur/}).click();
 await dialog.getByLabel('Profil adı *').fill('Native wizard without images');
 await dialog.getByRole('button',{name:'Devam',exact:true}).click();
 await dialog.getByRole('button',{name:'Devam',exact:true}).click();
 await dialog.getByAltText('Varsayılan profil simgesi').waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Oluştur',exact:true}).isEnabled(),true);
 await mkdir('test-results',{recursive:true});
 await page.screenshot({path:'test-results/native-wizard-optional.png'});
 await dialog.getByRole('button',{name:'Oluştur',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 const saved=JSON.parse(await readFile(join(root,'settings.json'),'utf8'));
 assert.equal(saved.profiles.length,5);
 console.log('Native WebView2/ACL: four artwork combinations persisted; no-image wizard succeeded; invalid image left no profile directory.');
} finally {
 if(browser)await browser.close().catch(()=>{});
 if(app.exitCode===null)app.kill();
 await delay(800);await rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
