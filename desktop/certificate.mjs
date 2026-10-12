import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import {webcrypto,createPrivateKey,randomBytes,X509Certificate} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
const serial=()=> '01'+randomBytes(19).toString('hex');
const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',publicExponent:new Uint8Array([1,0,1]),modulusLength:2048};
const generate=()=>webcrypto.subtle.generateKey(algorithm,true,['sign','verify']);
const privatePem=async key=>{const der=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',key));return '-----BEGIN PRIVATE KEY-----\n'+der.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END PRIVATE KEY-----\n';};
export async function generateAuthority(){
  const keys=await generate();
  const cert=await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber:serial(),name:'CN=Usovia Endpoint '+randomBytes(6).toString('hex')+', O=Usovia',
    notBefore:new Date(Date.now()-60000),notAfter:new Date(Date.now()+90*86400000),signingAlgorithm:algorithm,keys,
    extensions:[new x509.BasicConstraintsExtension(true,0,true),new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign|x509.KeyUsageFlags.cRLSign,true),await x509.SubjectKeyIdentifierExtension.create(keys.publicKey,false,webcrypto)]
  },webcrypto);
  return {cert:cert.toString('pem'),key:await privatePem(keys.privateKey)};
}
export async function loadAuthority(directory,storage){
  if(!storage.isEncryptionAvailable())throw new Error('La CA requiere el almacén cifrado del sistema.');
  await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  const privateFile=join(directory,'authority.enc');let authority;
  try{authority=JSON.parse(storage.decryptString(await readFile(privateFile)));const cert=new X509Certificate(authority.cert);if(!cert.ca||!cert.verify(cert.publicKey))throw new Error('CA inválida.');if(Date.parse(cert.validTo)-Date.now()<3*86400000)authority=null;}
  catch(e){if(e.code!=='ENOENT')throw new Error('No se pudo abrir la CA cifrada; no se activa inspección.');}
  if(!authority){authority=await generateAuthority();await writeFile(privateFile+'.tmp',storage.encryptString(JSON.stringify(authority)),{mode:0o600});await rename(privateFile+'.tmp',privateFile);}
  const publicPath=join(directory,'usovia-root.pem');await writeFile(publicPath,authority.cert,{mode:0o600});
  return {...authority,publicPath,fingerprint:new X509Certificate(authority.cert).fingerprint256};
}
export async function issueLeaf(authority,hostname){
  const keys=await generate(),root=new x509.X509Certificate(authority.cert);
  const signingKey=await webcrypto.subtle.importKey('pkcs8',createPrivateKey(authority.key).export({format:'der',type:'pkcs8'}),algorithm,false,['sign']);
  const cert=await x509.X509CertificateGenerator.create({
    serialNumber:serial(),subject:'CN='+hostname,issuer:root.subject,notBefore:new Date(Date.now()-60000),notAfter:new Date(Math.min(Date.now()+86400000,root.notAfter.getTime())),
    signingAlgorithm:algorithm,publicKey:keys.publicKey,signingKey,
    extensions:[new x509.BasicConstraintsExtension(false,undefined,true),new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature|x509.KeyUsageFlags.keyEncipherment,true),new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),new x509.SubjectAlternativeNameExtension([{type:'dns',value:hostname}])]
  },webcrypto);
  return {key:await privatePem(keys.privateKey),cert:cert.toString('pem')};
}
export function verifyEndpointCertificate(pem,hostname,rootPem,hosts,at=Date.now()){
  try{if(!hosts.includes(hostname))return false;const leaf=new X509Certificate(pem),root=new X509Certificate(rootPem);
    const valid=c=>Date.parse(c.validFrom)<=at&&Date.parse(c.validTo)>at;
    return root.ca&&!leaf.ca&&valid(root)&&valid(leaf)&&root.verify(root.publicKey)&&!!leaf.checkHost(hostname,{wildcards:false})&&leaf.checkIssued(root)&&leaf.verify(root.publicKey);
  }catch{return false;}
}
