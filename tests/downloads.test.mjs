import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPlatform,recommendedRelease,configuredReleases} from '../shared/downloads.mjs';
import {desktopReleases} from '../shared/release.mjs';
import {handle} from '../server/http.mjs';
const releases=[{id:'mac',os:'macos',arch:'arm64'},{id:'win',os:'windows',arch:'x64'}];
test('OS recommendation separates Windows x64, Mac architecture, mobile and unsupported platforms',()=>{
  const fixtures=[
    [{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},'windows','x64','win'],
    [{platform:'Windows',architecture:'arm',bitness:'64'},'windows','arm64',null],
    [{platform:'Windows',architecture:'x86',bitness:'32'},'windows','x86',null],
    [{platform:'macOS',architecture:'arm'},'macos','arm64','mac'],
    [{platform:'macOS',architecture:'x86'},'macos','x64',null],
    [{userAgent:'Mozilla/5.0 Macintosh; Intel Mac OS X 10_15_7',platform:'MacIntel'},'macos','unknown','mac'],
    [{userAgent:'Mozilla/5.0 Linux; Android 15'},'mobile','unknown',null],
    [{platform:'MacIntel',mobile:true},'mobile','unknown',null],
    [{platform:'Linux x86_64'},'linux','unknown',null],
    [{},'unknown','unknown',null],
  ];
  for(const [input,os,arch,recommended] of fixtures){
    const device=detectPlatform(input);assert.deepEqual(device,{os,arch});assert.equal(recommendedRelease(device,releases),recommended);
  }
});
test('legacy Mac download override never changes a Windows artifact or publishes a wrong digest',()=>{
  const source=[{id:'mac',os:'macos',url:'https://example.invalid/mac.dmg',sha256:'mac-hash'}, {id:'win',os:'windows',url:'https://example.invalid/win.exe',sha256:'win-hash'}];
  const configured=configuredReleases(source,'https://example.invalid/custom.dmg');
  assert.equal(configured[0].url,'https://example.invalid/custom.dmg');assert.equal(configured[0].sha256,null);
  assert.deepEqual(configured[1],source[1]);assert.equal(source[0].sha256,'mac-hash');
});
test('public installer configuration retains Mac compatibility and exposes only public release metadata',async()=>{
  let response;
  await handle({url:'/api/config',headers:{}},{setHeader(){},end(data){response=JSON.parse(data);}});
  assert.equal(response.desktopReleases.length,desktopReleases.length);
  assert.equal(response.downloadUrl,response.desktopReleases.find(r=>r.os==='macos').url);
  for(const release of response.desktopReleases){assert.match(release.url,/^https:\/\//);assert.match(release.sha256,/^[a-f0-9]{64}$/);assert.equal('token' in release,false);assert.equal('privateKey' in release,false);}
});
