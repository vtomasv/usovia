import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const files=(await readdir(new URL('../tests/',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).sort();
if(!files.length)throw new Error('No test files found: validation must not pass with zero files.');
// Build environments may contain production credentials. Tests use temporary
// FileStore instances and synthetic secrets, never inherited database access.
const env={...process.env};
for(const key of Object.keys(env))if(/PASSWORD|SECRET|TOKEN|DATABASE|^PG|^POSTGRES|^NEON|^VITE_NEON|^VERCEL$|^TENANT_ID$|^PUBLIC_HUB_URL$/.test(key))delete env[key];
console.log(`Running ${files.length} test files without inherited service credentials.`);
const child=spawn(process.execPath,['--test',...files.map(name=>new URL('../tests/'+name,import.meta.url).pathname)],{stdio:'inherit',env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
