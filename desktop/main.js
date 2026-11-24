'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { startServer, shutdown } = require('../server');

const ROOT = path.join(__dirname, '..');
let mainWindow;
let origin;
let closing = false;
let serverClosed = false;

async function pickFolder({ initialPath }) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a project folder',
    defaultPath: initialPath,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
}

function showAuthorizationResult(result) {
  if (!mainWindow || closing) return;
  const url = URL.parse(mainWindow.webContents.getURL());
  if (url?.origin !== origin) return;
  url.searchParams.set('chatgpt', result);
  void mainWindow.loadURL(url.href).catch(console.error);
}

async function startDesktopServer(profile) {
  const portFile = path.join(profile, 'loopback-port');
  const savedPort = await fs.readFile(portFile, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  // Chromium stores the theme and recent projects per origin.
  const number = Number(savedPort);
  const port = Number.isInteger(number) && number >= 1024 && number <= 65535 ? number : 0;
  const desktopOptions = {
    dataDir: path.join(profile, 'settings'),
    defaultPath: app.isPackaged ? app.getPath('documents') : ROOT,
    pickFolder,
    openAuthorization: url => shell.openExternal(url),
    onAuthorizationComplete: showAuthorizationResult,
  };
  origin = await startServer({ port, desktopOptions }).catch(error => {
    if (port && ['EADDRINUSE', 'EACCES'].includes(error.code)) return startServer({ port: 0, desktopOptions });
    throw error;
  });
  await fs.writeFile(portFile, new URL(origin).port);
}

function openExternalLink(url) {
  if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
    void shell.openExternal(url.href).catch(console.error);
  }
}

function isAppUrl(url) {
  return url?.protocol === 'http:' && url.origin === origin;
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'PulsarWiki',
    icon: path.join(ROOT, 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on('closed', () => { mainWindow = null; });
  const contents = window.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', event => {
    const url = URL.parse(event.url);
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalLink(url);
  });
  contents.on('will-redirect', event => {
    if (event.isMainFrame && !isAppUrl(URL.parse(event.url))) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url: target }) => {
    const url = URL.parse(target);
    if (isAppUrl(url)) void window.loadURL(url.href).catch(console.error);
    else openExternalLink(url);
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(origin);
}

app.setName('PulsarWiki');
app.setAppUserModelId('org.pulsarwiki.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || closing) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!origin || serverClosed) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    shutdown().catch(console.error).finally(() => {
      serverClosed = true;
      app.quit();
    });
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const profile = app.getPath('userData');
    await fs.mkdir(profile, { recursive: true });
    await startDesktopServer(profile);
    await createWindow();
  }).catch(error => {
    dialog.showErrorBox('PulsarWiki could not start', error.message);
    app.quit();
  });
}
