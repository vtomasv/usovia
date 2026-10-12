import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractFile} from '@electron/asar';
import {resolve} from 'node:path';
const digest=data=>createHash('sha256').update(data).digest('hex');
const release=process.argv[2]||'release';
const directory=resolve('desktop',release,'mac-arm64/Usovia.app/Contents/Resources');
const archive=resolve(directory,'app.asar');
const files=['main.mjs','controller.mjs','conversations.mjs','gateway.mjs','preload.cjs','ui/style.css','tls-proxy.mjs','system-routing.mjs','ui/index.html','ui/renderer.js'];
const checks=[];
for(const file of files){checks.push({file,equal:digest(extractFile(archive,file))===digest(await readFile(resolve('desktop',file)))});}
for(const file of ['providers.mjs','analysis.mjs','cli-entry.mjs']){checks.push({file:'shared/'+file,equal:digest(await readFile(resolve(directory,'shared',file)))===digest(await readFile(resolve('shared',file)))});}
checks.push({file:'browser-helper/usovia-browser-helper',equal:digest(await readFile(resolve(directory,'browser-helper/usovia-browser-helper')))===digest(await readFile('desktop/native/bin/usovia-browser-helper'))});
const version=JSON.parse(extractFile(archive,'package.json').toString()).version;
const file=resolve('desktop',release,`Usovia-${version}-arm64.dmg`);
const result={version,platform:'macos-arm64',realSystemBrowserTest:'pending_local_admin_authorization',unsigned:true,checks,allMatch:checks.every(c=>c.equal),installer:{file,bytes:(await stat(file)).size,sha256:digest(await readFile(file))}};
await mkdir('lab/browser-system/evidence',{recursive:true});await writeFile('lab/browser-system/evidence/package-'+version+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.allMatch)process.exitCode=1;
