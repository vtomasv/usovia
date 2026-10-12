import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SystemRouting} from './system-routing.mjs';
const run=promisify(execFile);
export class WindowsRouting extends SystemRouting {
  get supportedPlatform(){return this.platform==='win32';}
  get statusPath(){return join(this.directory,this.id+'.status.json');}
  async inspect(){const result=await run(this.helper,['inspect'],{timeout:30000,maxBuffer:65536,windowsHide:true});return JSON.parse(result.stdout);}
  async authorize(plan){
    const result=await run(this.helper,['authorize',plan.path],{timeout:10000,maxBuffer:65536,windowsHide:true});
    return JSON.parse(result.stdout);
  }
  async authorizeRecovery(){const result=await run(this.helper,['recover',this.directory],{timeout:30000,maxBuffer:65536,windowsHide:true});return JSON.parse(result.stdout);}
}
