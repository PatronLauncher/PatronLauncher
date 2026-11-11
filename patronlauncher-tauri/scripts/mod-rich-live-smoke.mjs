import {chromium} from '@playwright/test';import {spawn} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'patron-rich-live-'));await writeFile(join(root,'settings.json'),JSON.stringify({discord_client_id:''}));
const app=spawn(resolve('src-tauri/target/release/patronlauncher-tauri.exe'),[],{windowsHide:true,env:{...process.env,PATRONLAUNCHER_DATA_DIR:root,WEBVIEW2_USER_DATA_FOLDER:join(root,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19351 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19351',{timeout:1000});break;}catch{assert.equal(app.exitCode,null);await delay(400);}}
 assert(browser);let page;for(let i=0;i<60;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}assert(page);assert.match(page.url(),/^https?:\/\/tauri\.localhost/);await page.locator('.hero').waitFor();await page.locator('.startup-overlay').waitFor({state:'detached'});
 await page.locator('[data-p="mods"]').click();await page.getByLabel('Mod ara',{exact:true}).fill('iris');
 await page.locator('.mod-card').first().waitFor({timeout:45000});await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mod-real-rows.png'});
 await page.locator('.mod-card').filter({has:page.getByRole('heading',{name:'Iris Shaders',exact:false})}).first().getByRole('button',{name:'Görüntüle',exact:true}).click({timeout:45000});
 await page.locator('.rich-content h2,.rich-content h1,.rich-content p').first().waitFor({timeout:45000});
 assert.equal(await page.locator('.rich-content script,.rich-content iframe,.rich-content svg,.rich-content style').count(),0);
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mod-real-description.png'});
 await page.getByRole('button',{name:'Galeri',exact:true}).click();const img=page.locator('.mod-gallery img').first();await img.waitFor({timeout:45000});assert((await img.getAttribute('src')).startsWith('blob:'));await img.click();await page.getByRole('dialog').locator('img').waitFor({timeout:30000});await page.screenshot({path:'test-results/mod-real-gallery-lightbox.png'});
 console.log(JSON.stringify({project:'Iris Shaders',embedded_url:page.url(),headings:'rendered',gallery_blob:true,lightbox:true}));
}finally{if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();await delay(800);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
