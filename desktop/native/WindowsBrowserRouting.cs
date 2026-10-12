// Current-user trust and WinINet only. No administrator, private CA key, shell or passwords.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal class WindowsBrowserRouting {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  const int PerConnection = 75, Refresh = 37, SettingsChanged = 39;
  [StructLayout(LayoutKind.Explicit)] struct Value { [FieldOffset(0)] public uint number; [FieldOffset(0)] public IntPtr text; [FieldOffset(0)] public long time; }
  [StructLayout(LayoutKind.Sequential)] struct Option { public int kind; public Value value; }
  [StructLayout(LayoutKind.Sequential)] struct OptionList { public int size; public IntPtr connection; public int count; public int error; public IntPtr options; }
  [DllImport("wininet.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="InternetQueryOptionW")] static extern bool Query(IntPtr handle,int option,ref OptionList list,ref int length);
  [DllImport("wininet.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="InternetSetOptionW")] static extern bool Set(IntPtr handle,int option,ref OptionList list,int length);
  [DllImport("wininet.dll", SetLastError=true, EntryPoint="InternetSetOptionW")] static extern bool Notify(IntPtr handle,int option,IntPtr buffer,int length);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr pointer);
  [DllImport("winhttp.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool WinHttpDetectAutoProxyConfigUrl(uint flags,out IntPtr url);
  static long Now(){return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();}
  static Dictionary<string,object> Read(string path){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path));}
  static string Text(Dictionary<string,object> data,string key){object value;return data.TryGetValue(key,out value)?Convert.ToString(value):"";}
  static long Number(Dictionary<string,object> data,string key){object value;return data.TryGetValue(key,out value)?Convert.ToInt64(value):0;}
  static bool Flag(Dictionary<string,object> data,string key){object value;return data.TryGetValue(key,out value)&&Convert.ToBoolean(value);}
  static void Write(string path,object data){string temp=path+".tmp";File.WriteAllText(temp,Json.Serialize(data));if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}
  static string Sha(X509Certificate2 cert){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(cert.RawData)).Replace("-","").ToLowerInvariant();}
  public class ProxyState { public uint flags;public string pac;public string server;public string bypass; }
  static ProxyState GetProxy(){
    int size=Marshal.SizeOf(typeof(Option)),length=Marshal.SizeOf(typeof(OptionList));
    IntPtr pointer=Marshal.AllocHGlobal(size*4);int[] kinds={10,2,3,4};
    try {
      for(int i=0;i<4;i++)Marshal.StructureToPtr(new Option{kind=kinds[i]},IntPtr.Add(pointer,i*size),false);
      var list=new OptionList{size=length,count=4,options=pointer};
      if(!Query(IntPtr.Zero,PerConnection,ref list,ref length))throw new Exception("No se pudieron consultar los ajustes WinINet: "+Marshal.GetLastWin32Error());
      var result=new ProxyState();
      for(int i=0;i<4;i++){
        var item=(Option)Marshal.PtrToStructure(IntPtr.Add(pointer,i*size),typeof(Option));
        if(i==0)result.flags=item.value.number;
        else {string text=item.value.text==IntPtr.Zero?"":Marshal.PtrToStringUni(item.value.text);if(i==1)result.server=text;else if(i==2)result.bypass=text;else result.pac=text;if(item.value.text!=IntPtr.Zero)GlobalFree(item.value.text);}
      }
      return result;
    } finally {Marshal.FreeHGlobal(pointer);}
  }
  static void SetProxy(ProxyState state){
    int size=Marshal.SizeOf(typeof(Option)),length=Marshal.SizeOf(typeof(OptionList));
    IntPtr pointer=Marshal.AllocHGlobal(size*4);var strings=new List<IntPtr>();
    try {
      var options=new[]{new Option{kind=1,value=new Value{number=state.flags}},new Option{kind=2},new Option{kind=3},new Option{kind=4}};
      string[] values={state.server,state.bypass,state.pac};
      for(int i=1;i<4;i++){var text=Marshal.StringToHGlobalUni(values[i-1]??"");strings.Add(text);options[i].value=new Value{text=text};}
      for(int i=0;i<4;i++)Marshal.StructureToPtr(options[i],IntPtr.Add(pointer,i*size),false);
      var list=new OptionList{size=length,count=4,options=pointer};
      if(!Set(IntPtr.Zero,PerConnection,ref list,length))throw new Exception("No se pudieron aplicar los ajustes WinINet: "+Marshal.GetLastWin32Error());
      Notify(IntPtr.Zero,SettingsChanged,IntPtr.Zero,0);Notify(IntPtr.Zero,Refresh,IntPtr.Zero,0);
    } finally {foreach(var text in strings)Marshal.FreeHGlobal(text);Marshal.FreeHGlobal(pointer);}
  }
  static string PolicyConflict(){
    string[] paths={@"Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings",@"Software\Policies\Google\Chrome",@"Software\Policies\Microsoft\Edge",@"Software\Policies\Mozilla\Firefox\Proxy"};
    foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})foreach(string path in paths)using(var key=hive.OpenSubKey(path)){
      if(key==null)continue;
      object scope=key.GetValue("ProxySettingsPerUser");if(scope!=null&&Convert.ToInt32(scope)==0)return "La empresa administra el proxy a nivel de equipo. Revisa la integración con TI.";
      foreach(string name in new[]{"ProxyMode","Mode"}){string mode=Convert.ToString(key.GetValue(name));if(mode!=""&&mode!="system")return "Hay una política de proxy de navegador. Usovia conserva su configuración; consulta a TI.";}
      if(key.GetValue("ProxySettings")!=null||key.GetValue("ProxyServer")!=null||key.GetValue("ProxyPacUrl")!=null)return "Hay ajustes de proxy administrados. Usovia no los sustituye.";
    }
    foreach(var network in NetworkInterface.GetAllNetworkInterfaces())if(network.OperationalStatus==OperationalStatus.Up&&network.NetworkInterfaceType==NetworkInterfaceType.Ppp)return "Hay una conexión VPN/PPP activa; su proxy requiere configuración de TI.";
    return "";
  }
  static string Conflict(ProxyState state,bool detect){
    string policy=PolicyConflict();if(policy!="")return policy;
    if((state.flags&2)!=0||!String.IsNullOrEmpty(state.pac))return "Hay otro proxy o PAC configurado. Usovia no lo sustituye.";
    if(detect&&(state.flags&8)!=0){
      IntPtr url;bool found=WinHttpDetectAutoProxyConfigUrl(3,out url);int error=Marshal.GetLastWin32Error();if(url!=IntPtr.Zero)GlobalFree(url);
      if(found)return "La red publica un proxy WPAD. Conservamos esa configuración; consulta a TI.";
      if(error!=12180)return "No se pudo descartar un proxy automático de la red; consulta a TI.";
    }
    return "";
  }
  static X509Certificate2 Certificate(Dictionary<string,object> manifest){
    var cert=new X509Certificate2(Convert.FromBase64String(Text(manifest,"certificate")));
    bool ca=false;foreach(var extension in cert.Extensions)if(extension is X509BasicConstraintsExtension)ca=((X509BasicConstraintsExtension)extension).CertificateAuthority;
    if(!ca||cert.HasPrivateKey||Sha(cert)!=Text(manifest,"sha256")||cert.NotAfter.ToUniversalTime()<DateTime.UtcNow||cert.Subject!=cert.Issuer||!cert.Subject.Contains("Usovia Endpoint"))throw new Exception("La CA pública no es válida para Usovia.");
    return cert;
  }
  static bool Trusted(X509Certificate2 cert){using(var store=new X509Store(StoreName.Root,StoreLocation.CurrentUser)){store.Open(OpenFlags.ReadOnly);foreach(var candidate in store.Certificates)if(Sha(candidate)==Sha(cert))return true;}return false;}
  static void AddRoot(X509Certificate2 cert){using(var store=new X509Store(StoreName.Root,StoreLocation.CurrentUser)){store.Open(OpenFlags.ReadWrite);store.Add(cert);}}
  static void RemoveRoot(X509Certificate2 cert,string directory){using(var store=new X509Store(StoreName.Root,StoreLocation.CurrentUser)){store.Open(OpenFlags.ReadWrite);foreach(var candidate in store.Certificates)if(Sha(candidate)==Sha(cert)){
    Write(Path.Combine(directory,"native-"+Process.GetCurrentProcess().Id+".cert-operation.json"),new{pid=Process.GetCurrentProcess().Id,thumbprint=cert.Thumbprint,action="remove",at=Now()});store.Remove(candidate);
  }}}
  static ProxyState Original(Dictionary<string,object> journal){return Json.ConvertToType<ProxyState>(journal["original"]);}
  static bool Same(ProxyState a,ProxyState b){return a.flags==b.flags&&a.pac==b.pac&&a.server==b.server&&a.bypass==b.bypass;}
  static bool Alive(int pid,long started){try{return Process.GetProcessById(pid).StartTime.ToUniversalTime().Ticks==started;}catch{return false;}}
  static void Restore(Dictionary<string,object> journal,string path){
    var cert=Certificate(journal);var original=Original(journal);var current=GetProxy();
    var expected=new ProxyState{flags=5,pac=Text(journal,"ownedPac"),server=original.server,bypass=original.bypass};
    var previous=new ProxyState{flags=5,pac=Text(journal,"priorOwnedPac"),server=original.server,bypass=original.bypass};
    if(Same(current,expected)||previous.pac!=""&&Same(current,previous))SetProxy(original); // Never overwrite foreign edits; also fence a crash during revision replacement.
    if(Flag(journal,"addedRoot"))RemoveRoot(cert,Path.GetDirectoryName(path));
    journal["addedRoot"]=false;journal["complete"]=true;Write(path,journal);
  }
  static void Recover(string directory){
    int count=0;if(Directory.Exists(directory))foreach(string path in Directory.GetFiles(directory,"*.journal.json")){
      var journal=Read(path);if(Flag(journal,"complete"))continue;
      if(Alive((int)Number(journal,"helperPid"),Number(journal,"helperStarted")))continue;
      Restore(journal,path);count++;
    }
    Console.WriteLine(Json.Serialize(new{recovered=count}));
  }
  static void Run(string manifestPath){
    var manifest=Read(manifestPath);string id=Text(manifest,"id"),directory=Path.GetDirectoryName(manifestPath);
    Guid guid;if(!Guid.TryParseExact(id,"D",out guid)||Path.GetFileName(manifestPath)!=id+".manifest.json")throw new Exception("Manifiesto de sesión inválido.");
    string leasePath=Path.Combine(directory,id+".lease.json"),statusPath=Path.Combine(directory,id+".status.json"),journalPath=Path.Combine(directory,id+".journal.json");
    if(Path.GetFullPath(Text(manifest,"leasePath"))!=Path.GetFullPath(leasePath))throw new Exception("Ruta de lease inválida.");
    Uri pac=new Uri(Text(manifest,"pacUrl"));if(pac.Scheme!="http"||pac.Host!="127.0.0.1"||pac.Port!=11441||pac.AbsolutePath!="/"+id+"/proxy.pac"||pac.UserInfo!="")throw new Exception("PAC local inválido.");
    int parent=(int)Number(manifest,"pid");var process=Process.GetProcessById(parent);long parentStarted=process.StartTime.ToUniversalTime().Ticks;
    var cert=Certificate(manifest);var original=GetProxy();string conflict=Conflict(original,true);if(conflict!="")throw new Exception(conflict);
    var self=Process.GetCurrentProcess();var journal=new Dictionary<string,object>(manifest);journal["original"]=original;journal["addedRoot"]=false;journal["complete"]=false;journal["helperPid"]=self.Id;journal["helperStarted"]=self.StartTime.ToUniversalTime().Ticks;journal["ownedPac"]="";Write(journalPath,journal);
    bool active=false;int changed=0;long revision=0;
    NetworkChange.NetworkAddressChanged+=delegate {Interlocked.Exchange(ref changed,1);};
    try {
      for(;;){
        var lease=Read(leasePath);
        if(Text(lease,"id")!=id||Number(lease,"pid")!=parent||Now()-Number(lease,"at")>7000||Now()-Number(lease,"at")< -2000||Flag(lease,"closed")||!Alive(parent,parentStarted))break;
        bool desired=Flag(lease,"active");long nextRevision=Number(lease,"revision");
        if(desired&&!active){
          conflict=Conflict(GetProxy(),true);if(conflict!="")throw new Exception(conflict);
          journal["addedRoot"]=!Trusted(cert);journal["complete"]=false;Write(journalPath,journal);if(Flag(journal,"addedRoot"))AddRoot(cert);
          revision=nextRevision;journal["priorOwnedPac"]=Text(journal,"ownedPac");journal["ownedPac"]=pac.GetLeftPart(UriPartial.Path)+"?revision="+revision;Write(journalPath,journal);
          SetProxy(new ProxyState{flags=5,pac=Text(journal,"ownedPac"),server=original.server,bypass=original.bypass});active=true;
        } else if(!desired&&active){Restore(journal,journalPath);active=false;}
        if(active){
          if(Interlocked.Exchange(ref changed,0)==1){conflict=Conflict(original,true);if(conflict!="")throw new Exception(conflict);}
          var expected=new ProxyState{flags=5,pac=Text(journal,"ownedPac"),server=original.server,bypass=original.bypass};
          if(!Same(GetProxy(),expected)||PolicyConflict()!="")throw new Exception("La configuración de red cambió fuera de Usovia. Se detuvo la integración.");
          if(nextRevision!=revision){revision=nextRevision;journal["priorOwnedPac"]=Text(journal,"ownedPac");journal["ownedPac"]=pac.GetLeftPart(UriPartial.Path)+"?revision="+revision;Write(journalPath,journal);expected.pac=Text(journal,"ownedPac");SetProxy(expected);}
        }
        Write(statusPath,new{at=Now(),phase=active?"active":"paused",active=active,effective=active&&Trusted(cert),services=new[]{"Windows · proxy del usuario"}});
        Thread.Sleep(1000);
      }
      Restore(journal,journalPath);Write(statusPath,new{at=Now(),phase="stopped",active=false,effective=false});
    } catch(Exception error){
      try{Restore(journal,journalPath);}catch{}Write(statusPath,new{at=Now(),phase="error",active=false,effective=false,error=error.Message});
    }
  }
  public static int Main(string[] args){try{
    if(args.Length==1&&args[0]=="inspect"){
      var state=GetProxy();string conflict=Conflict(state,true);Console.WriteLine(Json.Serialize(new{services=new[]{new{name="Windows · proxy del usuario",supported=true,conflict=conflict!="",reason=conflict}},proxy=state}));return 0;
    }
    if(args.Length==2&&args[0]=="recover"){Recover(Path.GetFullPath(args[1]));return 0;}
    if(args.Length==2&&args[0]=="authorize"){
      string path=Path.GetFullPath(args[1]);if(path.Contains("\"")||path.Contains("\r")||path.Contains("\n"))throw new Exception("Ruta inválida.");
      Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"run \""+path+"\""){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});Console.WriteLine("{\"authorization\":\"started\"}");return 0;
    }
    if(args.Length==2&&args[0]=="run"){using(var mutex=new Mutex(false,"Local\\UsoviaWindowsBrowserRouting")){if(!mutex.WaitOne(5000))throw new Exception("Ya hay una integración de Usovia en curso.");try{Run(Path.GetFullPath(args[1]));}finally{mutex.ReleaseMutex();}}return 0;}
    throw new Exception("Acción de integración no admitida.");
  }catch(Exception error){
    if(args.Length==2&&args[0]=="run")try{var manifest=Read(args[1]);Guid id;if(Guid.TryParseExact(Text(manifest,"id"),"D",out id))Write(Path.Combine(Path.GetDirectoryName(args[1]),id+".status.json"),new{at=Now(),phase="error",active=false,effective=false,error=error.Message});}catch{}
    Console.Error.WriteLine(error.Message);return 1;}}
}
