import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dataRoot=await mkdtemp(join(tmpdir(),'patronlauncher-window-smoke-'));
await writeFile(join(dataRoot,'settings.json'),JSON.stringify({discord_client_id:''}));
const port=19347;
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:dataRoot,WEBVIEW2_USER_DATA_FOLDER:join(dataRoot,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`},stdio:'ignore'});
let browser;
try {
  for(let i=0;i<80;i++) {
    if(app.exitCode!==null)throw new Error(`Native app exited: ${app.exitCode}`);
    try {browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch{await delay(500);}
  }
  assert(browser,'WebView2 debugging endpoint unavailable');
  const context=browser.contexts()[0];let page;
  for(let i=0;i<40;i++){page=context.pages().find(p=>!p.url().startsWith('about:'));if(page)break;await delay(250);}
  assert(page,'Native page unavailable');
  assert.match(page.url(), /^https?:\/\/tauri\.localhost/, 'Release must load embedded assets, not a Vite development URL');
  await page.locator('.hero').waitFor();
  await page.locator('.startup-overlay').waitFor({state:'detached',timeout:2500});
  const call=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const appearance=await call('read_appearance');assert.equal(appearance.skin,'patron');
  await call('save_appearance',{preferences:{...appearance,skin:'mavi',particles:false}});
  assert.equal((await call('read_appearance')).skin,'mavi');
  await assert.rejects(()=>call('save_appearance',{preferences:{...appearance,skin:'bad'}}));
  await call('save_appearance',{preferences:appearance});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  assert.equal(await page.locator('.window-controls button').count(),3);
  assert.equal(await page.locator('#play').count(),1);
  assert.equal(await page.locator('.hero h2').innerText(),'Yeni bir dünya seni bekliyor.');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/native-preview.png'});
  await page.keyboard.press('F11');await delay(500);assert.equal(await call('plugin:window|is_fullscreen',{label:'main'}),true);await page.keyboard.press('F11');await delay(500);assert.equal(await call('plugin:window|is_fullscreen',{label:'main'}),false);
  const initial=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
  await page.locator('.window-controls button').nth(1).click();
  await delay(800);
  const maximized=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
  assert(initial.w!==maximized.w || initial.h!==maximized.h,'Native maximize did not resize the window');
  await page.locator('.window-controls button').nth(1).click();await delay(400);
  await page.locator('.window-controls button').nth(0).click();await delay(500);
  assert.equal(await page.locator('#toast').innerText(),'','Window command reported an error');
  assert.deepEqual(errors,[]);
  // DOM click works while minimized, allowing the test to close only its own preview.
  const exited=new Promise(resolve=>app.once('exit',resolve));
  await page.locator('.window-controls button').nth(2).evaluate(el=>el.click()).catch(()=>{});
  await Promise.race([exited,delay(5000)]);
  assert(app.exitCode!==null,'Native close did not exit the preview');
  console.log('Native WebView2: UI loaded; maximize/restore, minimize and close passed.');
} finally {if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(500);await rm(dataRoot,{recursive:true,force:true});}

