import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base=await mkdtemp(join(tmpdir(),'patron-mods-live-')),root=join(base,'#PatronLauncher');await mkdir(root);
const id=randomUUID();
await writeFile(join(root,'settings.json'),JSON.stringify({discord_client_id:'',profiles:[{id,kind:'Custom',name:'Geçici Fabric testi',version:'1.21.1',loader:'Fabric',loader_version:'0.16.10'}],selected_profile:id}));
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,WEBVIEW2_USER_DATA_FOLDER:join(base,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19350 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
let browser;
try {
 for(let i=0;i<100;i++){assert.equal(app.exitCode,null);try{browser=await chromium.connectOverCDP('http://127.0.0.1:19350',{timeout:1000});break;}catch{await delay(400);}}
 assert(browser,'WebView2 unavailable');const context=browser.contexts()[0];let page;
 for(let i=0;i<60;i++){page=context.pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}
 assert(page,'Embedded page missing');assert.match(page.url(),/^https?:\/\/tauri\.localhost/);await page.locator('.hero').waitFor();
 const call=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 for(let i=0;i<180;i++){await delay(300);const s=(await call('get_state')).state;if(!s.busy&&s.versions.length){await delay(600);if(!(await call('get_state')).state.busy)break;}}
 let plan,slug;const errors=[];
 for(const project of ['appleskin','shulkerboxtooltip','durability-viewer','advancementinfo']){
  try{const p=await call('mods_plan',{id,projects:[project],versionId:null});if(p.entries.some(e=>e.project_id==='P7dR8mSH')){plan=p;slug=project;break;}}catch(e){errors.push(project+': '+String(e));}
 }
 assert(plan,'No candidate with required Fabric API: '+errors.join('; '));
 assert(plan.total_bytes<30*1024*1024,'Test exceeds size budget');
 await page.evaluate(()=>{window.modProgress=[];});
 // Subscribe through the application's actual Tauri event layer.
 const progressCallback=await page.evaluate(()=>window.__TAURI_INTERNALS__.transformCallback(e=>window.modProgress.push(e.payload)));
 await call('plugin:event|listen',{event:'patronlauncher://mods-progress',target:{kind:'Any'},handler:progressCallback});
 await call('mods_install',{id,planId:plan.id,confirmed:true});
 for(let i=0;i<600;i++){await delay(300);if(!(await call('get_state')).state.busy)break;}
 const state=(await call('get_state')).state;assert.equal(state.busy,false);
 const listing=await call('mods_list',{id});assert(listing.managed.some(e=>e.project_id==='P7dR8mSH'),'Fabric API not installed: '+state.status);
 let bytes=0;for(const e of listing.managed){const data=await readFile(join(root,'instances',id,'mods',e.filename));bytes+=data.length;assert.equal(createHash(e.sha512?'sha512':'sha1').update(data).digest('hex'),e.sha512??e.sha1);}
 assert((await page.evaluate(()=>window.modProgress.length))>0,'No real download progress events');
 await page.locator('[data-p="mods"]').click();await page.getByLabel('Mod ara',{exact:true}).fill(slug);await page.locator('.mod-card').first().waitFor();
 await page.getByRole('button',{name:'Kurulu ✓',exact:true}).first().waitFor();
 await delay(1500);
 const icons=await page.locator('.mod-card img').evaluateAll(nodes=>nodes.map(n=>({src:n.getAttribute('src'),loaded:n.complete&&n.naturalWidth>0})));console.log('CDN icons:',JSON.stringify(icons));
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mods-live-installed.png'});
 const report={project:slug,mc:'1.21.1',embedded_url:page.url(),total_bytes:bytes,files:listing.managed.map(e=>({project:e.project_id,file:e.filename,dependency:!e.user_selected})),progress_events:await page.evaluate(()=>window.modProgress.length)};
 await writeFile('test-results/mods-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(1000);await rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
