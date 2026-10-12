// Public release metadata; never contains credentials.
export const desktopReleases=[
  {
    "id": "macos-arm64",
    "os": "macos",
    "arch": "arm64",
    "url": "https://x9yieeaxtrt3jpcz.public.blob.vercel-storage.com/releases/1.1.0/f25f6904b77a/Usovia-1.1.0-arm64.dmg",
    "sha256": "f25f6904b77a3c94db834f2a04e1ff32e6fd77332bfcd6037650968a1de80c69",
    "version": "1.1.0",
    "platform": "macOS Apple Silicon",
    "signed": false,
    "systemBrowser": true,
    "bytes": 305177337
  },
  {
    "version": "1.2.0",
    "runtime": "Ollama 0.40.3 · CPU",
    "platform": "Windows 10/11 · 64 bits (Intel/AMD)",
    "url": "https://github.com/vtomasv/usovia/releases/download/desktop-v1.2.0-windows-x64/Usovia-1.2.0-windows-x64-setup.exe",
    "signed": false,
    "bytes": 129674275,
    "sha256": "c728671ecd83305a37c15fff765817cf3dd9e78dfa4af98fc9c11a011fadb7d0",
    "id": "windows-x64",
    "os": "windows",
    "systemBrowser": false,
    "arch": "x64"
  }
];
// Legacy clients expect a single Mac release.
export const desktopRelease=desktopReleases.find(release=>release.id==='macos-arm64');
