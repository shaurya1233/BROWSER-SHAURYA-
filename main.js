const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, Menu, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure high performance hardware acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow = null;
const tabs = new Map(); // tabId -> { view, isIncognito, url, title, favicon, isLoading, isMuted, isPinned }
let activeTabId = null;
let tabCounter = 1;

// Storage file paths
const DATA_DIR = path.join(app.getPath('userData'), 'ShauryaData');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'bookmarks.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Default Settings
let settings = {
  searchEngine: 'https://www.google.com/search?q=',
  homepage: 'shaurya://newtab',
  theme: 'dark',
  performanceMode: 'HIGH', // LOW, BALANCED, HIGH
  downloadsPath: app.getPath('downloads'),
  blockPopups: true
};

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// History & Bookmarks helpers
function loadJsonData(filePath, fallback) {
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return fallback; }
  }
  return fallback;
}

function saveJsonData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let historyData = loadJsonData(HISTORY_FILE, []);
let bookmarksData = loadJsonData(BOOKMARKS_FILE, [
  { id: '1', title: 'GitHub', url: 'https://github.com', folder: 'Bookmarks Bar' },
  { id: '2', title: 'YouTube', url: 'https://youtube.com', folder: 'Bookmarks Bar' },
  { id: '3', title: 'Wikipedia', url: 'https://wikipedia.org', folder: 'Bookmarks Bar' }
]);

let downloadsList = [];

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  // Handle window resizing to adjust active tab view bounds
  mainWindow.on('resize', () => {
    updateActiveViewBounds();
  });

  // Handle global downloads
  session.defaultSession.on('will-download', (event, item) => {
    const downloadId = Date.now().toString();
    const downloadItem = {
      id: downloadId,
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      path: item.getSavePath(),
      url: item.getURL(),
      startTime: Date.now()
    };
    downloadsList.unshift(downloadItem);
    sendToUI('download:updated', downloadItem);

    item.on('updated', (evt, state) => {
      if (state === 'interrupted') {
        downloadItem.state = 'interrupted';
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          downloadItem.state = 'paused';
        } else {
          downloadItem.state = 'progressing';
          downloadItem.receivedBytes = item.getReceivedBytes();
        }
      }
      sendToUI('download:updated', downloadItem);
    });

    item.once('done', (evt, state) => {
      downloadItem.state = state === 'completed' ? 'completed' : 'failed';
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.savePath = item.getSavePath();
      sendToUI('download:completed', downloadItem);
    });
  });

  // Create initial tab
  createNewTab(settings.homepage, false);
}

function updateActiveViewBounds() {
  if (!mainWindow || !activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.view) return;

  const bounds = mainWindow.getContentBounds();
  // Header is 88px high (36px custom window header + 52px navigation bar)
  const headerHeight = 88;
  
  // Set bounds for WebContentsView
  tab.view.setBounds({
    x: 0,
    y: headerHeight,
    width: bounds.width,
    height: Math.max(0, bounds.height - headerHeight)
  });
}

