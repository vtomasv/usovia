import {app,BrowserWindow,ipcMain,safeStorage,shell,session,Tray,Menu,nativeImage,dialog} from 'electron';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {X509Certificate,randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {ClientController,initialClient,normalizeHub} from './controller.mjs';
import {LocalGateway} from './gateway.mjs';
import {loadAuthority,verifyEndpointCertificate} from './certificate.mjs';
import {LlmProxy} from './tls-proxy.mjs';
import {SystemRouting} from './system-routing.mjs';
import {WindowsRouting} from './windows-routing.mjs';
import {providerCatalog} from '../shared/providers.mjs';
import {analyze} from '../shared/analysis.mjs';
import {cliLauncher} from './cli-launcher.mjs';
const here=dirname(fileURLToPath(import.meta.url));
if(process.env.USOVIA_DATA_DIR)app.setPath('userData',process.env.USOVIA_DATA_DIR);
else if(!app.isPackaged)app.setPath('userData',join(here,'../.runtime/desktop'));
app.setName('Usovia');app.enableSandbox();
if(process.platform==='win32')app.setAppUserModelId('app.usovia.desktop');
app.commandLine.appendSwitch('force-renderer-accessibility');
const runtimeUrl='http://127.0.0.1:11438';
let controller,gateway,window,proxy,browserProxy,systemRouting,authority,providerSession,tray,quitting=false,quitComplete=false,policyBusy=false,proxyWork=Promise.resolve(),runtime=null,timers=[];
const browsers=new Set();
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',showWindow);
const activeChats=new Set();
let localConversation=randomUUID(),localHistory=[],localChatBusy=false,browserAuthorizationWork=null;
let persistence=Promise.resolve();
async function save(state){
  if(!safeStorage.isEncryptionAvailable())throw new Error('El almacén seguro del sistema no está disponible.');
  const encrypted=safeStorage.encryptString(JSON.stringify(state));
  const write=async()=>{const file=join(app.getPath('userData'),'participation.enc');await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',encrypted,{mode:0o600});await rename(file+'.tmp',file);};
  persistence=persistence.catch(()=>{}).then(write);await persistence;
}
async function load(){try{return JSON.parse(safeStorage.decryptString(await readFile(join(app.getPath('userData'),'participation.enc'))));}catch(e){if(e.code==='ENOENT')return initialClient();throw new Error('No se pudo abrir la configuración cifrada. No se activó captura.');}}
async function runtimeRequest(path,body){const r=await fetch(runtimeUrl+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'El modelo local no respondió.');return data;}
async function runtimeStatus(){try{const r=await fetch(runtimeUrl+'/api/tags',{signal:AbortSignal.timeout(1500)});return {ready:r.ok,models:(await r.json()).models||[]};}catch{return {ready:false,models:[]};}}
async function startRuntime(){
  const status=await runtimeStatus();if(status.ready)return;
  const directory=app.isPackaged?join(process.resourcesPath,'ollama'):join(here,'runtime');
  runtime=spawn(join(directory,process.platform==='win32'?'ollama.exe':'ollama'),['serve'],{cwd:directory,windowsHide:true,env:{...process.env,OLLAMA_HOST:'127.0.0.1:11438',OLLAMA_MODELS:join(app.getPath('userData'),'models'),OLLAMA_NO_CLOUD:'1',OLLAMA_DEBUG_LOG_REQUESTS:'false',OLLAMA_KEEP_ALIVE:'2m'},stdio:'ignore'});
  runtime.on('error',()=>push());runtime.on('exit',()=>{runtime=null;push();});
}
async function stopRuntime(){
  const owned=runtime;if(!owned?.pid)return;
  if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(owned.pid),'/T','/F'],{windowsHide:true,timeout:10000},()=>resolve()));
  else owned.kill();
}
async function snapshot(){return {...controller.publicState(),runtime:await runtimeStatus(),gatewayActive:!!gateway.server,gatewayUrl:'http://127.0.0.1:11436',gatewayKey:gateway.key,startAtLogin:app.getLoginItemSettings().openAtLogin,localConversation,captureCoverage:['Chat de Usovia','API local configurada','Navegador IA de Usovia','CLI configurada con proxy',...((await systemRouting?.status())?.active?['Navegadores con proxy y CA del sistema']:[])],proxyActive:!!proxy?.server,proxyUrl:proxy?.url||null,caPath:authority?.publicPath||null,caFingerprint:authority?.fingerprint||null,proxyStats:proxy?.stats||null,systemBrowser:systemRouting?await systemRouting.status():{supported:['darwin','win32'].includes(process.platform),platform:process.platform,active:false,phase:'off'},browserProxyStats:browserProxy?.stats||null,providerCatalog,version:app.getVersion(),hubDefault:process.env.USOVIA_HUB_URL||'https://usovia-hub-demo.vercel.app'};}
async function push(){updateTray();const target=window;if(!target||target.isDestroyed())return;const value=await snapshot();if(!target.isDestroyed()&&!target.webContents.isDestroyed())target.webContents.send('usovia:state',value);}
async function routeBrowsers(active){
  if(!providerSession)return;
  await providerSession.setProxy(active?{proxyRules:'http://127.0.0.1:11440',proxyBypassRules:'<-loopback>'}:{mode:'direct'});
  if(active&&(!controller.state.consent.capture||!proxy?.server))await providerSession.setProxy({mode:'direct'});
  await providerSession.closeAllConnections();
}
async function pauseSystemBrowsers(){
  // Close inspected sockets first. The native helper restores routing and trust
  // within its next lease tick; a cached PAC has a DIRECT fallback.
  if(systemRouting)await systemRouting.setActive(false);
  await browserProxy?.stop();
}
async function stopProxy(){await pauseSystemBrowsers();await proxy?.stop();await routeBrowsers(false);}
async function configureSystemBrowsers(policy){
  if(!systemRouting?.requested||!controller.state.consent.capture||!proxy?.server)return;
  const generation=controller.generation;
  await systemRouting.updatePolicy(policy);
  if(!browserProxy||browserProxy.authority!==authority){await browserProxy?.stop();browserProxy=new LlmProxy({controller,authority,policy,port:11442,systemBrowser:true,onChange:()=>{controller.flush().then(push);}});}
  else if(browserProxy.policy.revision!==policy.revision)await browserProxy.applyPolicy(policy);
  await browserProxy.start();
  if(quitting||generation!==controller.generation||!controller.state.consent.capture){await pauseSystemBrowsers();return;}
  await systemRouting.setActive(true);
}
function createSystemRouting(policy=controller.state.providerPolicy){
  const windows=process.platform==='win32';
  return new (windows?WindowsRouting:SystemRouting)({directory:join(app.getPath('userData'),'browser-routing'),helper:app.isPackaged?join(process.resourcesPath,windows?'browser-helper/usovia-windows-browser-helper.exe':'browser-helper/usovia-browser-helper'):join(here,windows?'native/bin/usovia-windows-browser-helper.exe':'native/bin/usovia-browser-helper'),policy});
}
async function enableSystemBrowsers(){
  if(!['darwin','win32'].includes(process.platform))throw new Error('La integración del sistema está disponible en Mac y Windows.');
  if(!controller.state.consent.capture)throw new Error('Autoriza los canales compatibles antes de activar los navegadores.');
  await configureProxy({refresh:true});if(!proxy?.server)throw new Error('El proxy necesita una política vigente.');
  const generation=controller.generation;
  if(!systemRouting)systemRouting=createSystemRouting();
  let status=await systemRouting.status();if(status.active)return snapshot();
  if(['restoring','removing_root'].includes(status.phase))throw new Error('macOS está retirando la autorización anterior. Completa ese paso antes de volver a activar los navegadores.');
  if(status.requested&&['awaiting_authorization','installing_root'].includes(status.phase))throw new Error('Ya hay una autorización de navegadores en curso. Complétala o pausa la observación para cancelarla.');
  if(['active','paused'].includes(status.phase)){systemRouting.requested=true;await configureSystemBrowsers(controller.state.providerPolicy);return snapshot();}
  if(status.requested||status.phase==='stopped'||status.phase==='error'||status.phase==='recovered'||status.phase==='helper_unavailable'){
    await systemRouting.stop();systemRouting=createSystemRouting();
  }
  const osDetail=process.platform==='win32'?'Windows configura el proxy y confía en la CA únicamente para tu cuenta de usuario. Se conserva la configuración de otras aplicaciones y se rechaza la integración si hay otro proxy o una política administrada. Pausar retira la CA añadida y restaura tus ajustes. Los navegadores con configuración propia requieren revisión de TI.':'macOS solicitará permiso de administrador y puede pedir otro para retirar el certificado.';
  const confirmation=await dialog.showMessageBox(window,{type:'info',title:'Autorizar gobierno corporativo de IA',message:'Permitir la conexión de tus navegadores con Usovia',detail:'Con tu autorización, Usovia configura un proxy selectivo y un certificado TLS propio del equipo. Solo observa rutas de IA habilitadas por la empresa; las solicitudes y respuestas se envían únicamente con tus permisos. No bloquea contenido. La confianza de la CA abarca TLS; Usovia limita la observación a los dominios LLM seleccionados. '+osDetail+' Gracias por colaborar con las políticas de seguridad y mejora del uso de IA.',buttons:['Cancelar','Continuar y autorizar'],defaultId:0,cancelId:0});
  if(confirmation.response!==1)return snapshot();
  const plan=await systemRouting.inspect();
  if(!plan.services.some(s=>s.supported&&!s.conflict))throw new Error(plan.services.find(s=>s.reason)?.reason||'No hay servicios sin otro proxy activo. La integración requiere revisar la red con TI.');
  const activation=await systemRouting.prepare(authority);
  if(quitting||generation!==controller.generation||!controller.state.consent.capture){await pauseSystemBrowsers();return snapshot();}
  await configureSystemBrowsers(controller.state.providerPolicy);
  try{await systemRouting.authorize(activation);}catch(e){systemRouting.requested=false;await pauseSystemBrowsers();throw e;}
  await push();return snapshot();
}
function configureProxy(options){const generation=controller.generation;proxyWork=proxyWork.catch(()=>{}).then(()=>!quitting&&generation===controller.generation?configureProxyNow(options):undefined);return proxyWork;}
async function configureProxyNow({refresh=false}={}){
  const generation=controller.generation;
  const current=()=>!quitting&&generation===controller.generation&&controller.state.consent.capture;
  if(!controller.state.consent.capture)return stopProxy();
  if(refresh){try{await controller.refreshPolicy();}catch(e){if(e.status===401||e.status===403){await stopProxy();controller.state.error='La central rechazó la cuenta. La inspección externa está detenida.';return;}if(!controller.state.providerPolicy)throw e;}}
  if(!current())return;
  const policy=controller.state.providerPolicy;
  if(!policy||!controller.state.policySyncedAt||Date.now()-Date.parse(controller.state.policySyncedAt)>3600000){await stopProxy();controller.state.error='Actualiza proveedores para inspeccionar: la política central expiró (1 hora).';return;}
  if(authority&&Date.parse(new X509Certificate(authority.cert).validTo)-Date.now()<3*86400000){await stopProxy();if(systemRouting){await systemRouting.stop();systemRouting=null;controller.state.error='La CA se renovó. Autoriza de nuevo los navegadores del equipo.';}authority=null;proxy=null;}
  if(!authority)authority=await loadAuthority(join(app.getPath('userData'),'certificates'),safeStorage);
  if(!current())return;
  if(!controller.state.localProxyKey){controller.state.localProxyKey=randomBytes(32).toString('base64url');await save(controller.state);if(!current())return;}
  const changed=!proxy?.server||proxy.policy.revision!==policy.revision;
  if(!proxy||proxy.key!==controller.state.localProxyKey)proxy=new LlmProxy({controller,authority,policy,key:controller.state.localProxyKey,onChange:()=>{controller.flush().then(push);}});
  else if(proxy.policy.revision!==policy.revision)await proxy.applyPolicy(policy);
  if(!current())return;
  await proxy.start();if(!current()){await stopProxy();return;}if(changed)await routeBrowsers(true);await configureSystemBrowsers(policy);
}
async function openAiBrowser(id){
  const endpoint=controller.state.providerPolicy?.endpoints.find(e=>e.id===id&&e.enabled);
  if(id!=='gemini-web'||!endpoint)throw new Error('Gemini web debe estar habilitado en la central.');
  if(!controller.state.consent.capture||!proxy?.server)throw new Error('Activa los canales compatibles y actualiza proveedores primero.');
  const browser=new BrowserWindow({width:1150,height:850,title:'Usovia · Gemini',webPreferences:{session:providerSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});browsers.add(browser);
  browser.webContents.setWindowOpenHandler(()=>({action:'deny'}));browser.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).protocol!=='https:')event.preventDefault();}catch{event.preventDefault();}});
  browser.once('closed',()=>browsers.delete(browser));await browser.loadURL('https://gemini.google.com/app');
}
async function createCliLauncher(){
  if(!controller.state.consent.capture||!proxy?.server)throw new Error('Activa el proxy antes de crear el lanzador.');
  const launcher=cliLauncher({platform:process.platform,proxyUrl:proxy.url,caPath:authority.publicPath,executable:process.execPath,entry:app.isPackaged?join(process.resourcesPath,'shared/cli-entry.mjs'):join(here,'../shared/cli-entry.mjs')});
  const file=join(app.getPath('userData'),launcher.name);
  await writeFile(file,launcher.content,{mode:0o700});shell.showItemInFolder(file);return {path:file};
}
const actions={
  state:()=>snapshot(),
  activate:async input=>{await controller.activate(input.hubUrl,input.code,process.platform);await push();return snapshot();},
  consent:async input=>{
    const change=controller.setConsent(input);
    if(!input.capture){for(const abort of activeChats)abort.abort();await gateway.stop();await stopProxy();}
    await change;
    if(input.capture){try{await gateway.start();await configureProxy({refresh:true});}catch(e){controller.state.error='El permiso está activo, pero no pudo abrirse la API local: '+e.message;}}
    await push();return snapshot();
  },
  analyze:async input=>{
    const result=await controller.capture({prompt:String(input.prompt||''),provider:input.provider||'aporte_manual',channel:'aporte_manual'});await controller.flush();await push();return result;
  },
  chat:async input=>{
    const prompt=String(input.prompt||'').slice(0,12000);if(!prompt.trim())throw new Error('Escribe una consulta.');
    const result=analyze(prompt);
    if(localChatBusy)throw new Error('Espera a que termine la respuesta actual.');localChatBusy=true;
    const history=[...localHistory,{role:'user',content:prompt}];
    const abort=new AbortController();activeChats.add(abort);
    try{
      const url=controller.state.consent.capture?'http://127.0.0.1:11436/api/chat':runtimeUrl+'/api/chat';
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(controller.state.consent.capture?{Authorization:`Bearer ${gateway.key}`,'X-Usovia-Conversation':localConversation,'X-Usovia-Channel':'chat_usovia'}:{})},body:JSON.stringify({model:input.model,messages:history,stream:false,keep_alive:'2m',options:{num_ctx:2048}}),signal:abort.signal});
      const reply=await r.json();if(!r.ok)throw new Error(typeof reply.error==='string'?reply.error:'No se pudo completar la consulta.');
      localHistory=[...history,{role:'assistant',content:reply.message?.content||''}].slice(-20);
      controller.state.model=input.model;try{await save(controller.state);await controller.flush();await push();}catch{controller.state.error='La respuesta está disponible, pero no se pudieron guardar las preferencias o sincronizar los aportes.';}
      return {response:reply.message?.content||'',analysis:result};
    }finally{activeChats.delete(abort);localChatBusy=false;}
  },
  newConversation:()=>{if(localChatBusy)throw new Error('Espera a que termine la respuesta.');localConversation=randomUUID();localHistory=[];return {conversationId:localConversation};},
  startAtLogin:async input=>{if(!app.isPackaged)throw new Error('Disponible al instalar Usovia.');app.setLoginItemSettings({openAtLogin:!!input.enabled,args:['--background']});await push();return snapshot();},
  recommendations:()=>controller.getRecommendations(),
  refreshProviders:async()=>{await controller.refreshPolicy();await configureProxy();await push();return snapshot();},
  openAiBrowser:input=>openAiBrowser(input.id),
  cliLauncher:()=>createCliLauncher(),
  enableSystemBrowsers:()=>{if(!browserAuthorizationWork)browserAuthorizationWork=enableSystemBrowsers().finally(()=>{browserAuthorizationWork=null;});return browserAuthorizationWork;},
  recoverSystemBrowsers:async()=>{
    const routing=createSystemRouting(controller.state.providerPolicy||{schemaVersion:1,revision:1,updatedAt:null,endpoints:[]});
    const answer=await dialog.showMessageBox(window,{type:'info',title:'Restaurar la red',message:'Retirar certificados y ajustes pendientes de Usovia',detail:'Se recuperan únicamente los ajustes y certificados añadidos por Usovia en sesiones anteriores. Se conservan los cambios de otras aplicaciones y las sesiones activas. En macOS se solicitará autorización local. Gracias por colaborar con la seguridad de tu equipo.',buttons:['Cancelar','Autorizar restauración'],cancelId:0,defaultId:0});
    if(answer.response!==1)return {cancelled:true};return routing.authorizeRecovery();
  },
  disableSystemBrowsers:async()=>{if(systemRouting)systemRouting.requested=false;await pauseSystemBrowsers();await push();return snapshot();},
  installModel:async()=>{await runtimeRequest('/api/pull',{model:'qwen2.5:0.5b',stream:false});await push();return snapshot();},
  disconnect:async input=>{for(const c of activeChats)c.abort();await gateway.stop();if(systemRouting)systemRouting.requested=false;await stopProxy();await controller.disconnect({erase:!!input.erase});proxy=null;await push();return snapshot();},
  openHub:async()=>{if(controller.state.hubUrl)await shell.openExternal(normalizeHub(controller.state.hubUrl));}
};
function showWindow(){app.dock?.show();window?.show();window?.focus();}
function updateTray(){
  if(!tray||!controller)return;const c=controller.state.consent;
  const label=c.capture?'Observación de IA activa':'Observación de IA pausada';tray.setToolTip('Usovia · '+label);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label,enabled:false},{label:c.shareText?'Compartiendo solicitudes'+(c.captureResponses?' y respuestas':''):'Sin envío de conversaciones',enabled:false},
    {type:'separator'},{label:'Abrir Usovia',click:showWindow},
    {label:'Revisar permisos y conexiones',click:()=>{showWindow();window.webContents.send('usovia:page','participation');}},
    {label:'Pausar observación y envío',enabled:c.capture,click:()=>actions.consent({capture:false,shareText:false,captureResponses:false,reportStatus:c.reportStatus}).catch(e=>{controller.state.error=e.message;push();})},
    {type:'separator'},{label:'Salir de Usovia',click:()=>{quitting=true;app.quit();}}
  ]));
}
app.whenReady().then(async()=>{
  if(process.platform==='win32'){try{await createSystemRouting({schemaVersion:1,revision:1,updatedAt:null,endpoints:[]}).authorizeRecovery();}catch{/* Existing state remains off until the participant reviews any recovery issue. */}}
  let state;try{state=await load();}catch(e){state=initialClient();state.error=e.message;}
  controller=new ClientController({state,save,version:app.getVersion(),request:(url,options)=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)})});
  gateway=new LocalGateway({controller,runtimeUrl,onChange:()=>{controller.flush().then(push);}});
  providerSession=session.fromPartition('persist:usovia-ai-browser');
  providerSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  providerSession.setCertificateVerifyProc((request,callback)=>{callback(authority&&proxy?.server&&verifyEndpointCertificate(request.certificate.data,request.hostname,authority.cert,proxy.hosts)?0:-3);});
  app.on('login',(event,contents,_details,authInfo,callback)=>{if(authInfo.isProxy&&authInfo.host==='127.0.0.1'&&authInfo.port===11440&&contents?.session===providerSession&&proxy?.server){event.preventDefault();callback('usovia',proxy.key);}});
  await startRuntime();if(state.consent.capture)try{await gateway.start();await configureProxy({refresh:true});}catch(e){state.error=e.message;}
  window=new BrowserWindow({width:1160,height:800,minWidth:800,minHeight:650,title:'Usovia',backgroundColor:'#f5f7f2',webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
  ipcMain.handle('usovia:action',async(event,{action,input})=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!Object.hasOwn(actions,action))throw new Error('Acción no permitida.');
    return actions[action](input||{});
  });
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();app.dock?.hide();}});
  const icon=nativeImage.createFromPath(join(here,'ui/app-icon.png')).resize({width:18,height:18});tray=new Tray(icon);updateTray();if(process.platform!=='darwin')tray.on('click',showWindow);
  const ui=join(here,'ui/index.html');await window.loadFile(ui);if(process.argv.includes('--background')||app.getLoginItemSettings().wasOpenedAtLogin){window.hide();app.dock?.hide();}
  if(process.argv.includes('--packaging-smoke')&&process.env.USOVIA_SMOKE_OUTPUT){
    try{await (await import('./smoke.mjs')).smoke({app,window,tray,safeStorage,snapshot,save,load,runtimeRequest,actions,output:process.env.USOVIA_SMOKE_OUTPUT});}
    catch(error){await writeFile(process.env.USOVIA_SMOKE_OUTPUT,JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
    app.quit();return;
  }
  timers.push(setInterval(async()=>{await controller.flush();await controller.heartbeat({gatewayActive:!!gateway.server,proxyActive:!!proxy?.server,systemBrowserActive:!!(await systemRouting?.status())?.active,policyRevision:controller.state.providerPolicy?.revision,ollamaReady:(await runtimeStatus()).ready});await push();},30000));
  timers.push(setInterval(push,5000));
  timers.push(setInterval(async()=>{
    if(!systemRouting?.requested)return;
    const status=await systemRouting.status();
    if(['stopped','error','recovered','helper_unavailable'].includes(status.phase)){
      systemRouting.requested=false;await pauseSystemBrowsers();
      controller.state.error=status.error||'La integración de navegadores se detuvo. Revisa el ayudante y recupera ajustes si hubo un cierre forzado.';await push();
    }
  },2000));
  timers.push(setInterval(async()=>{if(policyBusy||!controller.state.consent.capture)return;policyBusy=true;try{await configureProxy({refresh:true});}catch(e){controller.state.policyError=e.message;}finally{policyBusy=false;await push();}},30000));
});
app.on('activate',showWindow);
app.on('before-quit',event=>{
  quitting=true;if(quitComplete)return;event.preventDefault();timers.forEach(clearInterval);for(const c of activeChats)c.abort();
  Promise.allSettled([gateway?.stop(),stopProxy()]).then(async()=>{await systemRouting?.stop();await stopRuntime();quitComplete=true;app.quit();});
});
