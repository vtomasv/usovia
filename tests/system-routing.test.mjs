import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {selectivePac,SystemRouting} from '../desktop/system-routing.mjs';
import {defaultPolicy} from '../shared/providers.mjs';
import {generateAuthority} from '../desktop/certificate.mjs';
const evaluate=(policy,active=true)=>{const context=vm.createContext({});vm.runInContext(selectivePac(policy,11442,{active}),context);return context.FindProxyForURL;};
test('system PAC routes exact enabled LLM hosts only, no wildcard, login, non-TLS or unrelated sites',()=>{
  const route=evaluate(defaultPolicy());
  assert.equal(route('https://api.openai.com/v1/responses','api.openai.com'),'PROXY 127.0.0.1:11442; DIRECT');
  assert.equal(route('https://gemini.google.com/','GEMINI.GOOGLE.COM'),'PROXY 127.0.0.1:11442; DIRECT');
  for(const host of ['example.com','accounts.google.com','gemini.google.com.evil.example','sub.api.openai.com','127.0.0.1','api.mistral.ai','chatgpt.com'])assert.equal(route('https://'+host+'/',host),'DIRECT',host);
  assert.equal(route('http://api.openai.com/','api.openai.com'),'DIRECT');
  assert.equal(route('wss://api.openai.com/','api.openai.com'),'DIRECT');
});
test('pause produces DIRECT PAC, changes from central stay within the fixed catalog',()=>{
  assert.equal(evaluate(defaultPolicy(),false)('https://gemini.google.com/','gemini.google.com'),'DIRECT');
  const policy=defaultPolicy();policy.endpoints.find(e=>e.id==='gemini-web').enabled=false;
  assert.equal(evaluate(policy)('https://gemini.google.com/','gemini.google.com'),'DIRECT');
  policy.endpoints.push({id:'evil',url:'https://bank.example/',enabled:true});assert.throws(()=>selectivePac(policy,11442));assert.throws(()=>selectivePac(defaultPolicy(),0));
});
test('PAC service, lease and installer contain no private key, upstream keys or installation token',{skip:process.platform!=='darwin'?'macOS-only routing service':false},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'usovia-routing-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const routing=new SystemRouting({directory,helper:'/a path/with\'quote/helper',policy:defaultPolicy(),port:0});
  t.after(()=>routing.stop());await routing.start();let r=await fetch(routing.pacUrl);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/x-ns-proxy-autoconfig');assert.ok((await r.text()).includes('var hosts = []'));
  assert.equal((await fetch(routing.pacUrl,{headers:{Origin:'https://evil.example'}})).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${routing.port}/wrong.pac`)).status,404);
  await routing.setActive(true);const plan=await routing.prepare(await generateAuthority());assert.equal((await stat(plan.path)).mode&0o777,0o600);
  const manifest=JSON.parse(await readFile(join(directory,routing.id+'.manifest.json'),'utf8'));
  assert.equal(manifest.uid,process.getuid());assert.ok(manifest.certificate);assert.ok(!JSON.stringify(manifest).includes('PRIVATE KEY'));
  assert.equal(plan.path,join(directory,routing.id+'.manifest.json'));assert.ok(!JSON.stringify(manifest).includes('PRIVATE KEY'));
  const lease=JSON.parse(await readFile(manifest.leasePath,'utf8'));assert.equal(lease.active,true);assert.equal(lease.closed,false);
  const before=routing.pacUrl;const policy=defaultPolicy();policy.revision=2;policy.endpoints.forEach(e=>e.enabled=false);await routing.updatePolicy(policy);await routing.setActive(true);
  assert.notEqual(routing.pacUrl,before);assert.ok((await (await fetch(routing.pacUrl)).text()).includes('var hosts = []'));
  await assert.rejects(routing.updatePolicy(defaultPolicy()),/anterior/);
  await routing.stop();const closed=JSON.parse(await readFile(manifest.leasePath,'utf8'));assert.equal(closed.active,false);assert.equal(closed.closed,true);
});
test('native helper restores prior dictionaries, preserves foreign edits and rejects active corporate proxies',{skip:process.platform!=='darwin'?'requires compiled macOS helper':false},()=>{
  const result=JSON.parse(execFileSync(new URL('../desktop/native/bin/usovia-browser-helper',import.meta.url).pathname,['self-test'],{encoding:'utf8'}));assert.equal(result.selfTest,'passed');assert.equal(result.cases,11);
  assert.throws(()=>execFileSync(new URL('../desktop/native/bin/usovia-browser-helper',import.meta.url).pathname,['run','/nonexistent'],{stdio:'pipe'}));
});


test('a dead helper or error cannot be reported as active browser coverage',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'usovia-status-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  class FixtureRouting extends SystemRouting {get statusPath(){return join(this.directory,'helper-status.json');}}
  const routing=new FixtureRouting({directory,helper:'unused',policy:defaultPolicy()});routing.desired=true;routing.requested=true;
  assert.equal((await routing.status()).active,false);
  await writeFile(routing.statusPath,JSON.stringify({at:Date.now(),phase:'active',active:true,effective:true}));assert.equal((await routing.status()).active,true);
  await writeFile(routing.statusPath,JSON.stringify({at:Date.now()-20000,phase:'active',active:true,effective:true}));let status=await routing.status();assert.equal(status.active,false);assert.equal(status.phase,'helper_unavailable');
  await writeFile(routing.statusPath,JSON.stringify({at:Date.now(),phase:'error',active:true,effective:true,error:'cleanup failed'}));status=await routing.status();assert.equal(status.active,false);assert.equal(status.error,'cleanup failed');
  await writeFile(routing.statusPath,JSON.stringify({at:Date.now(),phase:'active',active:true,effective:false}));assert.equal((await routing.status()).active,false);
});
