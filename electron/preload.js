// Navo — safe bridge between the UI and the Electron main process
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('navo', {
  platform: 'desktop',
  devTest: !!(process.env && process.env.NAVO_SHOT),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  parsePaths: paths => ipcRenderer.invoke('parse-paths', paths),
  launchPaths: () => ipcRenderer.invoke('launch-paths'),
  gpuInfo: () => ipcRenderer.invoke('gpu-info'),
  fetchImage: url => ipcRenderer.invoke('fetch-image', url),
  appVersion: () => ipcRenderer.invoke('app-version'),
  openRelease: url => ipcRenderer.invoke('open-release', url),
  miniMode: on => ipcRenderer.invoke('mini-mode', !!on),
  openSearch: (q, images) => ipcRenderer.invoke('open-search', q, !!images),
  httpJson: url => ipcRenderer.invoke('http-json', url),
  setPlaying: playing => ipcRenderer.send('play-state', !!playing),
  onMedia: cb => ipcRenderer.on('media', (_e, a) => cb(a)),
  showInFolder: p => ipcRenderer.invoke('show-in-folder', p),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  mediaUrl: (p, force) => 'navo://app/__media?p=' + encodeURIComponent(p) + (force ? '&t=1' : ''),
  onProgress: cb => ipcRenderer.on('scan-progress', (_e, d) => cb(d)),
  onOpenPaths: cb => ipcRenderer.on('open-paths', (_e, p) => cb(p)),
  watchSet: dirs => ipcRenderer.invoke('watch-set', dirs),
  watchScan: dirs => ipcRenderer.invoke('watch-scan', dirs),
  pickWatchFolder: () => ipcRenderer.invoke('pick-watch-folder'),
  onWatchFiles: cb => ipcRenderer.on('watch-files', (_e, p) => cb(p)),
});
