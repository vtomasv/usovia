import {config} from 'dotenv';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const parsed=config({path:'.runtime/blob.env',quiet:true}).parsed;
if(!parsed?.BLOB_READ_WRITE_TOKEN)throw new Error('Recupera la credencial del almacén de instaladores en .runtime/blob.env.');
const {version}=JSON.parse(await readFile('desktop/package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Versión de distribución inválida.');
const directory=process.argv[2]||'release';if(!/^release(?:-[a-z0-9.-]+)?$/.test(directory))throw new Error('Directorio de distribución inválido.');
const file=`desktop/${directory}/Usovia-${version}-arm64.dmg`;
const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
const uploadEnv={...process.env,BLOB_READ_WRITE_TOKEN:parsed.BLOB_READ_WRITE_TOKEN,VERCEL_TELEMETRY_DISABLED:'1'};
delete uploadEnv.VERCEL_OIDC_TOKEN;delete uploadEnv.BLOB_STORE_ID;
const output=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['node_modules/vercel/dist/index.js','blob','put',file,'--access','public','--allow-overwrite','true','--pathname',`releases/${version}/${sha256.slice(0,12)}/Usovia-${version}-arm64.dmg`,'--global-config','.vercel-cli'],{env:uploadEnv,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.on('error',reject);child.on('exit',code=>{
    if(code===0)return resolve(stdout+'\n'+stderr);
    let safe=stderr;for(const value of Object.values(parsed))if(value?.length>12)safe=safe.replaceAll(value,'[CREDENCIAL]');
    reject(new Error('No se pudo publicar el instalador: '+safe.slice(-1200)));
  });
});
const url=output.match(/https:\/\/[^\s"<>]+\.public\.blob\.vercel-storage\.com\/[^\s"<>]+\.dmg/)?.[0];
if(!url)throw new Error('La publicación terminó pero no se pudo obtener la URL. Consulta el almacén antes de volver a publicar.');
await writeFile('shared/release.mjs',`// Public release metadata; never contains credentials.\nexport const desktopRelease=${JSON.stringify({url,sha256,version,platform:'macOS Apple Silicon',signed:false},null,2)};\n`);
console.log('Instalador publicado:',url);console.log('SHA-256:',sha256);
