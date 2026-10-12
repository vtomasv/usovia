// Native browsers on a disposable Windows CI host, with strict TLS and system PAC.
// Vendor hostnames resolve to OUR HTTPS fixture. No vendor credentials or real prompts.
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import {spawn,execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,X509Certificate} from 'node:crypto';
import {generateAuthority,issueLeaf} from '../desktop/certificate.mjs';
import {ClientController,initialClient} from '../desktop/controller.mjs';
import {WindowsRouting} from '../desktop/windows-routing.mjs';
import {LlmProxy} from '../desktop/tls-proxy.mjs';
import {defaultPolicy} from '../shared/providers.mjs';
const run=promisify(execFile),directory=resolve(process.env.RUNNER_TEMP||'.runtime','Usovia-browser-fixture');
const helper=resolve(process.env.USOVIA_BROWSER_HELPER||'desktop/native/bin/usovia-windows-browser-helper.exe');
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.USOVIA_BROWSER_FIXTURE!=='1')throw new Error('Run ONLY in explicitly enabled isolated Windows CI.');
await mkdir(directory,{recursive:true});
const report={ok:false,fixture:'local controlled HTTPS under vendor hostnames',strictTLS:true,proxySource:'Windows current-user WinINet PAC',liveVendorLogin:false,browsers:[]};
const upstream=await generateAuthority(),authority=await generateAuthority();
await writeFile(join(directory,'upstream.cer'),new X509Certificate(upstream.cert).raw);
await writeFile(join(directory,'usovia.cer'),new X509Certificate(authority.cert).raw);
await writeFile(join(directory,'usovia.pem'),authority.cert);
const fixture=async action=>{const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows-browser-fixture.ps1',import.meta.url)),'-Action',action,'-Directory',directory,'-Helper',helper],{windowsHide:true,timeout:30000,maxBuffer:65536});return action==='Inspect'?JSON.parse(r.stdout):r.stdout;};
const compiler=join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),consentExecutable=join(directory,'fixture-consent.exe');
await run(compiler,['/nologo','/target:exe','/platform:x64','/lib:'+join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/WPF'),'/reference:System.Web.Extensions.dll','/reference:WindowsBase.dll','/reference:UIAutomationClient.dll','/reference:UIAutomationTypes.dll','/out:'+consentExecutable,fileURLToPath(new URL('./WindowsFixtureConsent.cs',import.meta.url))],{windowsHide:true});
const consentProcess=spawn(consentExecutable,[directory],{stdio:['ignore','pipe','pipe'],windowsHide:true});
consentProcess.stdout.on('data',bytes=>console.log(bytes.toString().trim()));
const eventually=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;let value;while(Date.now()<end){value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw new Error('Timeout: '+label);};
const state=initialClient();state.token='synthetic-browser-fixture';state.consent={capture:true,shareText:true,captureResponses:true,reportStatus:false};state.consentVersion=1;
const controller=new ClientController({state,save:async()=>{},request:fetch});
let policy=defaultPolicy();
const proxy=new LlmProxy({controller,authority,policy,port:11442,systemBrowser:true,resolve:async()=>({address:'127.0.0.1',family:4}),upstreamPort:443,upstreamCA:upstream.cert});
const routing=new WindowsRouting({directory,helper,policy,platform:process.platform});
const leafContexts={};for(const name of ['gemini.google.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','nonllm.usovia-fixture.invalid'])leafContexts[name]=await issueLeaf(upstream,name);
const webPath='/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const html=browser=>`<!doctype html><meta charset="utf-8"><title>Usovia · isolated Windows browser verification</title><style>body{font:16px system-ui;max-width:800px;margin:60px auto;color:#294236}textarea{width:100%;height:90px}button{padding:12px;margin:12px 8px 12px 0}pre{white-space:pre-wrap;background:#eef3e7;padding:20px}</style><h1>Windows browser capture verification</h1><p>Controlled fixture · ${browser} · synthetic prompts only</p><textarea id="prompt" aria-label="Synthetic prompt"></textarea><button id="send">Send Gemini web prompt</button><button id="openai">OpenAI API</button><button id="anthropic">Anthropic API</button><button id="geminiapi">Gemini API</button><pre id="result"></pre><p id="status">ready</p><script>
let thread='',n=0;const status=document.getElementById('status'),result=document.getElementById('result');
document.getElementById('send').onclick=async()=>{status.textContent='pending';try{const r=await fetch(${JSON.stringify(webPath)},{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Fixture-Browser':${JSON.stringify(browser)}},body:new URLSearchParams({'f.req':JSON.stringify([null,JSON.stringify([[document.getElementById('prompt').value],null,[thread]])])})});const raw=await r.text();const data=JSON.parse(JSON.parse(raw.slice(raw.indexOf('[[')))[0][2]);thread=data[1][0];result.textContent+=data[4][0][1][0]+'\\n';status.textContent='done '+(++n);}catch(e){status.textContent='error '+e.message;}};
for(const [id,url,body] of [['openai','https://api.openai.com/v1/chat/completions',{model:'fixture',messages:[{role:'user',content:'Analiza un presupuesto ficticio.'}]}],['anthropic','https://api.anthropic.com/v1/messages',{model:'fixture',messages:[{role:'user',content:'Redacta un plan ficticio.'}]}],['geminiapi','https://generativelanguage.googleapis.com/v1beta/models/fixture:generateContent',{contents:[{role:'user',parts:[{text:'Resume este ejemplo ficticio.'}]}]}]])document.getElementById(id).onclick=async()=>{status.textContent='pending';try{result.textContent+=(await (await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).text())+'\\n';status.textContent='done '+(++n);}catch(e){status.textContent='error '+e.message;}};
</script>`;
const origin=https.createServer({...leafContexts['gemini.google.com'],SNICallback:(host,callback)=>callback(null,tls.createSecureContext(leafContexts[host]||leafContexts['gemini.google.com']))},async(req,res)=>{
  const parts=[];for await(const part of req)parts.push(part);
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Fixture-Browser');
  if(req.method==='OPTIONS'){res.end();return;}
  if(req.method==='POST'){
    if(req.url.startsWith(webPath)){const browser=req.headers['x-fixture-browser']||'unknown',value=[null,['c_'+browser],null,null,[['rc_fixture',['Respuesta controlada para persona@example.invalid.']]]];res.setHeader('Content-Type','application/json');res.end(")]}'\n\n"+JSON.stringify([['wrb.fr',null,JSON.stringify(value)]])+'\n');}
    else {res.setHeader('Content-Type','application/json');const response=req.headers.host.startsWith('api.anthropic')?{content:[{type:'text',text:'Plan controlado.'}]}:req.headers.host.startsWith('generativelanguage')?{candidates:[{content:{parts:[{text:'Resumen controlado.'}]},finishReason:'STOP'}]}:{choices:[{message:{content:'Análisis controlado.'},finish_reason:'stop'}]};res.end(JSON.stringify(response));}
    return;
  }
  res.setHeader('Content-Type','text/html');res.end(html(new URL(req.url,'https://fixture.invalid').searchParams.get('browser')||'fixture'));
});
const sessions=new Set(),drivers=new Set();let fixtureStarted=false;
async function browser(name,index){
  const binaries={Chrome:[process.env.CHROMEWEBDRIVER,'chromedriver.exe','chrome','goog:chromeOptions'],Edge:[process.env.EDGEWEBDRIVER,'msedgedriver.exe','MicrosoftEdge','ms:edgeOptions'],Firefox:[process.env.GECKOWEBDRIVER,'geckodriver.exe','firefox','moz:firefoxOptions']};
  const [path,file,browserName,options]=binaries[name],port=19000+index;
  const driver=spawn(join(path,file),['--port',String(port)],{stdio:'ignore',windowsHide:true});
  drivers.add(driver);driver.once('exit',()=>drivers.delete(driver));
  const base=`http://127.0.0.1:${port}`;
  await eventually(()=>fetch(base+'/status').then(r=>r.ok).catch(()=>false),name+' driver');
  const command=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});const data=await r.json();if(!r.ok||data.value?.error)throw new Error(name+': '+JSON.stringify(data.value));return data.value;};
  const config={browserName,acceptInsecureCerts:false,proxy:{proxyType:'system'},[options]:{args:name==='Firefox'?['-headless']:['--headless=new','--no-first-run','--disable-background-networking']}};
  const session=await command('/session',{capabilities:{alwaysMatch:config}});assert.equal(session.capabilities.acceptInsecureCerts,false);
  const prefix='/session/'+session.sessionId;
  const b={name,version:session.capabilities.browserVersion,command:(path,body,method)=>command(prefix+path,body,method),close:async()=>{try{await command(prefix,undefined,'DELETE');}finally{driver.kill();sessions.delete(b);}}};sessions.add(b);
  b.open=()=>b.command('/url',{url:'https://gemini.google.com/app?browser='+name});
  b.script=script=>b.command('/execute/sync',{script,args:[]});
  b.click=async id=>{const element=await b.command('/element',{using:'css selector',value:'#'+id});await b.command('/element/'+element['element-6066-11e4-a52e-4f735466cecf']+'/click',{});};
  b.send=async(text,count)=>{const element=await b.command('/element',{using:'css selector',value:'#prompt'}),id=element['element-6066-11e4-a52e-4f735466cecf'];await b.command('/element/'+id+'/clear',{});await b.command('/element/'+id+'/value',{text});await b.click('send');await eventually(async()=>{const status=await b.script('return document.getElementById("status").textContent');if(status.startsWith('error'))throw new Error(status);return status==='done '+count;},name+' response');};
  return b;
}
try {
  await new Promise((resolve,reject)=>{origin.once('error',reject);origin.listen(443,'127.0.0.1',resolve);});
  fixtureStarted=true;await fixture('Setup');
  const original=(await fixture('Inspect')).proxy;
  await proxy.start();await routing.setActive(false);await routing.prepare(authority); // PAC exists but NOT installed yet.
  const baseline=await browser('Chrome',0);await baseline.open();await baseline.send('Ejemplo controlado anterior a la integración.',1);await baseline.close();assert.equal(proxy.stats.captured,0);report.withoutSystemRoutingCaptured=0;
  const inspected=await routing.inspect();assert.equal(inspected.services[0].conflict,false,inspected.services[0].reason);
  await routing.setActive(true);await routing.authorize({path:join(directory,routing.id+'.manifest.json')});
  await eventually(async()=>{const s=await routing.status();if(s.phase==='error')throw new Error(s.error);return s.active;},'Windows current-user integration');
  assert.equal((await fixture('Inspect')).usoviaRoot,true);
  for(const [index,name]of ['Chrome','Edge','Firefox'].entries()){
    const start=controller.state.pending.length,b=await browser(name,index+1);await b.open();assert.equal(await b.script('return window.isSecureContext'),true);
    await b.send('Redacta una respuesta para persona@example.invalid.',1);await b.send('Mejora el mensaje y presenta tres pasos.',2);
    for(const [i,id]of ['openai','anthropic','geminiapi'].entries()){await b.click(id);await eventually(()=>b.script('return document.getElementById("status").textContent').then(s=>s==='done '+(i+3)),name+' '+id);}
    await eventually(()=>controller.state.pending.length===start+5,name+' captured turns');
    const turns=controller.state.pending.slice(start);assert.equal(turns[0].conversationId,turns[1].conversationId);assert.deepEqual(turns.slice(0,2).map(t=>t.turnIndex),[1,2]);
    assert.ok(turns.every(t=>t.responseStatus==='complete'&&t.redactedResponse));assert.ok(!JSON.stringify(turns).includes('persona@example.invalid'));
    const screenshot=await b.command('/screenshot');await writeFile(join(directory,name+'.png'),Buffer.from(screenshot,'base64'));
    const captured=proxy.stats.captured,inspectedBefore=proxy.stats.inspected;
    await b.command('/url',{url:'https://nonllm.usovia-fixture.invalid/normal'});assert.equal(proxy.stats.captured,captured);assert.equal(proxy.stats.inspected,inspectedBefore);
    await b.command('/url',{url:'https://gemini.google.com/assets?prompt=unrelated'});assert.equal(proxy.stats.captured,captured);
    report.browsers.push({name,version:b.version,promptAndResponse:true,turns:5,conversationConsistent:true,redaction:true,nonLlmDirect:true,nonGenerationExcluded:true,certificateValidation:true});await b.close();
  }
  policy=defaultPolicy();policy.revision=2;policy.endpoints.filter(e=>e.id==='gemini-web').forEach(e=>e.enabled=false);
  await proxy.applyPolicy(policy);await routing.updatePolicy(policy);await routing.setActive(true);
  await eventually(()=>fixture('Inspect').then(s=>s.proxy.pac.endsWith('revision=2')),'policy revision applied');
  const disabled=await browser('Chrome',5),beforeDisabled=proxy.stats.captured;await disabled.open();await disabled.send('Consulta excluida desde la política central.',1);assert.equal(proxy.stats.captured,beforeDisabled);await disabled.close();report.centralPolicyExclusion=true;
  controller.state.consent.capture=false;await proxy.stop();await routing.setActive(false);
  await eventually(()=>fixture('Inspect').then(s=>!s.usoviaRoot&&JSON.stringify(s.proxy)===JSON.stringify(original)),'pause restores routing and trust');
  const paused=await browser('Chrome',6),beforePause=proxy.stats.captured;await paused.open();await paused.send('Consulta sin observación tras pausar.',1);assert.equal(proxy.stats.captured,beforePause);await paused.close();report.pauseNoCapture=true;
  await routing.stop();report.cleanStop=true;
  // Verify that a foreign edit is preserved, then restore this disposable fixture.
  const foreign=new WindowsRouting({directory,helper,policy,platform:process.platform});await foreign.setActive(true);const plan=await foreign.prepare(authority);await foreign.authorize(plan);await eventually(()=>foreign.status().then(s=>s.active),'foreign-edit fixture activation');
  await fixture('Foreign');await eventually(()=>fixture('Inspect').then(s=>!s.usoviaRoot),'foreign edit removes own trust');assert.equal((await fixture('Inspect')).proxy.pac,'http://127.0.0.1:1/foreign-fixture.pac');await foreign.stop();await fixture('Restore');report.foreignSettingsPreserved=true;
  // Parent death: the independent helper restores without a browser or prompt.
  const childFile=join(directory,'parent.mjs');const routingImport=new URL('../desktop/windows-routing.mjs',import.meta.url).href;
  await writeFile(childFile,`import {readFile} from 'node:fs/promises';import {WindowsRouting} from ${JSON.stringify(routingImport)};const r=new WindowsRouting({directory:${JSON.stringify(directory)},helper:${JSON.stringify(helper)},policy:${JSON.stringify(policy)},platform:'win32'});await r.setActive(true);const plan=await r.prepare({cert:await readFile(${JSON.stringify(join(directory,'usovia.pem'))},'utf8')});await r.authorize(plan);process.send({id:r.id});setInterval(()=>{},1000);`);
  const child=fork(childFile,[],{stdio:['ignore','ignore','ignore','ipc']});await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});await eventually(()=>fixture('Inspect').then(s=>s.usoviaRoot),'watchdog fixture activation');
  child.kill();await eventually(()=>fixture('Inspect').then(s=>!s.usoviaRoot&&JSON.stringify(s.proxy)===JSON.stringify(original)),'parent death restores routing and trust');report.parentDeathRestores=true;
  report.capturedTurns=controller.state.pending.length;report.ok=true;
}catch(error){report.error=error.message+(error.stdout?'\n'+error.stdout:'')+(error.stderr?'\n'+error.stderr:'');throw error;}
finally {
  await writeFile(join(directory,'windows-browser-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  for(const b of [...sessions])await b.close().catch(()=>{});
  for(const driver of drivers)driver.kill();
  await proxy.stop().catch(()=>{});await routing.stop().catch(()=>{});await routing.authorizeRecovery().catch(()=>{});
  if(fixtureStarted)try{await fixture('Teardown');report.fixtureCleaned=true;}catch(error){report.ok=false;report.cleanupError=error.message;process.exitCode=1;}
  consentProcess.kill();origin.closeAllConnections();await new Promise(r=>origin.close(r));
  await writeFile(join(directory,'windows-browser-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
