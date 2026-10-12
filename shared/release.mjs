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
    "os": "windows",
    "runtime": "Ollama 0.40.3 · CPU",
    "signed": false,
    "platform": "Windows 10/11 · 64 bits (Intel/AMD)",
    "sha256": "18fb66abd02c12949574c33aa31ff2185db5fe30f3e9b8cc64d6640a32866c9e",
    "testedBrowsers": [
      "Chrome",
      "Edge",
      "Firefox"
    ],
    "url": "https://github.com/vtomasv/usovia/releases/download/desktop-v1.3.0-windows-x64/Usovia-1.3.0-windows-x64-setup.exe",
    "systemBrowser": true,
    "arch": "x64",
    "id": "windows-x64",
    "version": "1.3.0",
    "bytes": 129686025
  }
];
// Legacy clients expect a single Mac release.
export const desktopRelease=desktopReleases.find(release=>release.id==='macos-arm64');
