import {createHmac,timingSafeEqual} from 'node:crypto';
import {HubService,ApiError} from './service.mjs';
import {getStore} from './store.mjs';
import {desktopRelease,desktopReleases} from '../shared/release.mjs';
import {configuredReleases} from '../shared/downloads.mjs';
import {ExportService} from './analytics/export.mjs';
const COOKIE='usovia_admin';
const eq=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
function key(){if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw new ApiError(503,'Configura SESSION_SECRET con al menos 32 caracteres.');return process.env.SESSION_SECRET;}
function admin(req){
  const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!cookie)return false;
  const [value,signature]=cookie.split('.');if(!value||!signature)return false;
  if(!eq(signature,createHmac('sha256',key()).update(value).digest('base64url')))return false;
  try{return JSON.parse(Buffer.from(value,'base64url').toString()).exp>Date.now();}catch{return false;}
}
function issueSession(){const value=Buffer.from(JSON.stringify({exp:Date.now()+8*3600000})).toString('base64url');return value+'.'+createHmac('sha256',key()).update(value).digest('base64url');}
async function readBody(req){
  const object=value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'Envía un objeto JSON.');return value;};
  if(req.body!==undefined){if(Buffer.byteLength(JSON.stringify(req.body))>65536)throw new ApiError(413,'Solicitud demasiado grande.');try{return object(typeof req.body==='string'?JSON.parse(req.body):req.body);}catch(e){if(e.status)throw e;throw new ApiError(400,'JSON inválido.');}}
  const chunks=[];let bytes=0;for await(const chunk of req){const value=Buffer.from(chunk);bytes+=value.length;if(bytes>65536)throw new ApiError(413,'Solicitud demasiado grande.');chunks.push(value);}
  const raw=Buffer.concat(chunks,bytes).toString('utf8');
  try{return object(raw?JSON.parse(raw):{});}catch(e){if(e.status)throw e;throw new ApiError(400,'JSON inválido.');}
}
const attempts=new Map();
export async function handle(req,res,providedService,onSemanticWork){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  try{
    const url=new URL(req.url,'http://localhost');
    const route=(req.query?.path??url.searchParams.get('path')??url.pathname.replace(/^\/api\/?/,''));
    if(route==='health'){const ready=!!process.env.DATABASE_URL||!process.env.VERCEL;return send(ready?200:503,{ok:ready,storage:process.env.DATABASE_URL?'postgres':process.env.VERCEL?'missing':'local',version:'1.2.0',capabilities:['usage_analytics','semantic_index','private_semantic_cpu','parquet_exports']});}
    if(route==='config'){
      const releases=configuredReleases(desktopReleases,process.env.DESKTOP_DOWNLOAD_URL);
      return send(200,{organization:process.env.ORGANIZATION_NAME||'Gobierno corporativo de IA',desktopReleases:releases,downloadUrl:releases.find(r=>r.id==='macos-arm64')?.url||null,downloadSha256:releases.find(r=>r.id==='macos-arm64')?.sha256||null,downloadVersion:releases.find(r=>r.id==='macos-arm64')?.version||desktopRelease.version,hubUrl:process.env.PUBLIC_HUB_URL||null,channels:['Chat de Usovia','API local compatible','Gemini web en Usovia','API y CLI con proxy TLS'],analysisMethod:'Reglas explicables · CPU',centralReady:(!process.env.VERCEL||!!process.env.DATABASE_URL)&&!!process.env.ADMIN_PASSWORD&&!!process.env.SESSION_SECRET});
    }
    const method=req.method||'GET';
    if(method!=='GET'&&method!=='HEAD'){
      // Admin browser requests are same-origin; desktop endpoints use scoped bearer credentials.
      const origin=req.headers.origin;
      if(origin&&origin!==url.origin&&origin!==process.env.PUBLIC_HUB_URL&&origin!==`https://${req.headers.host}`&&origin!==`http://${req.headers.host}`)throw new ApiError(403,'Origen no autorizado.');
    }
    if(route==='session'&&method==='GET')return send(200,{authenticated:admin(req)});
    if(route==='login'&&method==='POST'){
      const body=await readBody(req);const ip=req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown';
      const previous=attempts.get(ip)||{count:0,until:Date.now()+60000};if(previous.until<Date.now()){previous.count=0;previous.until=Date.now()+60000;}
      previous.count++;attempts.set(ip,previous);if(attempts.size>5000)attempts.clear();
      if(previous.count>10)throw new ApiError(429,'Espera un minuto antes de volver a intentar.');
      if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw new ApiError(503,'Configura una contraseña administrativa de al menos 12 caracteres.');
      if(typeof body.password!=='string'||!eq(body.password,process.env.ADMIN_PASSWORD))throw new ApiError(401,'Contraseña incorrecta.');
      const secure=process.env.VERCEL?'; Secure':'';
      res.setHeader('Set-Cookie',`${COOKIE}=${issueSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`);return send(200,{authenticated:true});
    }
    if(route==='logout'&&method==='POST'){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);return send(200,{ok:true});}
    const service=providedService||new HubService(getStore());
    const clientRoutes=['activate','consent','heartbeat','events','recommendations','erase','client-policy'];
    if(clientRoutes.includes(route)){
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      if(route==='client-policy'&&method==='GET')return send(200,await service.clientPolicy(token));
      if(route==='recommendations'&&method==='GET')return send(200,await service.recommendations(token));
      if(method!=='POST')throw new ApiError(405,'Método no permitido.');
      const body=await readBody(req);
      const call={activate:()=>service.activate(body),consent:()=>service.consent(token,body),heartbeat:()=>service.heartbeat(token,body),events:()=>service.ingest(token,body),erase:()=>service.erase(token)}[route];
      if(!call)throw new ApiError(405,'Método no permitido.');const result=await call();send(200,result);if(route==='events'&&result.accepted?.length)onSemanticWork?.();return;
    }
    if(!admin(req))throw new ApiError(401,'Inicia sesión para abrir la consola.');
    if(route==='analytics/session'&&method==='GET')return send(200,await service.analytics.session(Object.fromEntries(url.searchParams)));
    if(route==='analytics'&&method==='GET'){const data=await service.analytics.dashboard(Object.fromEntries(url.searchParams));send(200,data);if(data.semantic.pending>0)onSemanticWork?.();return;}
    if(route==='accounts'&&method==='GET')return send(200,await service.analytics.directory(Object.fromEntries(url.searchParams)));
    if(route==='analytics/reviews'&&method==='POST')return send(200,await service.analytics.review(await readBody(req)));
    if(route==='analytics/exports'&&method==='POST')return send(201,await new ExportService(service.analytics).create(await readBody(req)));
    const exportPart=/^analytics\/exports\/([a-f0-9-]{36})\/(\d+)\.parquet$/.exec(route);
    if(exportPart&&method==='GET'){const part=await new ExportService(service.analytics).part(exportPart[1],Number(exportPart[2]));res.statusCode=200;res.setHeader('Content-Type','application/vnd.apache.parquet');res.setHeader('Content-Disposition',`attachment; filename="${part.filename}"`);res.setHeader('Content-Length',part.bytes.length);res.setHeader('X-Usovia-Export-Rows',String(part.rows));res.setHeader('X-Usovia-Unavailable-Rows',String(part.unavailable));return res.end(part.bytes);}
    if(route==='providers'&&method==='GET')return send(200,await service.providers());
    if(route==='providers'&&method==='PUT')return send(200,await service.updateProviders(await readBody(req)));
    if(route==='conversations'&&method==='GET')return send(200,await service.conversations({...Object.fromEntries(['account','department','office','tag','query','groupBy','conversation','snapshotAt','afterTurn'].map(k=>[k,url.searchParams.get(k)||''])),view:'list'}));
    if(route==='overview'&&method==='GET')return send(200,await service.overview());
    if(route==='accounts'&&method==='POST')return send(201,await service.createAccount(await readBody(req)));
    if(route.startsWith('accounts/')&&method==='PATCH')return send(200,await service.updateAccount(route.slice(9),await readBody(req)));
    throw new ApiError(404,'Ruta no encontrada.');
  }catch(error){send(error.status||500,{error:error.status?error.message:'El servidor no pudo completar la operación.'});}
}
