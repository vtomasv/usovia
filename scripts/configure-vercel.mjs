import {config} from 'dotenv';
import {spawn} from 'node:child_process';
if(process.argv.includes('--help')){console.log('Configura variables privadas del Hub. Requiere autorización del titular y el argumento --authorized. No imprime valores.');process.exit(0);}
if(!process.argv.includes('--authorized'))throw new Error('Confirma primero la autorización para enviar ADMIN_PASSWORD y SESSION_SECRET al proyecto de Vercel. Después ejecuta con --authorized.');
config({path:'.env.local',quiet:true});
const values={ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,SESSION_SECRET:process.env.SESSION_SECRET,TENANT_ID:'usovia-demo',ORGANIZATION_NAME:'Gobierno corporativo de IA',PUBLIC_HUB_URL:'https://usovia-hub-demo.vercel.app'};
for(const [name,value] of Object.entries(values)){
  if(!value)throw new Error('Falta '+name);
  for(const environment of ['production']){
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['node_modules/vercel/dist/index.js','env','add',name,environment,'--force','--yes','--global-config','.vercel-cli'],{stdio:['pipe','pipe','pipe'],env:{...process.env,VERCEL_TELEMETRY_DISABLED:'1'}});
      child.stdin.end(value+'\n');
      // Do not print CLI output or any environment value.
      child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`No se pudo configurar ${name} en ${environment}`)));
    });
  }
  console.log('Configurada:',name);
}
