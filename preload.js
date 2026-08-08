const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shauryaAPI', {
  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Navigation & Tabs
  createTab: (url, isIncognito) => ipcRenderer.invoke('tab:create', { url, isIncognito }),
  switchTab: (id) => ipcRenderer.send('tab:switch', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  navigate: (id, url) => ipcRenderer.send('tab:navigate', { id, url }),
  goBack: (id) => ipcRenderer.send('tab:go-back', id),
  goForward: (id) => ipcRenderer.send('tab:go-forward', id),
  reload: (id) => ipcRenderer.send('tab:reload', id),
  stop: (id) => ipcRenderer.send('tab:stop', id),
  toggleMute: (id) => ipcRenderer.send('tab:toggle-mute', id),
  togglePin: (id) => ipcRenderer.send('tab:toggle-pin', id),
  toggleDevTools: (id) => ipcRenderer.send('tab:toggle-devtools', id),

  // Storage & State
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  deleteHistoryItem: (id) => ipcRenderer.invoke('history:delete-item', id),

  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  saveBookmarks: (bookmarks) => ipcRenderer.invoke('bookmarks:save', bookmarks),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Downloads
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  openDownloadItem: (path) => ipcRenderer.send('downloads:open', path),
  showDownloadInFolder: (path) => ipcRenderer.send('downloads:show-in-folder', path),

  // Performance Presets
  setPerformanceMode: (mode) => ipcRenderer.send('performance:set-mode', mode),

  // Push Event Listeners
  onTabUpdated: (callback) => ipcRenderer.on('tab:updated', (e, data) => callback(data)),
  onTabCreated: (callback) => ipcRenderer.on('tab:created', (e, data) => callback(data)),
  onTabClosed: (callback) => ipcRenderer.on('tab:closed', (e, data) => callback(data)),
  onTabSwitched: (callback) => ipcRenderer.on('tab:switched', (e, data) => callback(data)),
  onDownloadUpdated: (callback) => ipcRenderer.on('download:updated', (e, data) => callback(data)),
  onDownloadCompleted: (callback) => ipcRenderer.on('download:completed', (e, data) => callback(data))
});
