param([ValidateSet('Setup','Inspect','Foreign','Restore','Teardown')][string]$Action,[string]$Directory,[string]$Helper)
$ErrorActionPreference = 'Stop'
# This fixture changes trust and hosts ONLY in the disposable GitHub Windows VM.
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:USOVIA_BROWSER_FIXTURE -ne '1') { throw 'Requires the explicitly enabled isolated Windows CI fixture.' }
$hostsPath = Join-Path $env:WINDIR 'System32/drivers/etc/hosts'
$statePath = Join-Path $Directory 'fixture-state.json'
$assembly = [Reflection.Assembly]::LoadFile((Resolve-Path $Helper).Path)
if ($Action -eq 'Setup') { Write-Host 'Fixture phase: native assembly loaded.' }
$native = $assembly.GetType('WindowsBrowserRouting')
$binding = [Reflection.BindingFlags]'NonPublic,Static'
$get = $native.GetMethod('GetProxy', $binding)
$set = $native.GetMethod('SetProxy', $binding)
$type = $native.GetNestedType('ProxyState', [Reflection.BindingFlags]'Public')
function Apply-Proxy($data) {
  $value = [Activator]::CreateInstance($type)
  $value.flags = [uint32]$data.flags; $value.pac = [string]$data.pac; $value.server = [string]$data.server; $value.bypass = [string]$data.bypass
  $set.Invoke($null, @($value)) | Out-Null
}
function Has-Root([string]$file) {
  if (-not (Test-Path $file)) { return $false }
  $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($file)
  $store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
  try { $store.Open('ReadOnly'); return @($store.Certificates | Where-Object Thumbprint -eq $cert.Thumbprint).Count -gt 0 } finally { $store.Close() }
}
if ($Action -eq 'Setup') {
  $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $Directory 'upstream.cer'))
  $original = [IO.File]::ReadAllBytes($hostsPath)
  $marker = "# Usovia isolated fixture $($cert.Thumbprint)"
  $block = "`r`n$marker`r`n127.0.0.1 gemini.google.com api.openai.com api.anthropic.com generativelanguage.googleapis.com nonllm.usovia-fixture.invalid`r`n# End $marker`r`n"
  $state = @{ originalHosts = [Convert]::ToBase64String($original); marker = $marker; block = $block; proxy = $get.Invoke($null,@()); upstreamRootAdded = -not (Has-Root (Join-Path $Directory 'upstream.cer')) }
  $state | ConvertTo-Json -Depth 6 | Set-Content $statePath -Encoding utf8
  Write-Host 'Fixture phase: original settings journaled.'
  if ($state.upstreamRootAdded) { $store=[Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser'); try {$store.Open('ReadWrite');$store.Add($cert)} finally {$store.Close()} }
  Write-Host 'Fixture phase: controlled upstream CA installed.'
  [IO.File]::WriteAllText($hostsPath, [Text.Encoding]::UTF8.GetString($original) + $block, [Text.UTF8Encoding]::new($false))
  ipconfig /flushdns | Out-Null
} elseif ($Action -eq 'Inspect') {
  @{ proxy = $get.Invoke($null,@()); usoviaRoot = Has-Root (Join-Path $Directory 'usovia.cer'); upstreamRoot = Has-Root (Join-Path $Directory 'upstream.cer') } | ConvertTo-Json -Depth 6 -Compress
} elseif ($Action -eq 'Foreign') {
  $current=$get.Invoke($null,@());$current.flags=5;$current.pac='http://127.0.0.1:1/foreign-fixture.pac';Apply-Proxy $current
} elseif ($Action -eq 'Restore') {
  $state=Get-Content $statePath | ConvertFrom-Json;Apply-Proxy $state.proxy
} else {
  if (-not (Test-Path $statePath)) { exit 0 }
  $state=Get-Content $statePath | ConvertFrom-Json;Apply-Proxy $state.proxy
  $current=[IO.File]::ReadAllText($hostsPath);$original=[Convert]::FromBase64String($state.originalHosts)
  if ($current -eq ([Text.Encoding]::UTF8.GetString($original) + $state.block)) { [IO.File]::WriteAllBytes($hostsPath,$original) }
  else { [IO.File]::WriteAllText($hostsPath,$current.Replace($state.block,''),[Text.UTF8Encoding]::new($false)) }
  if ($state.upstreamRootAdded) { $cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $Directory 'upstream.cer'));$store=[Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser');try {$store.Open('ReadWrite');foreach($candidate in $store.Certificates){if($candidate.Thumbprint -eq $cert.Thumbprint){$store.Remove($candidate)}}} finally {$store.Close()} }
  ipconfig /flushdns | Out-Null
}
