// UI authorization for freshly generated fixture certificates in the disposable CI VM ONLY.
// Never accepts browser TLS interstitials, certificates from other sources, or credentials.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
class WindowsFixtureConsent {
  public static int Main(string[] args){
    if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("USOVIA_BROWSER_FIXTURE")!="1"||args.Length!=1)return 1;
    string directory=Path.GetFullPath(args[0]);
    var certificates=new[]{"upstream.cer","usovia.cer"}.Select(file=>new X509Certificate2(Path.Combine(directory,file))).ToArray();
    var names=certificates.Select(cert=>cert.GetNameInfo(X509NameType.SimpleName,false)).ToArray();
    DateTime end=DateTime.UtcNow.AddMinutes(12);
    var observed=new System.Collections.Generic.HashSet<string>();
    while(DateTime.UtcNow<end){
      try {
        var windows=AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition);
        foreach(AutomationElement window in windows){
          string title=window.Current.Name;
          var process=Process.GetProcessById(window.Current.ProcessId);
          if(process.ProcessName!="powershell"&&process.ProcessName!="usovia-windows-browser-helper")continue;
          if(window.Current.ClassName!="#32770")continue;
          var elements=window.FindAll(TreeScope.Descendants,Condition.TrueCondition);
          string text=String.Join("\n",elements.Cast<AutomationElement>().Select(element=>element.Current.Name));
          string buttons=String.Join(",",elements.Cast<AutomationElement>().Where(element=>element.Current.ControlType==ControlType.Button).Select(element=>element.Current.Name));
          string description=title+" | "+process.ProcessName+" | "+buttons;
          if(observed.Add(description))Console.WriteLine("Known fixture process dialog: "+description);
          bool installation=names.Any(name=>text.Contains(name))&&title.Contains("Security Warning"),removal=false;
          bool owned=installation;
          if(!owned)foreach(string path in Directory.GetFiles(directory,"*.cert-operation.json"))try{
            var operation=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(path));
            long age=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-Convert.ToInt64(operation["at"]);
            if(Convert.ToInt32(operation["pid"])==process.Id&&Convert.ToString(operation["action"])=="remove"&&age>=0&&age<30000&&certificates.Any(cert=>cert.Thumbprint==Convert.ToString(operation["thumbprint"])))removal=true;
          }catch{}
          owned=owned||removal;
          if(!owned)continue;
          foreach(AutomationElement element in elements){
            string button=element.Current.Name.Replace("&","");
            if(element.Current.ControlType!=ControlType.Button||button!="Yes"&&!(removal&&button=="OK"))continue;
            object pattern;if(element.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){((InvokePattern)pattern).Invoke();Console.WriteLine("Authorized known CI fixture certificate via Windows security dialog.");}
          }
        }
      }catch{}Thread.Sleep(200);
    }
    return 0;
  }
}
