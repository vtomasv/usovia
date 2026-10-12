$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path $compiler)) { throw 'Windows x64 .NET Framework compiler not available.' }
$project = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $project 'desktop/native/bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$source = (Resolve-Path (Join-Path $project 'desktop/native/WindowsBrowserRouting.cs')).Path
$output = Join-Path $bin 'usovia-windows-browser-helper.exe'
& $compiler @('/nologo','/codepage:65001','/optimize+','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll',"/out:$output",$source)
if ($LASTEXITCODE -ne 0) { throw 'Windows browser helper compilation failed.' }
Write-Host 'Windows current-user browser helper compiled.'
