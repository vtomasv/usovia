import Foundation
import SystemConfiguration
import Security
import CryptoKit
import Darwin

// Privileged, narrowly scoped session helper. Never reads prompts, tokens or CA keys.
// No Terminal. Authorization Services asks for local administrator approval.
// Transitional session launcher; migrate to signed SMAppService before managed distribution.
let fm = FileManager.default
let base = "/Library/Application Support/Usovia/BrowserSessions"
let keychain = "/Library/Keychains/System.keychain"
let pacEnable = kSCPropNetProxiesProxyAutoConfigEnable as String
let pacURL = kSCPropNetProxiesProxyAutoConfigURLString as String
let enableKeys = [pacEnable, kSCPropNetProxiesProxyAutoDiscoveryEnable as String,
  kSCPropNetProxiesHTTPEnable as String, kSCPropNetProxiesHTTPSEnable as String,
  kSCPropNetProxiesSOCKSEnable as String, "FTPEnable", "GopherEnable", "RTSPEnable"]
var interrupted = false
struct Failure: Error { let message: String; init(_ message: String) { self.message = message } }
func require(_ condition: Bool, _ message: String) throws { if !condition { throw Failure(message) } }
func same(_ a: [String:Any], _ b: [String:Any]) -> Bool { NSDictionary(dictionary:a).isEqual(to:b) }
func conflicts(_ config: [String:Any]) -> Bool { enableKeys.contains { (config[$0] as? NSNumber)?.boolValue == true } }
func installed(_ config: [String:Any], _ url: String) -> [String:Any] { var out=config;out[pacEnable]=1;out[pacURL]=url;return out }
// Preserve unrelated edits made while Usovia is running. Never replace somebody else's PAC.
func restored(_ current: [String:Any], original: [String:Any], url: String) -> [String:Any]? {
  guard let currentURL=current[pacURL] as? String else { return nil }
  let base=url.components(separatedBy:"?")[0]
  let managed=currentURL==base || (currentURL.hasPrefix(base+"?revision=") && currentURL.dropFirst((base+"?revision=").count).range(of:"^[0-9]+$",options:.regularExpression) != nil)
  guard managed else { return nil }
  var out=current
  for key in [pacEnable,pacURL] { if let v=original[key] { out[key]=v } else { out.removeValue(forKey:key) } }
  return out
}
func json(_ object: Any) throws -> Data { try JSONSerialization.data(withJSONObject:object,options:[.sortedKeys]) }
func emit(_ object: Any) throws { FileHandle.standardOutput.write(try json(object)); print("") }
func privateFile(_ path: String, uid: uid_t, afterOpen: (() throws -> Void)? = nil) throws -> Data {
  var st=stat();try require(lstat(path,&st)==0 && (st.st_mode & S_IFMT)==S_IFREG && st.st_uid==uid && st.st_nlink==1 && st.st_size<65536,"Archivo de autorización no válido.")
  let fd=open(path,O_RDONLY|O_NOFOLLOW);try require(fd>=0,"No se pudo abrir autorización.");defer{close(fd)}
  try afterOpen?()
  var after=stat();// Atomic lease renewal can legitimately change the inode between lstat/open.
  try require(fstat(fd,&after)==0 && (after.st_mode & S_IFMT)==S_IFREG && after.st_uid==uid && after.st_nlink<=1 && after.st_size<65536,"La autorización cambió al abrirla.")
  let data=try FileHandle(fileDescriptor:fd,closeOnDealloc:false).read(upToCount:65536) ?? Data()
  try require(data.count<65536,"Autorización demasiado grande.");return data
}
func atomic(_ path: String, data: Data, mode: mode_t) throws {
  // All writes are under root-owned directories; never write through user paths.
  let temporary=path+".tmp";let fd=open(temporary,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW,mode)
  try require(fd>=0,"No se pudo guardar la restauración.");let handle=FileHandle(fileDescriptor:fd,closeOnDealloc:true);try handle.write(contentsOf:data);try handle.synchronize();try handle.close()
  try require(chmod(temporary,mode)==0 && rename(temporary,path)==0,"No se pudo confirmar la restauración.")
}
func rootDirectory(_ path: String) throws {
  var cursor=""
  for component in path.split(separator:"/") {
    cursor += "/"+component
    if mkdir(cursor,0o755) != 0 && errno != EEXIST { throw Failure("No se pudo crear el directorio de restauración.") }
    var st=stat();try require(lstat(cursor,&st)==0 && (st.st_mode & S_IFMT)==S_IFDIR && st.st_uid==0 && st.st_mode & 0o022==0,"Directorio de restauración no protegido.")
  }
}
func command(_ args: [String], progress: (() throws -> Void)? = nil) throws {
  let task=Process();task.executableURL=URL(fileURLWithPath:"/usr/bin/security");task.arguments=args
  task.standardOutput=FileHandle.nullDevice;task.standardError=FileHandle.nullDevice;try task.run()
  var lastPulse=Date.distantPast
  while task.isRunning {if Date().timeIntervalSince(lastPulse)>1 {try progress?();lastPulse=Date()};Thread.sleep(forTimeInterval:0.1)}
  task.waitUntilExit()
  try require(task.terminationStatus==0,"El llavero rechazó la operación TLS.")
}
func preferences() throws -> SCPreferences {
  guard let p=SCPreferencesCreate(nil,"Usovia browser routing" as CFString,nil) else { throw Failure("No se pudo leer la configuración de red.") };return p
}
func services(_ p: SCPreferences) -> [SCNetworkService] {
  guard let set=SCNetworkSetCopyCurrent(p),let all=SCNetworkSetCopyServices(set) as? [SCNetworkService] else { return [] };return all.filter{SCNetworkServiceGetEnabled($0)}
}
func config(_ proto: SCNetworkProtocol) -> [String:Any] { SCNetworkProtocolGetConfiguration(proto) as? [String:Any] ?? [:] }
func commit(_ p: SCPreferences) throws { try require(SCPreferencesCommitChanges(p),"No se pudo guardar el proxy del sistema.");try require(SCPreferencesApplyChanges(p),"No se pudo aplicar el proxy del sistema.") }
func encoded(_ value: [String:Any]) throws -> String { try PropertyListSerialization.data(fromPropertyList:value,format:.binary,options:0).base64EncodedString() }
func decoded(_ value: String) throws -> [String:Any] { guard let data=Data(base64Encoded:value),let result=try PropertyListSerialization.propertyList(from:data,options:[],format:nil) as? [String:Any] else { throw Failure("Restauración no válida.") };return result }
func inspect() throws {
  let p=try preferences();let rows=services(p).map { service -> [String:Any] in
    let proto=SCNetworkServiceCopyProtocol(service,kSCNetworkProtocolTypeProxies)
    return ["id":SCNetworkServiceGetServiceID(service)! as String,"name":SCNetworkServiceGetName(service) as String? ?? "Red","supported":proto != nil,"conflict":proto.map{conflicts(config($0))} ?? false]
  }
  var pending=[[String:Any]]()
  for id in (try? fm.contentsOfDirectory(atPath:base)) ?? [] where UUID(uuidString:id) != nil {
    if let data=try? Data(contentsOf:URL(fileURLWithPath:base+"/"+id+"/status.json")),let status=try? JSONSerialization.jsonObject(with:data) as? [String:Any],status["uid"] as? UInt32==getuid(),status["needsRecovery"] as? Bool==true,let time=status["at"] as? Double,Date().timeIntervalSince1970*1000-time>8000 || status["phase"] as? String=="error" {pending.append(["id":id])}
  }
  try emit(["platform":"darwin","services":rows,"pendingRecovery":pending])
}
var authorizedOwner:uid_t? = nil
func adminRights(_ authorization: AuthorizationRef, interactive: Bool) throws {
  let result = "system.privilege.admin".withCString { name -> OSStatus in
    var item=AuthorizationItem(name:name,valueLength:0,value:nil,flags:0)
    return withUnsafeMutablePointer(to:&item) { pointer in
      var rights=AuthorizationRights(count:1,items:pointer)
      return AuthorizationCopyRights(authorization,&rights,nil,interactive ? [.interactionAllowed,.extendRights,.preAuthorize] : [],nil)
    }
  }
  try require(result==errAuthorizationSuccess,result==errAuthorizationCanceled ? "Autorización cancelada. No se habilitaron los navegadores." : "macOS no autorizó la integración de navegadores.")
}
func authorize(_ command: String, manifest: String? = nil) throws {
  try require(getuid()>0 && geteuid()==getuid(),"Autoriza desde tu sesión de usuario.")
  if let manifest=manifest {_ = try privateFile(manifest,uid:getuid())}
  var authorization:AuthorizationRef?
  try require(AuthorizationCreate(nil,nil,[],&authorization)==errAuthorizationSuccess,"No se pudo solicitar autorización a macOS.")
  guard let authorization=authorization else {throw Failure("No se pudo solicitar autorización.")}
  defer{AuthorizationFree(authorization,[])}
  try adminRights(authorization,interactive:true)
  let arguments=[command]+(manifest.map{[$0]} ?? [])
  let duplicated=arguments.map{strdup($0)}
  defer{duplicated.forEach{free($0)}}
  var pointers=duplicated+[nil]
  let executable=URL(fileURLWithPath:CommandLine.arguments[0]).resolvingSymlinksInPath().path
  let result=executable.withCString { path in
    pointers.withUnsafeMutableBufferPointer { arguments in
      UsoviaExecuteAuthorized(authorization,path,arguments.baseAddress!)
    }
  }
  try require(result==errAuthorizationSuccess,"macOS no pudo iniciar el ayudante autorizado.")
  try emit(["authorization":"started"])
}
func verifyPrivilegedAuthorization() throws {
  try require(geteuid()==0 && getuid()>0,"No hay autorización gráfica de administrador.")
  var authorization:AuthorizationRef?
  try require(UsoviaPrivilegedReference(&authorization)==errAuthorizationSuccess,"No se pudo verificar la autorización de macOS.")
  guard let authorization=authorization else {throw Failure("Autorización ausente.")}
  defer{AuthorizationFree(authorization,[])}
  try adminRights(authorization,interactive:false)
  authorizedOwner=getuid()
  try require(setuid(0)==0,"No se pudo iniciar la sesión privilegiada.")
}
final class RoutingSession {
  let id:String, uid:uid_t, pid:pid_t, url:String, lease:String, dir:String, cert:Data, sha1:String
  var rows=[[String:Any]](), active=false, trust=false, revision=1, appliedRevision=0, skipped=[[String:Any]]()
  init(_ path:String) throws {
    guard geteuid()==0,let owner=authorizedOwner ?? ProcessInfo.processInfo.environment["SUDO_UID"].flatMap(UInt32.init),owner>0 else { throw Failure("Autoriza los navegadores desde Usovia.") }
    guard let m=try JSONSerialization.jsonObject(with:privateFile(path,uid:owner)) as? [String:Any],m["version"] as? Int == 1,
      let id=m["id"] as? String,UUID(uuidString:id) != nil,m["uid"] as? UInt32 == owner,
      let pid=m["pid"] as? Int,pid>1,let lease=m["leasePath"] as? String,lease.hasPrefix("/"),
      let url=m["pacUrl"] as? String,let u=URL(string:url),u.scheme=="http",u.host=="127.0.0.1",u.user==nil,u.password==nil,u.query?.range(of:"^revision=[0-9]+$",options:.regularExpression) != nil,u.fragment==nil,u.port.map({$0>1024&&$0<65536})==true,u.path=="/\(id)/proxy.pac",
      let created=m["createdAt"] as? Double,abs(Date().timeIntervalSince1970*1000-created)<600000,
      let certificate=m["certificate"] as? String,let der=Data(base64Encoded:certificate),der.count<8192,
      let hash=m["sha256"] as? String,hash==SHA256.hash(data:der).map({String(format:"%02x",$0)}).joined(),
      let certificateObject=SecCertificateCreateWithData(nil,der as CFData) else { throw Failure("El permiso o la CA no son válidos. Regenera el activador en Usovia.") }
    var cn:CFString?;try require(SecCertificateCopyCommonName(certificateObject,&cn)==errSecSuccess && (cn as String? ?? "").hasPrefix("Usovia Endpoint "),"La CA no pertenece a Usovia.")
    self.id=id;self.uid=owner;self.pid=pid_t(pid);self.lease=lease;self.url=url;self.cert=der;self.dir=base+"/"+id
    self.sha1=Insecure.SHA1.hash(data:der).map({String(format:"%02x",$0)}).joined().uppercased()
    try rootDirectory(dir)
    try require(!fm.fileExists(atPath:dir+"/journal.json"),"Esta sesión ya existe. Regenera el activador.")
    let pem="-----BEGIN CERTIFICATE-----\n"+der.base64EncodedString(options:.lineLength64Characters)+"\n-----END CERTIFICATE-----\n"
    try atomic(dir+"/root.pem",data:Data(pem.utf8),mode:0o600);try journal();try status("awaiting",nil)
  }
  func journal() throws { try atomic(dir+"/journal.json",data:json(["id":id,"uid":uid,"pacUrl":url,"pid":pid,"helperPid":getpid(),"leasePath":lease,"sha1":sha1,"rows":rows,"trust":trust,"complete":!active && !trust && rows.isEmpty]),mode:0o600) }
  func status(_ phase:String,_ error:String?) throws { var result:[String:Any]=["at":Date().timeIntervalSince1970*1000,"uid":uid,"needsRecovery":trust || active || !rows.isEmpty,"active":active,"effective":effective(),"phase":phase,"skippedServices":skipped,"services":active ? rows.compactMap{$0["name"] as? String}:[]];if let error=error{result["error"]=error};try atomic(dir+"/status.json",data:json(result),mode:0o644) }
  func effective() -> Bool {
    guard active,let proxies=SCDynamicStoreCopyProxies(nil) as? [String:Any],(proxies[pacEnable] as? NSNumber)?.boolValue==true else{return false}
    return restored(proxies,original:[:],url:url) != nil
  }
  func allowed() -> Bool? {
    guard kill(pid,0)==0,let data=try? privateFile(lease,uid:uid),let s=try? JSONSerialization.jsonObject(with:data) as? [String:Any],s["closed"] as? Bool != true,s["id"] as? String==id,s["pid"] as? Int==Int(pid),let time=s["at"] as? Double,abs(Date().timeIntervalSince1970*1000-time)<12000,let desired=s["active"] as? Bool else{return nil};if let next=s["revision"] as? Int,next>=revision,next<=9007199254740991{revision=next};return desired
  }
  func activate() throws {
    let p=try preferences();try require(SCPreferencesLock(p,true),"No se pudo bloquear la configuración de red.")
    var locked=true;defer{if locked {SCPreferencesUnlock(p)}}
    let candidates=services(p);try require(!candidates.isEmpty,"No hay servicios de red configurados.")
    var planned=[[String:Any]]();skipped=[]
    for service in candidates {
      guard let proto=SCNetworkServiceCopyProtocol(service,kSCNetworkProtocolTypeProxies) else{skipped.append(["name":SCNetworkServiceGetName(service) as String? ?? "Red","reason":"unsupported"]);continue}
      let previous=config(proto);if conflicts(previous){skipped.append(["name":SCNetworkServiceGetName(service) as String? ?? "Red","reason":"existing_proxy"]);continue}
      planned.append(["id":SCNetworkServiceGetServiceID(service)! as String,"name":SCNetworkServiceGetName(service) as String? ?? "Red","original":try encoded(previous),"hadConfiguration":SCNetworkProtocolGetConfiguration(proto) != nil])
    }
    try require(!planned.isEmpty,"Los servicios no admiten proxy automático.")
    rows=planned;trust=true;try journal() // Durable intent before any trust or network mutation.
    SCPreferencesUnlock(p);locked=false
    try status("installing_root",nil)
    try command(["add-trusted-cert","-d","-r","trustRoot","-p","ssl","-k",keychain,dir+"/root.pem"],progress:{try self.status("installing_root",nil)})
    try require(allowed()==true && !interrupted,"La activación se canceló antes de configurar la red.")
    SCPreferencesSynchronize(p);try require(SCPreferencesLock(p,true),"No se pudo bloquear la configuración de red.");locked=true
    for row in rows {
      guard let id=row["id"] as? String,let old=row["original"] as? String else{throw Failure("Servicio de red no válido.")}
      if let service=SCNetworkServiceCopy(p,id as CFString),let proto=SCNetworkServiceCopyProtocol(service,kSCNetworkProtocolTypeProxies){
        let original=try decoded(old);try require(same(config(proto),original),"La red cambió durante la autorización; no se sobrescribe.")
        try require(SCNetworkProtocolSetConfiguration(proto,installed(original,currentURL) as CFDictionary),"No se pudo preparar PAC.")
      }
    }
    try commit(p);appliedRevision=revision;active=true;try journal();try status("active",nil)
  }
  var currentURL:String {url.components(separatedBy:"?")[0]+"?revision=\(revision)"}
  func refresh() throws {
    let p=try preferences();try require(SCPreferencesLock(p,true),"No se pudo actualizar la política de red.");defer{SCPreferencesUnlock(p)}
    for row in rows {
      guard let id=row["id"] as? String,let service=SCNetworkServiceCopy(p,id as CFString),let proto=SCNetworkServiceCopyProtocol(service,kSCNetworkProtocolTypeProxies) else{continue}
      let current=config(proto);try require((current[pacEnable] as? NSNumber)?.boolValue==true && restored(current,original:[:],url:url) != nil,"El proxy se modificó fuera de Usovia.")
      try require(SCNetworkProtocolSetConfiguration(proto,installed(current,currentURL) as CFDictionary),"No se pudo actualizar el PAC.")
    }
    try commit(p);appliedRevision=revision
  }
  func restore() throws {
    active=false;try status("restoring",nil)
    try recoverDirectory(dir,progress:{try self.status("removing_root","macOS puede requerir autorización local para retirar la confianza TLS.")});rows=[];trust=false;try journal();try status("paused",nil)
  }
  func run() throws {
    // The app lease controls this background session; no console is needed.
    var failed=false, failure:String?=nil
    while !interrupted {
      guard let desired=allowed() else{break}
      if desired && !active && !failed {do{try activate()}catch{try? restore();failed=true;failure=(error as? Failure)?.message ?? "No se pudo activar."}}
      if !desired {if active || trust || !rows.isEmpty {try restore()};failed=false;failure=nil}
      if active && appliedRevision != revision {do{try refresh()}catch{try? restore();failed=true;failure=(error as? Failure)?.message ?? "No se pudo actualizar la política."}}
      try status(failed ? "error":active ? "active":"paused",failure)
      Thread.sleep(forTimeInterval:1)
    }
    try restore();try status("stopped",nil);print("Configuración anterior restaurada y CA retirada.")
  }
}
func recoverDirectory(_ dir:String, progress: (() throws -> Void)? = nil) throws {
  let data=try Data(contentsOf:URL(fileURLWithPath:dir+"/journal.json"));guard let j=try JSONSerialization.jsonObject(with:data) as? [String:Any],let url=j["pacUrl"] as? String,let rows=j["rows"] as? [[String:Any]],let sha=j["sha1"] as? String,sha.range(of:"^[A-F0-9]{40}$",options:.regularExpression) != nil else{throw Failure("Diario de recuperación inválido.")}
  let p=try preferences();try require(SCPreferencesLock(p,true),"No se pudo bloquear la restauración.")
  var locked=true;defer{if locked {SCPreferencesUnlock(p)}}
  var changed=false
  for row in rows {
    guard let id=row["id"] as? String,let old=row["original"] as? String,let service=SCNetworkServiceCopy(p,id as CFString),let proto=SCNetworkServiceCopyProtocol(service,kSCNetworkProtocolTypeProxies) else{continue}
    let current=config(proto),original=try decoded(old)
    if let next=restored(current,original:original,url:url) {let emptyOriginal=row["hadConfiguration"] as? Bool == false && same(next,original);try require(SCNetworkProtocolSetConfiguration(proto,emptyOriginal ? nil:next as CFDictionary),"No se pudo restaurar el PAC.");changed=true}
  }
  if changed {try commit(p)}
  SCPreferencesUnlock(p);locked=false
  if j["trust"] as? Bool==true {
    let pem=try String(contentsOfFile:dir+"/root.pem",encoding:.utf8)
    let encoded=pem.components(separatedBy:.newlines).filter{!$0.hasPrefix("-----")}.joined()
    guard let der=Data(base64Encoded:encoded),let certificate=SecCertificateCreateWithData(nil,der as CFData) else{throw Failure("Certificado de recuperación no válido.")}
    var trustSettings:CFArray?
    var trustStatus=SecTrustSettingsCopyTrustSettings(certificate,.admin,&trustSettings)
    if trustStatus==errSecSuccess {try command(["remove-trusted-cert","-d",dir+"/root.pem"],progress:progress)}
    else {try require(trustStatus==errSecNoTrustSettings || trustStatus==errSecItemNotFound,"No se pudo verificar la confianza TLS.")}
    try? command(["delete-certificate","-Z",sha,keychain],progress:progress)
    trustStatus=SecTrustSettingsCopyTrustSettings(certificate,.admin,&trustSettings)
    try require(trustStatus==errSecNoTrustSettings || trustStatus==errSecItemNotFound,"La confianza TLS no se pudo retirar. Ejecuta recuperación con permiso de administrador.")
    // Confirm deletion rather than silently report cleanup when the keychain denied it.
    let task=Process();task.executableURL=URL(fileURLWithPath:"/usr/bin/security");task.arguments=["find-certificate","-a","-Z",keychain];let pipe=Pipe();task.standardOutput=pipe;task.standardError=FileHandle.nullDevice;try task.run();let result=pipe.fileHandleForReading.readDataToEndOfFile();task.waitUntilExit()
    try require(!(String(data:result,encoding:.utf8) ?? "").contains(sha),"La CA no se pudo retirar. Ejecuta recuperación con permiso de administrador.")
  }
  var completed=j;completed["rows"]=[];completed["trust"]=false;completed["complete"]=true;try atomic(dir+"/journal.json",data:json(completed),mode:0o600)
}
func recover() throws {
  try require(geteuid()==0,"Recuperación requiere autorización local.");guard fm.fileExists(atPath:base) else{return};try rootDirectory(base)
  for id in try fm.contentsOfDirectory(atPath:base) where UUID(uuidString:id) != nil {
    let dir=base+"/"+id;try rootDirectory(dir)
    if let data=try? Data(contentsOf:URL(fileURLWithPath:dir+"/journal.json")),let j=try? JSONSerialization.jsonObject(with:data) as? [String:Any],j["complete"] as? Bool != true {
      // Do not disturb another user's session or a live helper/app lease.
      guard let owner=authorizedOwner ?? ProcessInfo.processInfo.environment["SUDO_UID"].flatMap(UInt32.init),Int(owner)==j["uid"] as? Int else {continue}
      if let helperPid=j["helperPid"] as? Int,kill(pid_t(helperPid),0)==0,let pid=j["pid"] as? Int,kill(pid_t(pid),0)==0,let uid=j["uid"] as? UInt32,let path=j["leasePath"] as? String,let leaseData=try? privateFile(path,uid:uid),let lease=try? JSONSerialization.jsonObject(with:leaseData) as? [String:Any],let time=lease["at"] as? Double,abs(Date().timeIntervalSince1970*1000-time)<12000 {continue}
      try recoverDirectory(dir,progress:{try atomic(dir+"/status.json",data:json(["at":Date().timeIntervalSince1970*1000,"uid":j["uid"] ?? 0,"needsRecovery":true,"active":false,"effective":false,"phase":"removing_root","error":"macOS puede requerir autorización local para retirar la confianza TLS.","services":[]]),mode:0o644)})
      try atomic(dir+"/status.json",data:json(["at":Date().timeIntervalSince1970*1000,"uid":j["uid"] ?? 0,"needsRecovery":false,"active":false,"effective":false,"phase":"recovered","services":[]]),mode:0o644)
    }
  }
  print("Sesiones pendientes restauradas. No ejecutar mientras otra sesión Usovia esté activa.")
}
func selfTest() throws {
  let prior:[String:Any]=["HTTPEnable":0,"HTTPProxy":"company.example","HTTPPort":8080,"ExceptionsList":["*.local"],pacEnable:0,pacURL:"https://company.example/disabled.pac"]
  let url="http://127.0.0.1:11441/session/proxy.pac?revision=1",next=installed(prior,url)
  try require(same(restored(next,original:prior,url:url)!,prior),"Restauración exacta falló.")
  var modified=next;modified["HTTPProxy"]="changed.example"
  try require(restored(modified,original:prior,url:url)?["HTTPProxy"] as? String=="changed.example","Se perdieron cambios ajenos.")
  modified[pacURL]="https://company.example/new.pac";try require(restored(modified,original:prior,url:url)==nil,"Se sobrescribió PAC ajeno.")
  try require(!conflicts(prior)&&conflicts(["SOCKSEnable":1])&&conflicts([pacEnable:1]),"Detección de conflicto falló.")
  let nilOriginal=restored(installed([:],url),original:[:],url:url)!;try require(nilOriginal.isEmpty,"Restauración de diccionario vacío falló.")
  try require(same(try decoded(encoded(prior)),prior),"El diario perdió valores.")
  // Deterministic regression: an atomic lease replacement can unlink an open FD.
  let testDir=NSTemporaryDirectory()+"usovia-lease-"+UUID().uuidString;try fm.createDirectory(atPath:testDir,withIntermediateDirectories:true)
  defer{try? fm.removeItem(atPath:testDir)}
  let lease=testDir+"/lease.json",replacement=testDir+"/replacement.json",oldData=Data("old lease".utf8),newData=Data("new lease".utf8)
  try oldData.write(to:URL(fileURLWithPath:lease));try newData.write(to:URL(fileURLWithPath:replacement))
  let opened=try privateFile(lease,uid:getuid(),afterOpen:{try require(rename(replacement,lease)==0,"No se pudo renovar lease de prueba.")})
  try require(opened==oldData && privateFile(lease,uid:getuid())==newData,"La renovación atómica invalidó un lease abierto válido.")
  try emit(["selfTest":"passed","cases":7])
}
signal(SIGINT){_ in interrupted=true};signal(SIGTERM){_ in interrupted=true};signal(SIGHUP){_ in interrupted=true}
do {
  let args=CommandLine.arguments
  switch args.count>1 ? args[1]:"" {
  case "inspect":try inspect()
  case "self-test":try selfTest()
  case "authorize":try require(args.count==3,"Falta autorización local.");try authorize("run-gui",manifest:args[2])
  case "authorize-recovery":try authorize("recover-gui")
  case "recover-gui":try verifyPrivilegedAuthorization();try recover()
  case "run-gui":try verifyPrivilegedAuthorization();try require(args.count==3,"Falta permiso local.");let s=try RoutingSession(args[2]);do{try s.run()}catch{try? s.restore();throw error}
  case "recover":try recover()
  case "run":try require(args.count==3,"Falta manifest local.");let s=try RoutingSession(args[2]);do{try s.run()}catch{try? s.restore();throw error}
  default:throw Failure("Uso: inspect | self-test | run MANIFEST | recover")
  }
}catch{fputs(((error as? Failure)?.message ?? "El ayudante no pudo completar la operación.")+"\n",stderr);exit(1)}
