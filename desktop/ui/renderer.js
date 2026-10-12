const $=id=>document.getElementById(id);let state=null;let consentDirty=false;const busy=new Set();
function showError(error){$('error').textContent=error.message||String(error);$('error').hidden=false;}
async function invoke(action,input){$('error').hidden=true;try{return await window.usovia.invoke(action,input);}catch(e){showError(e);throw e;}}
function page(id){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==id);document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===id));}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>page(b.dataset.page));
function render(s){
  state=s;$('gateway-key').value=s.gatewayKey||'';$('start-at-login').checked=!!s.startAtLogin;$('state-label').textContent=s.consent.capture?'Observación de IA activa':s.consent.reportStatus?'Solo reporte de estado':'Solo IA local';$('state-dot').classList.toggle('on',s.consent.capture);
  $('activation').hidden=!!s.account;$('account-info').hidden=!s.account;
  if(s.account)$('account-info').textContent=`${s.account.label} · ${s.account.department} · ${s.account.country} · ${s.account.office}`;
  for(const k of ['capture','shareText','captureResponses','reportStatus']){if(!consentDirty)$(k).checked=s.consent[k];$(k).disabled=!s.account;}
  $('save-consent').disabled=!s.account;$('pause').disabled=!s.account;$('disconnect').disabled=!s.account;$('erase').disabled=!s.account;
  $('pending').textContent=`${s.pendingCount} aportes pendientes`;$('last-sync').textContent=s.lastSync?'Última sincronización: '+new Date(s.lastSync).toLocaleTimeString():'Sin sincronización';
  $('runtime-badge').textContent=s.runtime.ready?'Motor local listo':'Iniciando motor local';
  const selected=$('model').value||s.model;const models=s.runtime.models;
  $('model').replaceChildren(...models.map(m=>{const option=document.createElement('option');option.value=m.name;option.textContent=m.name;return option;}));
  if(models.some(m=>m.name===selected))$('model').value=selected;
  if(!models.length){const option=document.createElement('option');option.textContent='Descarga un modelo para comenzar';option.value='';$('model').append(option);}
  $('send').disabled=busy.has('send')||!models.length||!s.runtime.ready;$('install-model').hidden=models.length>0;$('install-model').disabled=busy.has('install-model');
  if(!$('hub').value)$('hub').value=s.hubDefault||s.hubUrl||'http://127.0.0.1:5173';
  $('proxy-state').textContent=(s.proxyActive?'Proxy LLM activo · 127.0.0.1:11440':'Proxy LLM desactivado')+(s.proxyStats?.lastError?' · Último error: '+s.proxyStats.lastError:'');
  $('policy-state').textContent=s.providerPolicy?`Política ${s.providerPolicy.revision} · sincronizada ${new Date(s.policySyncedAt).toLocaleString()}${s.policyError?' · '+s.policyError:''}`:'Activa una cuenta para descargar la configuración.';
  $('tls-proxy-url').value=s.proxyUrl||'';$('tls-ca-path').value=s.caPath||'';$('tls-fingerprint').textContent=s.caFingerprint?'Huella CA: '+s.caFingerprint:'';
  $('refresh-providers').disabled=!s.account;$('open-gemini').disabled=!s.proxyActive||!s.providerPolicy?.endpoints.some(e=>e.id==='gemini-web'&&e.enabled);$('cli-launcher').disabled=!s.proxyActive;
  const system=s.systemBrowser||{};const windows=system.platform==='win32';const os=windows?'Windows':'macOS';
  $('system-browser-title').textContent='Navegadores del equipo · '+os;
  if(windows){$('system-browser-explanation').textContent='Chrome, Edge y Firefox que usen el proxy y la confianza TLS del sistema. Con tu autorización, Usovia instala su CA pública en tu cuenta Windows y dirige únicamente dominios LLM seleccionados al proxy local. La confianza de esa CA abarca TLS; Usovia limita qué dominios observa.';$('system-browser-authorization').textContent='La autorización se realiza aquí, sin consola ni contraseña de administrador. Pausar o salir restaura tus ajustes y retira la CA añadida por Usovia. Si hay otro proxy, WPAD, VPN o una política administrada, se conserva esa configuración y se requiere revisar con TI.';$('platform-lifecycle-note').textContent='Cerrar la ventana mantiene Usovia en la bandeja del sistema. Pausar detiene la observación y restaura la red. Si todos sus procesos se cierran a la fuerza, el cliente recupera sus ajustes al volver a abrirse; puedes solicitar la recuperación desde aquí.';}
  $('system-browser-panel').hidden=!system.supported;$('windows-browser-info').hidden=!!system.supported;
  if(!system.supported)$('platform-lifecycle-note').textContent='Cerrar esta ventana mantiene Usovia en la bandeja del sistema. Pausar detiene la observación y cierra el proxy local. Salir también detiene el motor incluido. Ningún certificado se instala en Windows.';
  $('system-browser-state').textContent=system.active?'Proxy '+os+' configurado (verifica cada navegador)':system.configured?'PAC configurado, sin confirmar en la red actual':system.phase==='removing_root'?'Proxy pausado · Confirma en '+os+' la retirada de la CA':system.phase==='installing_root'?'Autorización TLS en curso':system.phase==='error'?'Integración detenida':system.requested?'Esperando activación local / restauración':'Integración '+os+' desactivada';
  $('system-browser-detail').textContent=system.error|| (system.active?'Servicios con PAC: '+system.services.join(', ')+(system.skippedServices?.length?' · Conservados sin cobertura: '+system.skippedServices.map(x=>x.name).join(', '):''):'No se garantiza cobertura hasta completar la autorización y comprobar el navegador.');
  $('enable-system-browsers').disabled=busy.has('enable-system-browsers')||!system.supported||!s.proxyActive||system.active||['installing_root','removing_root','restoring'].includes(system.phase)||(system.requested&&system.phase==='awaiting_authorization');
  $('disable-system-browsers').disabled=!system.requested;
  const list=$('provider-list');list.replaceChildren();for(const e of s.providerPolicy?.endpoints||[]){const catalog=s.providerCatalog.find(c=>c.id===e.id);const item=document.createElement('div');item.className='tip';const h=document.createElement('strong');h.textContent=`${e.enabled?'●':'○'} ${catalog.label}`;const p=document.createElement('p');p.textContent=e.url;item.append(h,p);list.append(item);}
  const reviews=$('local-reviews');reviews.replaceChildren();if(s.localReviews?.length){const h=document.createElement('h3');h.textContent='Últimas revisiones locales (sin guardar el texto)';reviews.append(h);for(const r of s.localReviews.slice(0,3)){const label=document.createElement('p');label.textContent=`${r.provider} · ${r.label} · ${new Date(r.at).toLocaleTimeString()}${r.upstreamStatus?' · HTTP '+r.upstreamStatus:''}`;reviews.append(label,...r.tips.slice(0,2).map(tipCard));}}
  if(s.error)showError(s.error);
}
function tipCard(tip){const card=document.createElement('div');card.className='tip';const h=document.createElement('h3');h.textContent=tip.title;const p=document.createElement('p');p.textContent=tip.detail;card.append(h,p);if(tip.example){const b=document.createElement('button');b.textContent='Añadir esta estructura';b.onclick=()=>{$('prompt').value+='\n\n'+tip.example;page('chat');};card.append(b);}return card;}
function analysis(result){$('analysis').hidden=false;$('analysis').replaceChildren();const h=document.createElement('h3');h.textContent=`${result.label} · ${result.redactions} fragmentos redactados`;$('analysis').append(h,...result.tips.map(tipCard));const preview=document.createElement('details');const sum=document.createElement('summary');sum.textContent='Ver texto preparado para compartir';const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=result.redactedText;preview.append(sum,pre);$('analysis').append(preview);}
function bind(id,fn){$(id).onclick=async()=>{const b=$(id);busy.add(id);b.disabled=true;try{await fn();}catch{}finally{busy.delete(id);b.disabled=false;if(state)render(state);}};}
bind('activate',async()=>{render(await invoke('activate',{hubUrl:$('hub').value,code:$('code').value}));$('code').value='';});
bind('save-consent',async()=>{const result=await invoke('consent',{capture:$('capture').checked,shareText:$('shareText').checked,captureResponses:$('captureResponses').checked,reportStatus:$('reportStatus').checked});consentDirty=false;render(result);});
for(const k of ['capture','shareText','captureResponses','reportStatus'])$(k).onchange=()=>{consentDirty=true;if(!$('capture').checked){$('shareText').checked=false;$('captureResponses').checked=false;}if(!$('shareText').checked)$('captureResponses').checked=false;};
bind('pause',async()=>{consentDirty=false;render(await invoke('consent',{capture:false,shareText:false,captureResponses:false,reportStatus:!!state.consent.reportStatus}));});
bind('review',async()=>analysis(await invoke('analyze',{prompt:$('prompt').value})));
function bubble(role,text){const div=document.createElement('div');div.className='conversation-message '+role;const label=document.createElement('strong');label.textContent=role==='user'?'Tu solicitud':'Respuesta del modelo';const pre=document.createElement('pre');pre.textContent=text;div.append(label,pre);return div;}
bind('send',async()=>{const prompt=$('prompt').value;const result=await invoke('chat',{prompt,model:$('model').value});analysis(result.analysis);$('conversation-history').append(bubble('user',prompt),bubble('assistant',result.response));$('prompt').value='';$('response').hidden=true;});
bind('new-conversation',async()=>{await invoke('newConversation');$('conversation-history').replaceChildren();$('analysis').hidden=true;$('response').hidden=true;$('prompt').value='';});
$('start-at-login').onchange=async()=>{try{render(await invoke('startAtLogin',{enabled:$('start-at-login').checked}));}catch{$('start-at-login').checked=!!state.startAtLogin;}};
bind('install-model',async()=>{const old=$('install-model').textContent;$('install-model').textContent='Descargando modelo…';try{render(await invoke('installModel'));}finally{$('install-model').textContent=old;}});
bind('refresh-providers',async()=>render(await invoke('refreshProviders')));
bind('open-gemini',()=>invoke('openAiBrowser',{id:'gemini-web'}));
bind('cli-launcher',async()=>{const result=await invoke('cliLauncher');$('policy-state').textContent='Lanzador preparado: '+result.path;});
bind('enable-system-browsers',async()=>render(await invoke('enableSystemBrowsers')));
bind('disable-system-browsers',async()=>render(await invoke('disableSystemBrowsers')));
bind('recover-system-browsers',()=>invoke('recoverSystemBrowsers'));
bind('open-hub',()=>invoke('openHub'));
bind('disconnect',async()=>{if(confirm('¿Desconectar captura, aportes y reporte automático de estado? Los datos ya enviados siguen sujetos a la retención del servidor.'))render(await invoke('disconnect',{erase:false}));});
bind('erase',async()=>{if(confirm('¿Borrar tus aportes del servidor y desconectar toda participación?'))render(await invoke('disconnect',{erase:true}));});
bind('refresh-insights',async()=>{const data=await invoke('recommendations');const root=$('insight-results');root.className='';root.replaceChildren();if(!data.events.length){root.className='empty';root.textContent='Todavía no hay aportes compartidos por esta instalación.';return;}for(const e of data.events){const h=document.createElement('h3');h.textContent=e.label+' · '+new Date(e.receivedAt).toLocaleDateString();root.append(h,...e.tips.map(tipCard));}});
window.usovia.onPage(id=>{if(['participation','providers','chat','insights'].includes(id))page(id);});window.usovia.onState(render);invoke('state').then(render).catch(()=>{});
