// Native packaging check. Never activates an account or contacts the corporate Hub.
import assert from 'node:assert/strict';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cliLauncher} from './cli-launcher.mjs';
export async function smoke({app, window, tray, safeStorage, snapshot, save, load, runtimeRequest, actions, output}) {
  assert.equal(app.isPackaged, true);
  assert.ok(['win32', 'darwin'].includes(process.platform));
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const encrypted = safeStorage.encryptString('synthetic-packaging-check');
  assert.equal(safeStorage.decryptString(encrypted), 'synthetic-packaging-check');
  const state = await snapshot();
  assert.equal(state.account, null);
  assert.equal(state.consent.capture, false);
  assert.equal(state.proxyActive, false);
  assert.equal(state.systemBrowser.supported, true);
  await save({...await load(), model: 'synthetic-save-roundtrip'});
  assert.equal((await load()).model, 'synthetic-save-roundtrip');
  assert.equal(tray.isDestroyed(), false);
  assert.equal(await window.webContents.executeJavaScript('typeof window.usovia.invoke'), 'function');
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("enable-system-browsers").disabled'), true);
  window.close(); assert.equal(window.isDestroyed(), false); assert.equal(window.isVisible(), false);
  for (let attempts = 0; attempts < 60; attempts++) {
    if ((await snapshot()).runtime.ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal((await snapshot()).runtime.ready, true, 'Embedded Ollama must start');
  await runtimeRequest('/api/pull', {name: 'qwen2.5:0.5b', stream: false});
  const chat = await actions.chat({model: 'qwen2.5:0.5b', prompt: 'Responde brevemente: ¿cuánto es dos más dos?'});
  assert.ok(chat.response?.length > 0, 'CPU model must generate a real answer');
  const manifest = JSON.parse(await readFile(join(process.resourcesPath, 'ollama/runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.platform, process.platform === 'win32' ? 'win32-x64' : 'darwin-arm64');
  if (process.platform === 'win32') assert.equal(manifest.acceleration, 'cpu');
  const launcher = cliLauncher({platform: process.platform, proxyUrl: 'http://127.0.0.1:11440', caPath: '/example/root.pem', executable: process.execPath, entry: '/example/cli-entry.mjs'});
  assert.equal(launcher.name.endsWith(process.platform === 'win32' ? '.cmd' : '.command'), true);
  await writeFile(output, JSON.stringify({ok: true, platform: process.platform, arch: process.arch, packaged: true, tray: true, encryptedStateRoundtrip: true, closeKeepsTray: true, rendererBridge: true, defaultCapture: false, systemBrowserSupported: true, ollamaVersion: manifest.version, realLocalInference: true, responseCharacters: chat.response.length}, null, 2));
}
