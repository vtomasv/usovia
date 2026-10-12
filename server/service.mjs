import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {analyze,aggregate,opportunities} from '../shared/analysis.mjs';
import {defaultPolicy,validatePolicy,providerCatalog} from '../shared/providers.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const now=()=>new Date().toISOString();
export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ApiError(status,message);};
const text=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max):'';
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function publicAccount(a){const {activationHash,activationExpires,...rest}=a;return rest;}
export class HubService{
  constructor(store){this.store={transact:fn=>store.transact(s=>{const cutoff=Date.now()-7*86400000;s.events=s.events.filter(e=>Date.parse(e.receivedAt)>cutoff).slice(-500);s.audit=s.audit.slice(-1000);return fn(s);})};}
  async providers(){return this.store.transact(s=>({policy:validatePolicy(s.providerPolicy||defaultPolicy()),catalog:providerCatalog}));}
  async clientPolicy(token){return this.store.transact(s=>{this.authenticate(s,token);return {policy:validatePolicy(s.providerPolicy||defaultPolicy())};});}
  async updateProviders(input){return this.store.transact(s=>{
    const current=validatePolicy(s.providerPolicy||defaultPolicy());
    if(input.revision!==current.revision)fail(409,'La política cambió. Actualiza antes de guardar.');
    let policy;try{policy=validatePolicy({schemaVersion:1,revision:current.revision+1,updatedAt:now(),endpoints:input.endpoints});}catch(e){fail(400,e.message);}
    s.providerPolicy=policy;s.audit.push({at:now(),action:'providers.updated',revision:policy.revision});return {policy,catalog:providerCatalog};
  });}
  async overview(){return this.store.transact(s=>({accounts:s.accounts.map(publicAccount),installations:s.installations.map(({tokenHash,...i})=>({...i,reachable:!!i.lastSeen&&Date.now()-Date.parse(i.lastSeen)<90000})),events:s.events.slice(-25).reverse(),tasks:aggregate(s.events),opportunities:opportunities(s.events),totals:{accounts:s.accounts.length,events:s.events.length,redactions:s.events.reduce((n,e)=>n+e.redactions,0)}}));}
  async createAccount(input){return this.store.transact(s=>{
    if(s.accounts.length>=100)fail(409,'Se alcanzó el límite de 100 cuentas de este espacio.');
    const code='USV-'+secret();
    const account={id:randomUUID(),label:'Cuenta '+String(s.accounts.length+1).padStart(3,'0'),department:text(input.department)||'Sin asignar',country:text(input.country)||'Sin asignar',office:text(input.office)||'Sin asignar',tags:Array.isArray(input.tags)?input.tags.map(t=>text(t,35)).filter(Boolean).slice(0,8):[],enabled:true,createdAt:now(),activationHash:hash(code),activationExpires:new Date(Date.now()+86400000).toISOString()};
    s.accounts.push(account);s.audit.push({at:now(),action:'account.created',accountId:account.id});
    return {account:publicAccount(account),activationCode:code,expiresAt:account.activationExpires};
  });}
  async updateAccount(id,input){return this.store.transact(s=>{
    const a=s.accounts.find(a=>a.id===id);if(!a)fail(404,'Cuenta no encontrada.');
    if(typeof input.enabled==='boolean')a.enabled=input.enabled;
    for(const k of ['department','country','office'])if(typeof input[k]==='string')a[k]=text(input[k]);
    if(Array.isArray(input.tags))a.tags=input.tags.map(t=>text(t,35)).filter(Boolean).slice(0,8);
    s.audit.push({at:now(),action:'account.updated',accountId:id});return publicAccount(a);
  });}
  async activate(input){return this.store.transact(s=>{
    const code=text(input.activationCode,150);if(!code)fail(400,'Ingresa el ID de activación.');
    const account=s.accounts.find(a=>a.activationHash&&equal(a.activationHash,hash(code)));
    if(!account||Date.parse(account.activationExpires)<Date.now())fail(401,'El ID de activación no es válido, expiró o ya se usó.');
    if(!account.enabled)fail(403,'La cuenta está suspendida.');
    const token=secret();
    const installation={id:randomUUID(),accountId:account.id,tokenHash:hash(token),platform:text(input.platform,30)||'desktop',version:text(input.version,20)||'0.1.0',createdAt:now(),lastSeen:null,consent:{capture:false,shareText:false,captureResponses:false,reportStatus:false},consentVersion:0,consentHistory:[],state:'sin_participacion'};
    s.installations.push(installation);account.activationHash=null;account.activationExpires=null;
    return {account:publicAccount(account),installationId:installation.id,token};
  });}
  authenticate(s,token,{allowSuspended=false}={}){const i=s.installations.find(i=>equal(i.tokenHash,hash(token||'')));if(!i)fail(401,'Credencial del cliente no válida.');const a=s.accounts.find(a=>a.id===i.accountId);if(!a?.enabled&&!allowSuspended)fail(403,'La cuenta está suspendida.');return i;}
  async consent(token,input){return this.store.transact(s=>{
    const c={...input.scopes,captureResponses:input.scopes?.captureResponses??false};
    const withdrawal=['capture','shareText','captureResponses','reportStatus'].every(k=>c[k]===false);
    const i=this.authenticate(s,token,{allowSuspended:withdrawal});
    if(['capture','shareText','captureResponses','reportStatus'].some(k=>typeof c[k]!=='boolean'))fail(400,'Los permisos deben ser explícitos.');
    if(input.version===i.consentVersion&&['capture','shareText','captureResponses','reportStatus'].every(k=>c[k]===(i.consent[k]??false)))return {consent:i.consent,version:i.consentVersion};
    if(!Number.isInteger(input.version)||input.version<=i.consentVersion)fail(409,'Versión de consentimiento anterior o en conflicto.');
    if(c.shareText&&!c.capture)fail(400,'El envío de texto requiere captura autorizada.');
    if(c.captureResponses&&(!c.capture||!c.shareText))fail(400,'El envío de respuestas requiere autorización de captura y texto.');
    i.consent={capture:c.capture,shareText:c.shareText,captureResponses:c.captureResponses,reportStatus:c.reportStatus};i.consentVersion=input.version;
    i.consentHistory.push({at:now(),version:input.version,scopes:i.consent});
    i.consentHistory=i.consentHistory.slice(-30);
    i.state=c.capture?'participando':c.reportStatus?'solo_estado':'participacion_desactivada';
    if(!c.capture){i.proxyActive=false;i.gatewayActive=false;i.systemBrowserActive=false;}
    // This user-initiated consent message is not an automatic heartbeat.
    return {consent:i.consent,version:i.consentVersion};
  });}
  async heartbeat(token,input){return this.store.transact(s=>{
    const i=this.authenticate(s,token);if(!i.consent.reportStatus)fail(403,'El reporte de estado está desactivado.');
    if(input.consentVersion!==i.consentVersion)fail(409,'Actualiza el consentimiento antes de reportar.');
    i.lastSeen=now();i.state=i.consent.capture?'participando':'solo_estado';
    i.proxyActive=!!input.proxyActive&&i.consent.capture;i.systemBrowserActive=!!input.systemBrowserActive&&i.consent.capture;i.policyRevision=Number.isSafeInteger(input.policyRevision)?input.policyRevision:null;i.gatewayActive=!!input.gatewayActive&&i.consent.capture;i.ollamaReady=!!input.ollamaReady;i.pending=Math.min(1000,Math.max(0,Number(input.pending)||0));
    return {receivedAt:i.lastSeen};
  });}
  async ingest(token,input){return this.store.transact(s=>{
    const i=this.authenticate(s,token);if(!i.consent.capture||!i.consent.shareText)fail(403,'No hay permiso vigente para compartir texto.');
    if(input.consentVersion!==i.consentVersion)fail(409,'El aporte pertenece a un consentimiento anterior.');
    if(!Array.isArray(input.events)||input.events.length>20||input.events.length===0)fail(400,'Envía de 1 a 20 aportes.');
    const accepted=[];
    for(const e of input.events){
      if(typeof e.id!=='string'||!/^[a-f0-9-]{36}$/i.test(e.id)||typeof e.redactedText!=='string'||e.redactedText.length>12000)fail(400,'El aporte tiene un formato inválido.');
      if(e.redactedResponse!==undefined&&(typeof e.redactedResponse!=='string'||e.redactedResponse.length>12000))fail(400,'Respuesta demasiado grande o inválida.');
      if(e.redactedResponse!==undefined&&!i.consent.captureResponses)fail(403,'El envío de respuestas no está autorizado.');
      if(e.conversationId!==undefined&&(typeof e.conversationId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(e.conversationId)))fail(400,'Sesión de conversación inválida.');
      if(e.turnIndex!==undefined&&(!Number.isSafeInteger(e.turnIndex)||e.turnIndex<1||e.turnIndex>1000000))fail(400,'Secuencia de turno inválida.');
      const existing=s.events.find(x=>x.id===e.id);
      if(existing){if(existing.installationId!==i.id)fail(409,'Identificador de aporte ya utilizado.');accepted.push(e.id);continue;}
      const result=analyze(e.redactedText);const answer=typeof e.redactedResponse==='string'?analyze(e.redactedResponse):null;
      if(e.conversationId&&s.events.some(x=>x.installationId===i.id&&x.conversationId===e.conversationId&&x.turnIndex===e.turnIndex))fail(409,'Ese turno ya existe en la conversación.');
      s.events.push({id:e.id,accountId:i.accountId,installationId:i.id,receivedAt:now(),observedAt:typeof e.observedAt==='string'&&!Number.isNaN(Date.parse(e.observedAt))?e.observedAt:now(),provider:text(e.provider,35)||'ollama',model:text(e.model,70),channel:['chat_usovia','gateway_api','aporte_manual','tls_web','tls_cli','tls_api','tls_web_fixture'].includes(e.channel)?e.channel:'aporte_manual',upstreamStatus:Number.isInteger(e.upstreamStatus)&&e.upstreamStatus>=100&&e.upstreamStatus<=599?e.upstreamStatus:null,conversationId:e.conversationId||e.id,turnIndex:e.turnIndex||1,sessionSource:['explicit','provider','history','independent'].includes(e.sessionSource)?e.sessionSource:'independent',finishedAt:typeof e.finishedAt==='string'&&!Number.isNaN(Date.parse(e.finishedAt))?e.finishedAt:null,promptTruncated:!!e.promptTruncated,responseStatus:i.consent.captureResponses&&['complete','error','aborted','truncated','incomplete','unsupported','not_authorized'].includes(e.responseStatus)?e.responseStatus:'not_authorized',responseTruncated:!!e.responseTruncated,modelLimited:!!e.modelLimited,...(answer?{redactedResponse:answer.redactedText,responseRedactions:Math.max(0,Math.min(500,Number(e.responseRedactions)||0))+answer.redactions}:{}),task:result.task,label:result.label,redactedText:result.redactedText,redactions:Math.max(0,Math.min(500,Number(e.redactions)||0))+result.redactions,tips:result.tips,consentVersion:i.consentVersion,method:result.method});accepted.push(e.id);
    }
    // Bounded pilot retention: latest 500 records, at most seven days.
    const cutoff=Date.now()-7*86400000;s.events=s.events.filter(e=>Date.parse(e.receivedAt)>cutoff).slice(-500);
    return {accepted,recommendations:s.events.filter(e=>accepted.includes(e.id)).map(e=>({eventId:e.id,task:e.label,tips:e.tips,method:e.method}))};
  });}
  async conversations(filters={}){return this.store.transact(s=>{
    const accounts=s.accounts.map(publicAccount),accountMap=new Map(accounts.map(a=>[a.id,a]));
    const filtered=s.events.filter(e=>{const a=accountMap.get(e.accountId);return a&&(!filters.account||a.id===filters.account)&&(!filters.department||a.department===filters.department)&&(!filters.office||a.office===filters.office)&&(!filters.tag||a.tags.includes(filters.tag));});
    const map=new Map();
    for(const event of filtered){const id=event.conversationId||event.id,key=event.installationId+':'+id;let conversation=map.get(key);if(!conversation){conversation={id,key,accountId:event.accountId,installationId:event.installationId,provider:event.provider,model:event.model,channel:event.channel,sessionSource:event.sessionSource||'independent',turns:[]};map.set(key,conversation);}conversation.turns.push(event);}
    const conversations=[...map.values()].filter(c=>!filters.query||c.turns.some(e=>[e.redactedText,e.redactedResponse,e.provider,e.label].join(' ').toLowerCase().includes(String(filters.query).toLowerCase().slice(0,200)))).map(c=>{c.turns.sort((a,b)=>(a.turnIndex||1)-(b.turnIndex||1)||Date.parse(a.observedAt)-Date.parse(b.observedAt));const indexes=c.turns.map(t=>t.turnIndex||1);return {...c,sessionSource:['explicit','provider','history','independent'].find(source=>c.turns.some(t=>t.sessionSource===source))||'independent',firstAt:c.turns[0].observedAt,lastAt:c.turns.at(-1).observedAt,hasGaps:indexes[0]!==1||indexes.some((n,i)=>i>0&&n!==indexes[i-1]+1),limited:c.turns.some(t=>t.promptTruncated||t.responseTruncated||t.modelLimited||t.responseStatus!=='complete')};}).sort((a,b)=>Date.parse(b.lastAt)-Date.parse(a.lastAt));
    const groupBy=['account','department','office','tag'].includes(filters.groupBy)?filters.groupBy:'account',groups=new Map();
    for(const c of conversations){const a=accountMap.get(c.accountId);const keys=groupBy==='account'?[a.id]:groupBy==='tag'?(a.tags.length?a.tags:['Sin etiqueta']):[a[groupBy]];
      for(const key of keys){let g=groups.get(key);if(!g){g={key,label:groupBy==='account'?a.label:key,accounts:new Set(),conversations:0,turns:0,answers:0};groups.set(key,g);}g.accounts.add(a.id);g.conversations++;g.turns+=c.turns.length;g.answers+=c.turns.filter(t=>t.redactedResponse!==undefined).length;}
    }
    const summary=c=>{const {turns,...metadata}=c;return {...metadata,turnCount:turns.length,preview:turns[0].redactedText.slice(0,160)};};
    const grouped=[...groups.values()].map(g=>({...g,accounts:g.accounts.size}));
    if(filters.conversation){
      const c=conversations.find(c=>c.key===filters.conversation);if(!c)fail(404,'Conversación no encontrada o ya fuera de retención.');
      const requested=Date.parse(filters.snapshotAt),snapshotAt=new Date(Number.isFinite(requested)?Math.min(requested,Date.now()):Date.now()).toISOString();
      const after=Number.isSafeInteger(Number(filters.afterTurn))?Math.max(0,Number(filters.afterTurn)):0;
      const retained=c.turns.filter(t=>Date.parse(t.receivedAt)<=Date.parse(snapshotAt)),remaining=retained.filter(t=>(t.turnIndex||1)>after),turns=remaining.slice(0,25);
      return {accounts,conversation:{...summary(c),turns,turnCount:retained.length},snapshotAt,nextAfterTurn:remaining.length>turns.length?turns.at(-1).turnIndex||1:null,retention:{days:7,maxTurns:500}};
    }
    return {accounts,conversations:filters.view==='list'?conversations.map(summary):conversations,groups:grouped,groupBy,retention:{days:7,maxTurns:500},totalTurns:conversations.reduce((n,c)=>n+c.turns.length,0)};
  });}
  async recommendations(token){return this.store.transact(s=>{
    const i=this.authenticate(s,token);const events=s.events.filter(e=>e.installationId===i.id);
    return {events:events.slice(-15).reverse(),tasks:aggregate(events),opportunities:opportunities(events),account:publicAccount(s.accounts.find(a=>a.id===i.accountId))};
  });}
  async erase(token){return this.store.transact(s=>{const i=this.authenticate(s,token,{allowSuspended:true});s.events=s.events.filter(e=>e.installationId!==i.id);i.consent={capture:false,shareText:false,captureResponses:false,reportStatus:false};i.consentVersion++;i.state='datos_eliminados';return {erased:true,consentVersion:i.consentVersion};});}
}
