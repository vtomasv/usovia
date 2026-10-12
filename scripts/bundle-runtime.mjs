import {readdir,cp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Este empaquetado de piloto requiere macOS Apple Silicon.');
if(!process.argv[2])throw new Error('Indica el directorio Contents/Resources de una instalación oficial de Ollama.');
const source=resolve(process.argv[2]),target=resolve('desktop/runtime');
const entries=await readdir(source,{withFileTypes:true});
if(!entries.some(e=>e.name==='ollama'))throw new Error('No se encontró el ejecutable de Ollama.');
await mkdir(target,{recursive:true});
for(const e of entries){
  if(['ollama','llama-server','llama-quantize'].includes(e.name)||e.name.endsWith('.dylib')||/^mlx_metal_v\d+$/.test(e.name)||/LICENSE|NOTICE/.test(e.name))await cp(join(source,e.name),join(target,e.name),{recursive:true,dereference:true});
}
await cp('licenses/Ollama-LICENSE',join(target,'OLLAMA_LICENSE'));
const manifest=[];
async function inventory(directory,prefix=''){
  for(const e of await readdir(directory,{withFileTypes:true})){
    if(e.name==='runtime-manifest.json')continue;
    const path=join(directory,e.name),name=prefix+e.name;
    if(e.isDirectory())await inventory(path,name+'/');
    else manifest.push({path:name,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
  }
}
await inventory(target);
const version=execFileSync(join(target,'ollama'),['--version'],{env:{...process.env,OLLAMA_HOST:'127.0.0.1:11438',OLLAMA_NO_CLOUD:'1'},encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
await writeFile(join(target,'runtime-manifest.json'),JSON.stringify({source:'Installed official Ollama macOS resources',platform:'darwin-arm64',version,files:manifest},null,2)+'\n');
console.log('Motor y avisos de licencia preparados; manifiesto SHA-256 generado.');
