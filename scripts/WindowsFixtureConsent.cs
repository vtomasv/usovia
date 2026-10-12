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
    while(DateTime.UtcNow<end){
      try {
        var windows=AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition);
        foreach(AutomationElement window in windows){
          string title=window.Current.Name;
          if(!title.Contains("Security Warning")&&!title.Contains("Confirm Certificate Deletion"))continue;
          var process=Process.GetProcessById(window.Current.ProcessId);
          if(process.ProcessName!="powershell"&&process.ProcessName!="usovia-windows-browser-helper")continue;
          var elements=window.FindAll(TreeScope.Descendants,Condition.TrueCondition);
          string text=String.Join("\n",elements.Cast<AutomationElement>().Select(element=>element.Current.Name));
          bool owned=names.Any(name=>text.Contains(name));
          if(!owned)foreach(string path in Directory.GetFiles(directory,"*.cert-operation.json"))try{
            var operation=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(path));
            long age=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-Convert.ToInt64(operation["at"]);
            if(Convert.ToInt32(operation["pid"])==process.Id&&Convert.ToString(operation["action"])=="remove"&&age>=0&&age<30000&&certificates.Any(cert=>cert.Thumbprint==Convert.ToString(operation["thumbprint"])))owned=true;
          }catch{}
          if(!owned)continue;
          foreach(AutomationElement element in elements){
            if(element.Current.ControlType!=ControlType.Button||element.Current.Name.Replace("&","")!="Yes")continue;
            object pattern;if(element.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){((InvokePattern)pattern).Invoke();Console.WriteLine("Authorized known CI fixture certificate via Windows security dialog.");}
          }
        }
      }catch{}Thread.Sleep(200);
    }
    return 0;
  }
}
