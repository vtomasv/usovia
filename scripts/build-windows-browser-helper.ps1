$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path $compiler)) { throw 'Windows x64 .NET Framework compiler not available.' }
New-Item -ItemType Directory -Force 'desktop/native/bin' | Out-Null
& $compiler /nologo /codepage:65001 /optimize+ /target:exe /platform:x64 /reference:System.Web.Extensions.dll /out:desktop/native/bin/usovia-windows-browser-helper.exe desktop/native/WindowsBrowserRouting.cs
if ($LASTEXITCODE -ne 0) { throw 'Windows browser helper compilation failed.' }
Write-Host 'Windows current-user browser helper compiled.'