function createNewTab(targetUrl = 'shaurya://newtab', isIncognito = false) {
  const tabId = 'tab_' + (tabCounter++);
  
  // Create Partition Session for Incognito vs Normal
  const sessionPartition = isIncognito ? `incognito_${Date.now()}_${Math.random()}` : 'persist:default';
  const customSession = isIncognito ? session.fromPartition(sessionPartition) : session.defaultSession;

  // Modern Electron WebContentsView
  const view = new WebContentsView({
    webPreferences: {
      session: customSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: true
    }
  });

  const tabState = {
    id: tabId,
    view: view,
    isIncognito: isIncognito,
    url: targetUrl === 'shaurya://newtab' ? 'shaurya://newtab' : targetUrl,
    title: isIncognito ? 'Private Tab' : 'New Tab',
    favicon: '',
    isLoading: false,
    isMuted: false,
    isPinned: false
  };

  tabs.set(tabId, tabState);

  // Setup view event listeners
  const wc = view.webContents;

  wc.on('did-start-loading', () => {
    tabState.isLoading = true;
    sendToUI('tab:updated', serializeTab(tabState));
  });

  wc.on('did-stop-loading', () => {
    tabState.isLoading = false;
    tabState.url = wc.getURL();
    tabState.title = wc.getTitle() || tabState.url;
    sendToUI('tab:updated', serializeTab(tabState));
  });

  wc.on('page-title-updated', (evt, title) => {
    tabState.title = title;
    sendToUI('tab:updated', serializeTab(tabState));
  });

  wc.on('page-favicon-updated', (evt, favicons) => {
    if (favicons && favicons.length > 0) {
      tabState.favicon = favicons[0];
      sendToUI('tab:updated', serializeTab(tabState));
    }
  });

  wc.on('did-navigate', (evt, url) => {
    tabState.url = url;
    if (!isIncognito && url && !url.startsWith('shaurya://')) {
      addHistoryRecord(tabState.title, url);
    }
    sendToUI('tab:updated', serializeTab(tabState));
  });

  wc.on('did-navigate-in-page', (evt, url) => {
    tabState.url = url;
    sendToUI('tab:updated', serializeTab(tabState));
  });

  // Handle popup windows securely
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      createNewTab(url, isIncognito);
    }
    return { action: 'deny' };
  });

  // Load URL if not internal newtab
  if (targetUrl && targetUrl !== 'shaurya://newtab') {
    wc.loadURL(targetUrl).catch((err) => console.log('Navigation error:', err));
  }

  // Notify UI
  sendToUI('tab:created', serializeTab(tabState));

  // Switch to new tab automatically
  switchTab(tabId);

  return tabId;
}

function switchTab(tabId) {
  if (!tabs.has(tabId)) return;

  // Remove current view
  if (activeTabId && tabs.has(activeTabId)) {
    const currentTab = tabs.get(activeTabId);
    if (currentTab.view && mainWindow.contentView) {
      try {
        mainWindow.contentView.removeChildView(currentTab.view);
      } catch (e) {}
    }
  }

  activeTabId = tabId;
  const activeTab = tabs.get(tabId);

  if (activeTab.url !== 'shaurya://newtab' && activeTab.view) {
    mainWindow.contentView.addChildView(activeTab.view);
    updateActiveViewBounds();
  } else {
    // If newtab, we show renderer background NTP
    updateActiveViewBounds();
  }

  sendToUI('tab:switched', { id: tabId, tab: serializeTab(activeTab) });
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;

  const tabToClose = tabs.get(tabId);
  if (tabToClose.view && mainWindow.contentView) {
    try {
      mainWindow.contentView.removeChildView(tabToClose.view);
    } catch (e) {}
  }

  // Destroy WebContents
  if (tabToClose.view.webContents) {
    tabToClose.view.webContents.close();
  }

  tabs.delete(tabId);
  sendToUI('tab:closed', { id: tabId });

  // If closed tab was active, switch to another
  if (activeTabId === tabId) {
    const remainingKeys = Array.from(tabs.keys());
    if (remainingKeys.length > 0) {
      switchTab(remainingKeys[remainingKeys.length - 1]);
    } else {
      createNewTab('shaurya://newtab', false);
    }
  }
}

function serializeTab(tab) {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    isIncognito: tab.isIncognito,
    isLoading: tab.isLoading,
    isMuted: tab.isMuted,
    isPinned: tab.isPinned
  };
}

function addHistoryRecord(title, url) {
  const record = {
    id: Date.now().toString(),
    title: title || url,
    url: url,
    timestamp: new Date().toISOString()
  };
  historyData.unshift(record);
  if (historyData.length > 2000) historyData.pop();
  saveJsonData(HISTORY_FILE, historyData);
}

