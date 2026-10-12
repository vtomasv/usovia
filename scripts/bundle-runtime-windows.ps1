# Run on Windows x64. The public upstream archive is pinned and verified before extraction.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
  throw 'Build this runtime on Windows x64 with PowerShell 7.'
}
$version = '0.40.3'
$sha256 = 'e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5'
$url = "https://github.com/ollama/ollama/releases/download/v$version/ollama-windows-amd64.zip"
$target = Join-Path $PWD 'desktop/runtime-windows'
$archive = Join-Path $env:RUNNER_TEMP 'usovia-ollama-windows.zip'
if (-not $env:RUNNER_TEMP) { throw 'Set RUNNER_TEMP to a temporary build directory.' }
Invoke-WebRequest -Uri $url -OutFile $archive
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'Ollama archive SHA-256 mismatch.' }
New-Item -ItemType Directory -Force $target | Out-Null
# CPU distribution: preserve shared DLLs, the runner and all CPU variants; omit optional GPU backends.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (-not $entry.Name) { continue }
    if ($name -match '(^|/)(cuda[^/]*|rocm[^/]*|vulkan[^/]*|mlx[^/]*)(/|$)' -and $name -notmatch '(?i)license|notice') { continue }
    $destination = [IO.Path]::GetFullPath((Join-Path $target $name))
    if (-not $destination.StartsWith([IO.Path]::GetFullPath($target) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid archive path.' }
    New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($destination)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
  }
} finally { $zip.Dispose() }
if (-not (Test-Path "$target/ollama.exe") -or -not (Test-Path "$target/lib/ollama/llama-server.exe")) { throw 'Incomplete Windows runtime.' }
Copy-Item 'licenses/Ollama-LICENSE' "$target/OLLAMA_LICENSE"
$files = @(Get-ChildItem $target -Recurse -File | Where-Object Name -ne 'runtime-manifest.json' | ForEach-Object {
  @{ path = [IO.Path]::GetRelativePath($target, $_.FullName).Replace('\','/'); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
})
@{ source = $url; archiveSha256 = $sha256; platform = 'win32-x64'; version = $version; acceleration = 'cpu'; files = $files } | ConvertTo-Json -Depth 5 | Set-Content "$target/runtime-manifest.json" -Encoding utf8
Write-Host "Verified Ollama $version; CPU payload: $($files.Count) files."
