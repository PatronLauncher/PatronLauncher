// Isolated real runtime checks. No user settings, worlds or credentials are changed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, link, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const base = await mkdtemp(join(tmpdir(), 'patronlauncher-hash-runtime-'));
const root = join(base, '#PatronLauncher');
await mkdir(root);
const exe = resolve('src-tauri/target/release/patronlauncher-tauri.exe');
const env = { ...process.env, PATRONLAUNCHER_DATA_DIR: root };
const report = { root, results: [] };
await mkdir('test-results', { recursive: true });
async function record(name, work) {
  try { await work(); report.results.push({ name, passed: true }); }
  catch (e) { report.results.push({ name, passed: false, error: String(e) }); }
  await writeFile('test-results/hash-path-runtime.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.results.at(-1)));
}
await record('fresh Java 21 install and execution from # path', async () => {
  const child = spawn(exe, ['--install-java', '21'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  const timer = setTimeout(() => child.kill(), 240000);
  const code = await new Promise(r => child.once('exit', r)); clearTimeout(timer);
  await writeFile('test-results/hash-java-install.log', output);
  assert.equal(code, 0, output);
  assert(output.includes('#PatronLauncher') && output.includes('Java hazır'));
});
// Hard-link immutable, checksum-verified cached downloads only. Natives are freshly
// extracted in the test root; never link writable files/settings/user instances.
async function cachedDownloads(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'natives' || entry.name.endsWith('.part')) continue;
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) await cachedDownloads(from, to);
    else if (entry.isFile()) { try { await link(from, to); } catch { await copyFile(from, to); } }
  }
}
const cache = join(process.env.APPDATA, 'PLauncher', 'minecraft');
for (const folder of ['assets', 'libraries', 'versions']) {
  await cachedDownloads(join(cache, folder), join(root, 'minecraft', folder));
}
function closeOwnJava(parentId) {
  const command = `$p=Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentId}" | Where-Object {$_.Name -eq 'java.exe'}; foreach($j in $p){$process=Get-Process -Id $j.ProcessId -ErrorAction SilentlyContinue; if($process){[void]$process.CloseMainWindow()}}`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
}
for (const fabric of [false, true]) await record(fabric ? 'Fabric actual client initialization from # path' : 'Vanilla actual client initialization from # path', async () => {
  const args = ['--smoke-launch', '1.21.11', ...(fabric ? ['--fabric'] : [])];
  const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', ready = false, log = '';
  child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  try {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && child.exitCode === null) {
      await delay(1000);
      const profiles = await readdir(join(root, 'instances')).catch(() => []);
      for (const p of profiles) {
        const text = await readFile(join(root, 'instances', p, 'patronlauncher-game.log'), 'utf8').catch(() => '');
        if (text.includes('Sound engine started') || text.includes('Created:') || text.includes('OpenAL initialized')) {
          if (!fabric || /Loading Minecraft .*Fabric Loader/.test(text)) { ready = true; log = text; break; }
        }
      }
      if (ready) break;
    }
    assert(ready, `Client did not reach rendering/audio initialization: ${output}`);
    closeOwnJava(child.pid);
    for (let i = 0; i < 30 && child.exitCode === null; i++) await delay(500);
    assert.equal(child.exitCode, 0, output);
  } finally {
    if (child.exitCode === null) {
      // taskkill is restricted to this freshly spawned test process tree.
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    }
    await writeFile(`test-results/hash-${fabric ? 'fabric' : 'vanilla'}-launch.log`, output + '\n' + log);
  }
});
console.log(`Isolated runtime artifacts retained for inspection: ${root}`);
if (report.results.some(r => !r.passed)) process.exitCode = 1;
