// Public release metadata; never contains credentials.
export const desktopReleases=[
  {
    "id": "macos-arm64",
    "os": "macos",
    "arch": "arm64",
    "url": "https://github.com/vtomasv/usovia/releases/download/desktop-v1.3.0-macos-arm64/Usovia-1.3.0-arm64.dmg",
    "sha256": "c571d3406fcbf1fa8c7f443955375918616efc3d471e08b06200a5df105d563e",
    "version": "1.3.0",
    "platform": "macOS 13+ · Apple Silicon",
    "signed": true,
    "notarized": true,
    "systemBrowser": true,
    "bytes": 304417211,
    "runtime": "Ollama 0.40.0"
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
