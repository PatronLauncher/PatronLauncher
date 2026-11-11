import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const exe = resolve(process.env.PATRONLAUNCHER_CORE_EXE || 'src-tauri/target/release/patronlauncher-tauri.exe');
const base = await mkdtemp(join(tmpdir(), 'patronlauncher-core-ipc-'));
const root = join(base, '#PatronLauncher');
await mkdir(root);
const accountId = randomUUID(), profileId = randomUUID();
const legacy = {accounts:[{id:accountId,name:'OldPlayer',uuid:'b50ad385829d3141a2167e7d7539ba7f',kind:'Local'}],profiles:[{id:profileId,name:'OldWorld',version:'1.21.11'}],selected_account:accountId,selected_profile:profileId,microsoft_client_id:'',discord_client_id:'',java_path:'',memory_mb:8192};
await writeFile(join(root,'settings.json'),JSON.stringify(legacy));
await mkdir(join(root,'instances',profileId,'saves'),{recursive:true});
await writeFile(join(root,'instances',profileId,'saves','world-marker'),'world');
const port=19348;
const app=spawn(exe,[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,WEBVIEW2_USER_DATA_FOLDER:join(root,'webview-one'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`},stdio:['ignore','pipe','pipe']});
let output='';app.stderr.on('data',chunk=>{output+=chunk.toString();});app.stdout.on('data',chunk=>{output+=chunk.toString();});
let browser;
try {
 for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(`Native exit ${app.exitCode}: ${output}`);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch{await delay(400);}}
 assert(browser,'No WebView2 endpoint');const context=browser.contexts()[0];let page;
 for(let i=0;i<60;i++){page=context.pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}
 assert(page,'No local Tauri page');await page.locator('.hero').waitFor();
 const call=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 const state=(await call('get_state')).state;
 assert.equal(state.load_failed,false);assert.equal(state.selected_profile,profileId);assert.equal(state.selected_account,accountId);assert.equal(state.settings.memory_mb,8192);
 // React must display records supplied by the real Rust core.
 assert.equal(await page.locator('.hero h2').innerText(),'OldWorld');
 assert((await page.locator('.account-picker').innerText()).includes('OldPlayer'));
 for(let i=0;i<160;i++){if(!(await call('get_state')).state.busy){await delay(200);if(!(await call('get_state')).state.busy)break;}await delay(250);}
 assert.equal((await call('get_state')).state.busy,false,'Startup background work must finish');
 assert.equal((await call('get_state')).state.profiles[0].loader,'Vanilla');
 const loaders=await call('list_loader_versions',{minecraftVersion:'1.21.11'});
 assert(loaders.versions.some(v=>v.version===loaders.default_version&&v.stable));
 await assert.rejects(()=>call('set_profile_loader',{id:profileId,loader:'Fabric',loaderVersion:'../evil'}));
 const attached=await call('set_profile_loader',{id:profileId,loader:'Fabric',loaderVersion:null});
 const fabricProfile=attached.state.profiles.find(p=>p.id===profileId);
 assert.equal(fabricProfile.loader,'Fabric');assert(loaders.versions.some(v=>v.version===fabricProfile.loader_version&&v.stable));
 const fabricSaved=JSON.parse(await readFile(join(root,'settings.json'),'utf8'));
 assert.equal(fabricSaved.profiles[0].loader,'Fabric');
 const fabricMeta=JSON.parse(await readFile(join(root,'instances',profileId,'.patronlauncher-profile.json'),'utf8'));
 assert.equal(fabricMeta.loader_version,fabricProfile.loader_version);
 await call('set_profile_loader',{id:profileId,loader:'Vanilla',loaderVersion:null});
 assert.equal(await readFile(join(root,'instances',profileId,'saves','world-marker'),'utf8'),'world');
 await writeFile(join(root,'instances',profileId,'options.txt'),'fov:0.7');
 await call('backup_profile');
 for(let i=0;i<120&&(await call('get_state')).state.busy;i++)await delay(100);
 await writeFile(join(root,'instances',profileId,'options.txt'),'fov:0.9');
 await call('restore_profile',{confirmed:true});
 for(let i=0;i<120&&(await call('get_state')).state.busy;i++)await delay(100);
 assert.equal(await readFile(join(root,'instances',profileId,'options.txt'),'utf8'),'fov:0.7');
 await page.locator('[data-p="folder"]').click();
 const filesLayout=await page.evaluate(()=>{const side=document.querySelector('.side').getBoundingClientRect();return {sideWidth:side.width, cards:[...document.querySelectorAll('.folder-grid .pf')].map(el=>el.getBoundingClientRect().right),width:innerWidth};});
 assert(filesLayout.sideWidth>60);assert.equal(filesLayout.cards.length,10);assert(filesLayout.cards.every(right=>right<=filesLayout.width));
 // Exercise real folder buttons, then inspect/close only Explorer windows under this test root.
 const psRoot=root.replaceAll("'","''");
 for(const [title,relative] of [['Oyun klasörü',''],['Modlar','mods'],['Shader paketleri','shaderpacks'],['Şemalar','schematics'],['Dünyalar','saves'],['Kaynak paketleri','resourcepacks'],['Ekran görüntüleri','screenshots'],['Günlükler','logs'],['Yapılandırma','config'],['Yedekler','backups']]) {
  await page.locator('.folder-grid .pf').filter({hasText:title}).getByRole('button').click();
  await delay(1100);
  const folders=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$shell=New-Object -ComObject Shell.Application; @($shell.Windows()) | ForEach-Object {try {$p=$_.Document.Folder.Self.Path; if($p.StartsWith('${psRoot}',[StringComparison]::OrdinalIgnoreCase)){Write-Output $p; $_.Quit()}} catch {}}`],{windowsHide:true,encoding:'utf8'});
  const expected=relative==='backups'?join(root,'backups',profileId):join(root,'instances',profileId,relative);
  assert(folders.toLowerCase().includes(expected.toLowerCase()),title+': '+folders);
 }
 console.log('Hash-path backup/restore and all ten real folder buttons passed.');
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/native-files.png'});
 await page.locator('[data-p="versions"]').click();
 await page.getByRole('button',{name:'Minecraft 1.18 ailesini seç',exact:true}).waitFor();
 assert(await page.locator('.v-card').count()>=10);
 await page.getByRole('button',{name:'Minecraft 1.18 ailesini seç',exact:true}).click();
 const patches=await page.getByLabel('Ailedeki sürüm').locator('option').allTextContents();
 for(const id of ['1.18','1.18.1','1.18.2'])assert(patches.includes(id));
 await page.getByLabel('Ailedeki sürüm').selectOption('1.18.2');
 await page.locator('#version-create').click();
 assert.equal(await page.getByLabel('Sürüm profil adı').inputValue(),'Minecraft 1.18.2 · Vanilla');
 await page.getByRole('dialog',{name:'Profil oluştur',exact:true}).getByRole('button',{name:'Pencereyi kapat'}).click();
 const catalog=await call('list_version_catalog');assert(catalog.some(v=>v.type==='old_beta'));assert(catalog.some(v=>v.type==='snapshot'));
 await page.screenshot({path:'test-results/native-versions.png'});
 await page.locator('[data-p="home"]').click();
 await page.evaluate(async()=>{window.coreEvents=[];const internals=window.__TAURI_INTERNALS__;await internals.invoke('plugin:event|listen',{event:'patronlauncher://core-event',target:{kind:'Any'},handler:internals.transformCallback(e=>window.coreEvents.push(e.payload))});});
 await assert.rejects(()=>call('select_profile',{id:randomUUID()}));
 await assert.rejects(()=>call('create_profile',{name:'Test',versionId:'../evil'}));
 await assert.rejects(()=>call('add_local_account',{name:'../evil'}));
 await assert.rejects(()=>call('restore_profile',{confirmed:false}));
 await assert.rejects(()=>call('open_folder',{target:'../../escape'}));
 await assert.rejects(()=>call('open_external',{url:'https://minecraft.net.evil.invalid/'}));
 await assert.rejects(()=>call('save_settings',{settings:{...state.settings,memory_mb:1}}));
 await page.locator('[data-p="account"]').click();
 await page.getByText("Parolan PatronLauncher'a girilmez.",{exact:true}).waitFor();
 await page.getByLabel('Oyuncu adı').fill('SecondPlayer');
 await page.getByRole('button',{name:'Yerel hesap oluştur',exact:true}).click();
 await page.locator('.pf.sel').filter({hasText:'SecondPlayer'}).waitFor();
 await page.screenshot({path:'test-results/native-accounts.png'});
 await delay(150);
 assert((await page.evaluate(()=>window.coreEvents)).some(e=>e.event.kind==='status'));
 const accounts=(await call('list_accounts')).state.accounts;
 const added=accounts.find(a=>a.name==='SecondPlayer');assert(added);
 await call('select_account',{id:accountId});await call('remove_account',{id:added.id});
 await call('save_settings',{settings:{...state.settings,memory_mb:4096}});
 const saved=JSON.parse(await readFile(join(root,'settings.json'),'utf8'));
 assert.equal(saved.memory_mb,4096);assert.equal(saved.selected_profile,profileId);assert.equal(saved.accounts[0].id,accountId);
 assert.equal(await readFile(join(root,'instances',profileId,'saves','world-marker'),'utf8'),'world');
 assert.equal(JSON.stringify(saved).includes('access_token'),false);
 // Exercise the complete native consent flow against real Modrinth data in this temporary root.
 await page.locator('[data-p="versions"]').click();
 await page.getByRole('button',{name:'Minecraft 1.21 ailesini seç',exact:true}).click();
 await page.getByLabel('Ailedeki sürüm').selectOption('1.21.11');
 await page.getByRole('button',{name:'Fabric',exact:true}).click();
 await page.getByLabel('Performans paketi',{exact:true}).check();
 await page.locator('#version-create').click();
 await page.getByLabel('Sürüm profil adı').fill('Native Mod Pack');
 await page.getByRole('dialog',{name:'Profil oluştur',exact:true}).getByRole('button',{name:'Oluştur',exact:true}).click();
 await page.getByRole('dialog',{name:'Mod indirmesini onayla'}).waitFor();
 const modPlan=await call('preview_performance_pack',{minecraftVersion:'1.21.11'});
 assert(modPlan.mods.some(m=>m.title==='Sodium'));assert(modPlan.mods.length>=3);
 await assert.rejects(()=>call('create_configured_profile',{name:'Unapproved',versionId:'1.21.11',loader:'Fabric',loaderVersion:null,planId:modPlan.plan_id,confirmed:false}));
 assert.equal((await call('get_state')).state.profiles.length,1);
 await page.screenshot({path:'test-results/native-mod-consent.png'});
 await page.getByRole('button',{name:'Onayla ve profili oluştur',exact:true}).click();
 await page.locator('.hero h2').filter({hasText:'Native Mod Pack'}).waitFor({timeout:120000});
 const modState=(await call('get_state')).state;const modProfile=modState.profiles.find(p=>p.name==='Native Mod Pack');assert(modProfile);assert.equal(modProfile.loader,'Fabric');
 for(const mod of modPlan.mods){const bytes=await readFile(join(root,'instances',modProfile.id,'mods',mod.filename));assert.equal(bytes.length,mod.size);}
 const receipt=JSON.parse(await readFile(join(root,'instances',modProfile.id,'.patronlauncher-mods.json'),'utf8'));assert.equal(receipt.length,modPlan.mods.length);
 assert((await page.evaluate(()=>window.coreEvents)).some(e=>e.progress&&e.event.kind==='status'&&e.event.result.startsWith('Modlar:')));
 for(let i=0;i<160;i++){if(!(await call('get_state')).state.busy){await delay(200);if(!(await call('get_state')).state.busy)break;}await delay(250);}
 await call('remove_profile',{id:modProfile.id});
 console.log(`Native consent flow passed: ${modPlan.mods.length} real Modrinth JARs installed; unapproved request rejected.`);
 // Read the lock protection through a second process without touching real user data.
 const second=spawn(exe,[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,WEBVIEW2_USER_DATA_FOLDER:join(root,'webview-two'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19349 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
 let other;
 try {
  for(let i=0;i<80;i++){try{other=await chromium.connectOverCDP('http://127.0.0.1:19349',{timeout:1000});break;}catch{await delay(300);}}
  assert(other);let otherPage;
  for(let i=0;i<40;i++){otherPage=other.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));if(otherPage)break;await delay(200);}
  assert(otherPage);await otherPage.locator('.hero').waitFor();
  assert.equal(await otherPage.evaluate(async()=> (await window.__TAURI_INTERNALS__.invoke('get_state')).state.load_failed),true);
  await assert.rejects(()=>otherPage.evaluate(()=>window.__TAURI_INTERNALS__.invoke('add_local_account',{name:'BlockedPlayer'})));
  await otherPage.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(500);
 } finally {if(other)await other.close().catch(()=>{});if(second.exitCode===null)second.kill();}
 await page.locator('.window-close').evaluate(el=>el.click()).catch(()=>{});await delay(1000);
 assert.notEqual(app.exitCode,null);
 // Invalid CLI forms must fail without creating a window or even acquiring the data lock.
 for(const args of [['--install-java'],['--smoke-launch','../evil'],['--smoke-launch','1.21.11','--fabric','../evil']]) {
  const cliRoot=join(root,randomUUID());const child=spawn(exe,args,{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:cliRoot},stdio:'ignore'});
  const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,1);
 }
 console.log('Native core IPC passed: legacy records, persisted settings, local accounts, input validation, events, second-instance lock, headless CLI; live React records and Fabric loader IPC verified.');
} finally {if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);await rm(base,{recursive:true,force:true});}







