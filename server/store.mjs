import postgres from 'postgres';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export const emptyState=()=>({schemaVersion:1,accounts:[],installations:[],events:[],audit:[]});
export class FileStore{
  constructor(path){this.path=path;this.tail=Promise.resolve();}
  async transact(fn){
    let release;const previous=this.tail;this.tail=new Promise(r=>release=r);await previous;
    try{
      let state;try{state=JSON.parse(await readFile(this.path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=emptyState();}
      const result=await fn(state);
      await mkdir(dirname(this.path),{recursive:true});
      const temporary=this.path+'.tmp';await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,this.path);
      return result;
    }finally{release();}
  }
}
export class PostgresStore{
  constructor(url,tenant){this.tenant=tenant;this.sql=postgres(url,{max:2,connect_timeout:10,idle_timeout:20,ssl:{rejectUnauthorized:true}});this.ready=null;}
  async init(){
    if(!this.ready)this.ready=(async()=>{
      await this.sql`CREATE TABLE IF NOT EXISTS usovia_demo_state (tenant_id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
      await this.sql`INSERT INTO usovia_demo_state (tenant_id,payload) VALUES (${this.tenant},${this.sql.json(emptyState())}) ON CONFLICT DO NOTHING`;
    })().catch(e=>{this.ready=null;throw e;});
    return this.ready;
  }
  async transact(fn){
    await this.init();
    return this.sql.begin(async sql=>{
      const [row]=await sql`SELECT payload FROM usovia_demo_state WHERE tenant_id=${this.tenant} FOR UPDATE`;
      const state=row.payload;const result=await fn(state);
      await sql`UPDATE usovia_demo_state SET payload=${sql.json(state)},updated_at=now() WHERE tenant_id=${this.tenant}`;
      return result;
    });
  }
}
let singleton;
export function getStore(){
  if(singleton)return singleton;
  if(process.env.DATABASE_URL)return singleton=new PostgresStore(process.env.DATABASE_URL,process.env.TENANT_ID||'usovia-demo');
  if(process.env.VERCEL)throw Object.assign(new Error('Configura DATABASE_URL para habilitar la persistencia del Hub.'),{status:503});
  return singleton=new FileStore(process.env.USOVIA_LOCAL_DATA||'.runtime/hub.json');
}
