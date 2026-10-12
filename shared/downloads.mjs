// Platform hints stay in the browser. They never activate telemetry or trigger a download.
export function detectPlatform({userAgent='',platform='',mobile=false,architecture='',bitness=''}={}) {
  const combined=userAgent+' '+platform;
  if(mobile||/Android|iPhone|iPad|iPod|Windows Phone/i.test(combined))return {os:'mobile',arch:'unknown'};
  if(/Windows|Win32|Win64|WinNT/i.test(combined))return {os:'windows',arch:/arm|aarch64/i.test(architecture+userAgent)?'arm64':bitness==='32'?'x86':'x64'};
  if(/macOS|Macintosh|MacIntel|MacPPC|Mac OS/i.test(combined))return {os:'macos',arch:/arm|aarch64/i.test(architecture)?'arm64':/x86/i.test(architecture)?'x64':'unknown'};
  if(/Linux|X11/i.test(combined))return {os:'linux',arch:'unknown'};
  return {os:'unknown',arch:'unknown'};
}
export function recommendedRelease(device,releases) {
  return releases.find(r=>r.os===device.os&&(r.arch===device.arch||device.arch==='unknown'))?.id||null;
}
export function configuredReleases(releases,macOverride) {
  return releases.map(release=>release.os==='macos'&&macOverride&&macOverride!==release.url?{...release,url:macOverride,sha256:null,signed:false,notarized:false,bytes:undefined,version:'personalizado'}:release);
}
