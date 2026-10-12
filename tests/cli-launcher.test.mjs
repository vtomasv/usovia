import test from 'node:test';
import assert from 'node:assert/strict';
import {cliLauncher} from '../desktop/cli-launcher.mjs';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const input={proxyUrl:'http://usovia:synthetic@127.0.0.1:11440',caPath:"C:\\Account with spaces & 10%\\root.pem",executable:process.execPath,entry:'C:\\Usovia\\cli-entry.mjs'};
test('Windows launcher isolates trust and proxy without bypassing OS TLS verification',()=>{
  const {name,content}=cliLauncher({...input,platform:'win32'});
  assert.ok(name.endsWith('.cmd'));
  assert.ok(content.includes('setlocal DisableDelayedExpansion'));
  assert.ok(content.includes('10%%'));
  assert.ok(content.includes('NODE_EXTRA_CA_CERTS='));
  assert.ok(content.includes('where gemini.cmd'));
  assert.ok(!content.includes('ExecutionPolicy'));
  assert.throws(()=>cliLauncher({...input,platform:'win32',caPath:'unsafe"\r\nset something'}),/caracteres/);
});
test('Mac launcher retains quoted argv and embedded Node normalization',()=>{
  const {name,content}=cliLauncher({...input,platform:'darwin',caPath:"/a path/owner's cert"});
  assert.ok(name.endsWith('.command'));
  assert.ok(content.includes("owner'\\''s"));
  assert.ok(content.includes('ELECTRON_RUN_AS_NODE=1'));
  assert.ok(content.endsWith('"$@"\n'));
});
test('Windows cmd launcher executes an npm-style CLI with scoped variables and spaced arguments',{skip:process.platform!=='win32'?'requires Windows cmd':false},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'usovia cli & 10%-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const cliDir=join(directory,'node_modules/@google/gemini-cli/dist');await mkdir(cliDir,{recursive:true});
  const output=join(directory,'result.json');
  await writeFile(join(directory,'gemini.cmd'),'@echo off\r\n');
  await writeFile(join(cliDir,'index.js'),`require('fs').writeFileSync(process.env.USOVIA_CLI_CHECK,JSON.stringify({proxy:process.env.HTTPS_PROXY,ca:process.env.NODE_EXTRA_CA_CERTS,args:process.argv.slice(2)}))`);
  // Use a tiny CommonJS adapter because this test executes Node, not the packaged Electron host.
  const entry=join(directory,'entry.cjs');await writeFile(entry,'process.argv.splice(1,1);require(process.argv[1]);');
  const launcher=cliLauncher({...input,platform:'win32',entry});
  const file=join(directory,launcher.name);await writeFile(file,launcher.content);
  execFileSync('cmd.exe',['/d','/s','/c',`""${file}" "argument with spaces""`],{env:{...process.env,PATH:directory+';'+process.env.PATH,USOVIA_CLI_CHECK:output},windowsHide:true,windowsVerbatimArguments:true});
  const result=JSON.parse(await readFile(output,'utf8'));
  assert.equal(result.proxy,input.proxyUrl);assert.equal(result.ca,input.caPath);assert.deepEqual(result.args,['argument with spaces']);
  assert.notEqual(process.env.HTTPS_PROXY,input.proxyUrl);
});
