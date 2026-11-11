import { chromium } from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const source=await readFile('src-tauri/src/migration.rs','utf8');
const constant=name=>source.match(new RegExp(`const ${name}: &str = "([^"]+)"`))[1];
const base=await mkdtemp(join(tmpdir(),'patronlauncher-first-run-'));
const old=join(base,constant('LEGACY_APP_NAME')),destination=join(base,constant('DATA_DIR_NAME'));
const account=randomUUID(),profile=randomUUID();
await mkdir(join(old,'instances',profile,'saves'),{recursive:true});
await mkdir(join(old,'backups',profile),{recursive:true});
await mkdir(join(old,'runtimes','21'),{recursive:true});
const settings=JSON.stringify({accounts:[{id:account,name:'MigratedPlayer',uuid:'b50ad385829d3141a2167e7d7539ba7f',kind:'Local'}],profiles:[{id:profile,name:'ExistingWorld',version:'1.21.11'}],selected_account:account,selected_profile:profile,discord_client_id:'',java_path:'',memory_mb:4096,microsoft_client_id:''});
await writeFile(join(old,'settings.json'),settings);
await writeFile(join(old,'instances',profile,constant('LEGACY_PROFILE_META')),JSON.stringify({id:profile,name:'ExistingWorld',version:'1.21.11'}));
await writeFile(join(old,'instances',profile,'saves','world-marker'),'world-bytes');
await writeFile(join(old,'instances',profile,'options.txt'),'fov:0.75');
await writeFile(join(old,'backups',profile,'marker'),'backup-bytes');
await writeFile(join(old,'runtimes','21','marker'),'runtime-bytes');
const env={...process.env,APPDATA:base,WEBVIEW2_USER_DATA_FOLDER:join(base,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19351 --remote-debugging-address=127.0.0.1'};
delete env.PATRONLAUNCHER_DATA_DIR;delete env[constant('LEGACY_DATA_ENV')];
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{env,windowsHide:true,stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(`App exited ${app.exitCode}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:19351',{timeout:1000});break;}catch{await delay(300);}}
 assert(browser);let page;for(let i=0;i<50;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}assert(page);await page.locator('.hero h2').filter({hasText:'ExistingWorld'}).waitFor({timeout:30000});
 const state=await page.evaluate(async()=>(await window.__TAURI_INTERNALS__.invoke('get_state')).state);assert.equal(state.load_failed,false);assert.equal(state.selected_account,account);assert.equal(state.selected_profile,profile);assert.equal(await page.title(),'PatronLauncher');assert.equal(await readFile(join(old,'settings.json'),'utf8'),settings);
 for(const [p,bytes] of [[['instances',profile,'saves','world-marker'],'world-bytes'],[['instances',profile,'options.txt'],'fov:0.75'],[['backups',profile,'marker'],'backup-bytes'],[['runtimes','21','marker'],'runtime-bytes']]){assert.equal(await readFile(join(destination,...p),'utf8'),bytes);assert.equal(await readFile(join(old,...p),'utf8'),bytes);}
 const receipt=JSON.parse(await readFile(join(destination,constant('MARKER')),'utf8'));assert.equal(receipt.verified,true);assert.equal(receipt.tree.files.find(f=>f.path==='settings.json').sha256,createHash('sha256').update(settings).digest('hex'));
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/native-first-run-migration.png'});await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(700);assert.notEqual(app.exitCode,null);
 console.log('First-run migration passed: default renamed data root, legacy account/profile identity, world/options/backup/runtime bytes, verified receipt and original files preserved.');
}finally{if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(700);const resolved=await realpath(base);assert.equal(dirname(resolved).toLowerCase(),(await realpath(tmpdir())).toLowerCase());assert(basename(resolved).startsWith('patronlauncher-first-run-'));await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
