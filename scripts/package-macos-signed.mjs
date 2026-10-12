// Release on the certificate owner's Mac. Credentials stay in the login Keychain.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, readdir, mkdir, stat, open, rm} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {build, Platform, Arch} = require('electron-builder');
const {signAsync} = require('@electron/osx-sign');
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = join(root, 'desktop');
const output = join(desktop, 'release-signed');
const evidence = join(root, '.runtime/mac-signing');
const profile = process.env.APPLE_KEYCHAIN_PROFILE || 'usovia-notary';
const {version} = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
const application = join(output, 'mac-arm64/Usovia.app');
const dmg = join(output, `Usovia-${version}-arm64.dmg`);
const zip = join(output, `Usovia-${version}-arm64.zip`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on a macOS Apple Silicon host.');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
await mkdir(evidence, {recursive: true});
const run = async (file, args, timeout = 600000) => execute(file, args, {cwd: root, timeout, maxBuffer: 8 * 1024 * 1024});
const identities = (await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])).stdout;
const candidates = [...identities.matchAll(/([A-F0-9]{40}) "(Developer ID Application: [^"]+ \(([A-Z0-9]{10})\))"/g)]
  .map(match => ({sha1: match[1], name: match[2], team: match[3]}));
const unique = [...new Map(candidates.map(identity => [identity.sha1, identity])).values()]
  .filter(identity => !process.env.USOVIA_SIGNING_TEAM_ID || identity.team === process.env.USOVIA_SIGNING_TEAM_ID);
