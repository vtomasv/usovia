// Run the signed client with an isolated profile and no corporate account.
import {spawn} from 'node:child_process';
import {readFile, mkdir, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import assert from 'node:assert/strict';
if (process.platform !== 'darwin') throw new Error('Run this verification on macOS.');
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = join(root, '.runtime/mac-signing');
const profile = join(evidence, 'smoke-profile');
const output = join(evidence, 'macos-client-verification.json');
const app = resolve(root, process.argv[2] || 'desktop/release-signed/mac-arm64/Usovia.app');
await access(join(app, 'Contents/MacOS/Usovia'));
await mkdir(profile, {recursive: true});
const listening = async () => {
  try {return (await fetch('http://127.0.0.1:11438/api/tags', {signal: AbortSignal.timeout(1000)})).ok;} catch {return false;}
};
assert.equal(await listening(), false, 'Close another Usovia instance before testing its embedded runtime.');
const env = {...process.env, USOVIA_DATA_DIR: profile, USOVIA_SMOKE_OUTPUT: output, USOVIA_HUB_URL: 'https://example.invalid'};
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/PASSWORD|SECRET|TOKEN|DATABASE|^PG|^POSTGRES|^NEON/.test(key)) delete env[key];
const child = spawn(join(app, 'Contents/MacOS/Usovia'), ['--packaging-smoke'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
let diagnostic = '';
child.stdout.on('data', bytes => diagnostic = (diagnostic + bytes).slice(-3000));
child.stderr.on('data', bytes => diagnostic = (diagnostic + bytes).slice(-3000));
const timeout = setTimeout(() => child.kill('SIGTERM'), 8 * 60 * 1000);
try {
  const code = await new Promise((yes, no) => {child.once('error', no); child.once('exit', yes);});
  assert.equal(code, 0, diagnostic);
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.platform, 'darwin');
  assert.equal(await listening(), false, 'Embedded runtime must stop after the client exits.');
  console.log(JSON.stringify(result));
} finally {clearTimeout(timeout);}
