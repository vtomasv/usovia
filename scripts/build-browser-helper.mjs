import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
const native=new URL('../desktop/native/',import.meta.url);
mkdirSync(new URL('bin/',native),{recursive:true});
if(process.platform!=='darwin')throw new Error('Compilar el ayudante de macOS en macOS.');
const object='/private/tmp/usovia-authorization-'+process.pid+'.o';
try{
  execFileSync('/usr/bin/clang',['-O2','-arch','arm64','-mmacosx-version-min=12.0','-c',new URL('AuthorizationBridge.c',native).pathname,'-o',object],{stdio:'inherit'});
  execFileSync('/usr/bin/swiftc',['-O','-target','arm64-apple-macosx12.0','-module-cache-path','/private/tmp/usovia-swift-cache','-import-objc-header',new URL('AuthorizationBridge.h',native).pathname,new URL('BrowserRouting.swift',native).pathname,object,'-o',new URL('bin/usovia-browser-helper',native).pathname],{stdio:'inherit'});
}finally{rmSync(object,{force:true});}