if (unique.length !== 1) throw new Error('Exactly one valid Developer ID Application identity is required. Select a team with USOVIA_SIGNING_TEAM_ID.');
const identity = unique[0];
// Validation reads the existing profile; it does not create credentials or export secrets.
await run('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json']);
console.log(`Signing Usovia ${version} with Developer ID team ${identity.team}; Keychain profile ${profile}.`);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
async function machO(path) {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    const {bytesRead} = await handle.read(header, 0, 4, 0);
    return bytesRead === 4 && ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'));
  } finally {await handle.close();}
}
async function verifySignature(path, hardened = true) {
  await run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path]);
  const {stderr} = await run('/usr/bin/codesign', ['--display', '--verbose=4', path]);
  if (!stderr.includes(`TeamIdentifier=${identity.team}`) || !stderr.includes('Authority=Developer ID Application:') || !stderr.includes('Timestamp=')) throw new Error(`Developer ID / timestamp mismatch: ${path}`);
  if (hardened && !/flags=.*\(.*runtime.*\)/.test(stderr)) throw new Error(`Hardened runtime missing: ${path}`);
}
async function signApplication(options) {
  const resources = join(options.app, 'Contents/Resources');
  const binaries = [];
  for (const path of await files(resources)) if (await machO(path)) binaries.push(path);
  if (!binaries.some(path => path.endsWith('/browser-helper/usovia-browser-helper')) || !binaries.some(path => path.endsWith('/ollama/ollama'))) throw new Error('Native helper or embedded Ollama missing.');
  console.log(`Signing ${binaries.length} embedded native binaries with hardened runtime and no additional entitlements.`);
  for (const path of binaries) {
    await run('/usr/bin/codesign', ['--force', '--sign', identity.sha1, '--options', 'runtime', '--timestamp', path]);
    await verifySignature(path);
  }
  // Signing changes binary bytes. Preserve upstream hashes separately and record
  // the bytes actually distributed before Electron seals the app resources.
  const runtime = join(resources, 'ollama');
  const manifestPath = join(runtime, 'runtime-manifest.json');
  const source = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inventory = [];
  for (const path of await files(runtime)) if (path !== manifestPath) inventory.push({path: relative(runtime, path), sha256: digest(await readFile(path))});
  await writeFile(manifestPath, JSON.stringify({...source, sourceFiles: source.files, files: inventory, signingTeam: identity.team, signed: true}, null, 2) + '\n');
  await signAsync({...options, identity: identity.sha1, preAutoEntitlements: false,
    // Resources above are already signed; signing them again would change the inventory.
    ignore: path => path.startsWith(resources + '/') || (typeof options.ignore === 'function' && options.ignore(path)),
    optionsForFile: path => ({hardenedRuntime: true, entitlements: path === options.app || path.endsWith('.app') ? ['com.apple.security.cs.allow-jit'] : []})
  });
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', options.app]);
  await verifySignature(options.app);
}
async function notarize(path, label) {
  console.log(`Submitting ${label} to Apple's notary service; waiting for its decision.`);
  let result;
  try {
    result = JSON.parse((await run('/usr/bin/xcrun', ['notarytool', 'submit', path, '--keychain-profile', profile, '--wait', '--output-format', 'json'], 3600000)).stdout);
  } catch (error) {
    // Keep recoverable submission metadata, never credentials, after a timeout/error.
    if (error.stdout) await writeFile(join(evidence, `notary-${label}-error.json`), error.stdout);
    throw error;
  }
  await writeFile(join(evidence, `notary-${label}.json`), JSON.stringify(result, null, 2) + '\n');
  if (result.status !== 'Accepted') {
    if (result.id) {
      const log = await run('/usr/bin/xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile]);
      await writeFile(join(evidence, `notary-${label}-log.json`), log.stdout);
    }
    throw new Error(`Apple rejected ${label}: ${result.status}. See private notarization evidence.`);
  }
  console.log(`Apple accepted ${label}: ${result.id}`);
  return result.id;
}
const notaryIds = {};
if (!process.argv.includes('--verify-existing')) {
  await run(process.execPath, [join(root, 'scripts/build-browser-helper.mjs')]);
  await build({projectDir: desktop, targets: Platform.MAC.createTarget(['zip', 'dmg'], Arch.arm64), publish: 'never', config: {
    directories: {output}, forceCodeSigning: true,
    mac: {identity: identity.sha1, hardenedRuntime: true, notarize: false, preAutoEntitlements: false, sign: signApplication},
    dmg: {sign: true},
    afterSign: async context => {
      const appPath = join(context.appOutDir, 'Usovia.app');
      const submission = join(evidence, `Usovia-${version}-notary.zip`);
      await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, submission]);
      notaryIds.application = await notarize(submission, 'application');
      await run('/usr/bin/xcrun', ['stapler', 'staple', appPath]);
      await run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
      await rm(submission);
    }
  }});
  // electron-builder's DMG signature does not request a secure timestamp explicitly.
  await run('/usr/bin/codesign', ['--force', '--sign', identity.sha1, '--timestamp', dmg]);
  notaryIds.installer = await notarize(dmg, 'installer');
  await run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
}
console.log('Checking signatures, stapled tickets, Gatekeeper and packaged source integrity.');
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', application]);
await verifySignature(application);
await verifySignature(dmg, false);
for (const path of [application, dmg]) await run('/usr/bin/xcrun', ['stapler', 'validate', path]);
await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', application]);
await run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
const {extractFile} = require('@electron/asar');
const resources = join(application, 'Contents/Resources');
const archive = join(resources, 'app.asar');
const sourceFiles = (await readdir(desktop, {withFileTypes: true})).filter(entry => entry.isFile() && /\.(mjs|cjs)$/.test(entry.name)).map(entry => join(desktop, entry.name));
sourceFiles.push(...await files(join(desktop, 'ui')));
for (const path of sourceFiles) {
  const name = relative(desktop, path);
  if (!/^([^/]+\.(mjs|cjs)|ui\/[^/]+\.(js|css|html|png))$/.test(name)) continue;
  if (digest(extractFile(archive, name)) !== digest(await readFile(path))) throw new Error(`Packaged source mismatch: ${name}`);
}
for (const name of ['analysis.mjs', 'providers.mjs', 'cli-entry.mjs']) if (digest(await readFile(join(root, 'shared', name))) !== digest(await readFile(join(resources, 'shared', name)))) throw new Error(`Packaged shared source mismatch: ${name}`);
const native = [];
for (const path of await files(join(application, 'Contents'))) if (await machO(path)) {await verifySignature(path); native.push(relative(application, path));}
const manifest = JSON.parse(await readFile(join(resources, 'ollama/runtime-manifest.json'), 'utf8'));
for (const entry of manifest.files) if (digest(await readFile(join(resources, 'ollama', entry.path))) !== entry.sha256) throw new Error(`Runtime inventory mismatch: ${entry.path}`);
const artifacts = [];
for (const path of [dmg, zip]) artifacts.push({file: relative(root, path), bytes: (await stat(path)).size, sha256: digest(await readFile(path))});
const proof = {ok: true, version, platform: 'macos-arm64', teamId: identity.team, signed: true, notarized: true, hardenedRuntime: true, gatekeeper: true, stapledApplication: true, stapledInstaller: true, sourceIntegrity: true, runtimeInventory: true, nativeBinaries: native, notaryIds, artifacts};
await writeFile(join(evidence, 'macos-release-verification.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ok: true, version, signed: true, notarized: true, gatekeeper: true, nativeBinaries: native.length, artifacts}));
