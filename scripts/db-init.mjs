import {config} from 'dotenv';
import {getStore} from '../server/store.mjs';
config({path:'.env.local',quiet:true});
if(process.env.DATABASE_URL==='[SENSITIVE]'||process.env.TENANT_ID==='[SENSITIVE]')throw new Error('Las variables descargadas contienen valores protegidos. Indica DATABASE_URL y TENANT_ID válidos antes de inicializar.');
await getStore().transact(()=>({ok:true}));
console.log('Persistencia de Usovia inicializada.');process.exit(0);
