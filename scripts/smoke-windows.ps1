# Execute the installed NSIS application, using a temporary local profile with capture disabled.
$ErrorActionPreference = 'Stop'
$version = (Get-Content 'desktop/package.json' | ConvertFrom-Json).version
$installer = (Resolve-Path "desktop/release/Usovia-$version-windows-x64-setup.exe").Path
$installDir = Join-Path $env:RUNNER_TEMP 'Usovia-installed'
$env:USOVIA_DATA_DIR = Join-Path $env:RUNNER_TEMP 'Usovia-smoke-profile'
$env:USOVIA_SMOKE_OUTPUT = Join-Path $env:RUNNER_TEMP 'Usovia-smoke-result.json'
$env:USOVIA_HUB_URL = 'https://example.invalid'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
# NSIS /D must be the final argument. This per-user installation does not require elevation.
$installation = Start-Process -FilePath $installer -ArgumentList ('/S /D=' + $installDir) -PassThru -Wait
if ($installation.ExitCode -ne 0) { throw "NSIS install failed: $($installation.ExitCode)" }
$executable = Join-Path $installDir 'Usovia.exe'
if (-not (Test-Path $executable)) { throw "Installed executable not found at the requested NSIS directory: $installDir" }
$application = Start-Process -FilePath $executable -ArgumentList '--packaging-smoke' -PassThru
if (-not $application.WaitForExit(480000)) {
  Stop-Process -Id $application.Id -Force
  throw 'Installed application smoke check timed out.'
}
if (-not (Test-Path $env:USOVIA_SMOKE_OUTPUT)) { throw 'Installed application produced no verification report.' }
$result = Get-Content $env:USOVIA_SMOKE_OUTPUT | ConvertFrom-Json
if (-not $result.ok) { throw "Installed application failed: $($result.error)" }
if (Get-NetTCPConnection -LocalPort 11438 -State Listen -ErrorAction SilentlyContinue) { throw 'Embedded runtime was left running after exit.' }
Copy-Item $env:USOVIA_SMOKE_OUTPUT 'desktop/release/windows-verification.json'
$uninstaller = Join-Path $installDir 'Uninstall Usovia.exe'
if (-not (Test-Path $uninstaller)) { throw 'Uninstaller not registered.' }
$uninstall = Start-Process $uninstaller -ArgumentList '/S' -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed.' }
Write-Host "Native verification succeeded: installed app, tray, DPAPI, real local inference, clean exit and uninstaller."
