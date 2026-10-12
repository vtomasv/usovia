import 'dotenv/config';
import {config} from 'dotenv';
import {appendFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {handle} from '../server/http.mjs';
config({path:'.env.local',quiet:true});
process.env.PUBLIC_HUB_URL='http://127.0.0.1:5173';
if(!process.env.ADMIN_PASSWORD||!process.env.SESSION_SECRET){
  mkdirSync('.runtime',{recursive:true});
  const password='usovia-'+randomBytes(12).toString('hex');
  const secret=randomBytes(32).toString('hex');
  const additions=[];
  if(!process.env.ADMIN_PASSWORD){additions.push(`ADMIN_PASSWORD=${password}`);process.env.ADMIN_PASSWORD=password;}
  if(!process.env.SESSION_SECRET){additions.push(`SESSION_SECRET=${secret}`);process.env.SESSION_SECRET=secret;}
  appendFileSync('.env.local','\n'+additions.join('\n')+'\n',{mode:0o600});
  console.log('Configuración local creada. La contraseña de consola está en .env.local (no se publica).');
}
const server=createServer(handle);server.listen(4310,'127.0.0.1',()=>console.log('Usovia Hub API http://127.0.0.1:4310/api/health'));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'});
process.on('SIGINT',()=>{vite.kill();server.close();process.exit(0);});