function sendToUI(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

// IPC Protocol Handlers
app.whenReady().then(() => {
  createMainWindow();

  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  ipcMain.handle('tab:create', (evt, { url, isIncognito }) => {
    return createNewTab(url || settings.homepage, !!isIncognito);
  });

  ipcMain.on('tab:switch', (evt, tabId) => switchTab(tabId));
  ipcMain.on('tab:close', (evt, tabId) => closeTab(tabId));

  ipcMain.on('tab:navigate', (evt, { id, url }) => {
    const tab = tabs.get(id);
    if (!tab) return;
    
    tab.url = url;
    if (url === 'shaurya://newtab') {
      if (mainWindow.contentView && tab.view) {
        try { mainWindow.contentView.removeChildView(tab.view); } catch (e) {}
      }
      sendToUI('tab:updated', serializeTab(tab));
      return;
    }

    if (tab.view) {
      if (!mainWindow.contentView.children.includes(tab.view)) {
        mainWindow.contentView.addChildView(tab.view);
        updateActiveViewBounds();
      }
      let formattedUrl = url;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('shaurya://')) {
        if (url.includes('.') && !url.includes(' ')) {
          formattedUrl = 'https://' + url;
        } else {
          formattedUrl = settings.searchEngine + encodeURIComponent(url);
        }
      }
      tab.view.webContents.loadURL(formattedUrl).catch(e => console.error(e));
    }
  });

  ipcMain.on('tab:go-back', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view && tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  });

  ipcMain.on('tab:go-forward', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view && tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  });

  ipcMain.on('tab:reload', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view) tab.view.webContents.reload();
  });

  ipcMain.on('tab:stop', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view) tab.view.webContents.stop();
  });

  ipcMain.on('tab:toggle-mute', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view) {
      tab.isMuted = !tab.isMuted;
      tab.view.webContents.setAudioMuted(tab.isMuted);
      sendToUI('tab:updated', serializeTab(tab));
    }
  });

  ipcMain.on('tab:toggle-pin', (evt, id) => {
    const tab = tabs.get(id);
    if (tab) {
      tab.isPinned = !tab.isPinned;
      sendToUI('tab:updated', serializeTab(tab));
    }
  });

  ipcMain.on('tab:toggle-devtools', (evt, id) => {
    const tab = tabs.get(id);
    if (tab && tab.view) {
      if (tab.view.webContents.isDevToolsOpened()) {
        tab.view.webContents.closeDevTools();
      } else {
        tab.view.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  // History / Bookmarks / Settings / Downloads Handlers
  ipcMain.handle('history:get', () => historyData);
  ipcMain.handle('history:clear', () => {
    historyData = [];
    saveJsonData(HISTORY_FILE, historyData);
    return true;
  });
  ipcMain.handle('history:delete-item', (evt, id) => {
    historyData = historyData.filter(h => h.id !== id);
    saveJsonData(HISTORY_FILE, historyData);
    return historyData;
  });

  ipcMain.handle('bookmarks:get', () => bookmarksData);
  ipcMain.handle('bookmarks:save', (evt, newBookmarks) => {
    bookmarksData = newBookmarks;
    saveJsonData(BOOKMARKS_FILE, bookmarksData);
    return bookmarksData;
  });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', (evt, newSettings) => {
    saveSettings(newSettings);
    return settings;
  });

  ipcMain.handle('downloads:get', () => downloadsList);
  ipcMain.on('downloads:open', (evt, itemPath) => {
    if (fs.existsSync(itemPath)) shell.openPath(itemPath);
  });
  ipcMain.on('downloads:show-in-folder', (evt, itemPath) => {
    if (fs.existsSync(itemPath)) shell.showItemInFolder(itemPath);
  });

  // Performance Preset handler
  ipcMain.on('performance:set-mode', (evt, mode) => {
    settings.performanceMode = mode;
    saveSettings({ performanceMode: mode });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
