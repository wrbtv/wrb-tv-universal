const { app, BrowserWindow, dialog, session, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');


const PORT = 3050;


function getWindowsMachineGuid() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function formatDeviceId(hex) {
  return hex.match(/.{2}/g).join(':').toUpperCase();
}

function getDeviceId() {
  const machineGuid = getWindowsMachineGuid();
  if (machineGuid) {
    const digest = crypto
      .createHash('sha256')
      .update(`WRB-TV-DEVICE-v1:${machineGuid}`)
      .digest('hex')
      .slice(0, 12);
    return formatDeviceId(digest);
  }

  const fallbackPath = path.join(app.getPath('userData'), 'device-id.txt');
  try {
    if (fs.existsSync(fallbackPath)) {
      const existing = fs.readFileSync(fallbackPath, 'utf8').trim();
      if (/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(existing)) return existing;
    }
    const generated = formatDeviceId(crypto.randomBytes(6).toString('hex'));
    fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
    fs.writeFileSync(fallbackPath, generated, 'utf8');
    return generated;
  } catch {
    return formatDeviceId(crypto.randomBytes(6).toString('hex'));
  }
}
let mainWindow = null;
let localServer = null;
let shuttingDown = false;


let updateDownloadInProgress = false;
let updateAvailableVersion = null;
let updateCheckInProgress = false;
let updateCheckTimer = null;
let windowedBounds = null;

function configureAutoUpdater() {
  if (!app.isPackaged) return;

  // O download é disparado explicitamente no evento update-available.
  // Isso torna o comportamento previsível e mantém a instalação automática no fechamento.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    updateCheckInProgress = true;
    console.log(`[WRB-TV] Verificando atualizações. Versão instalada: ${app.getVersion()}`);
  });

  autoUpdater.on('update-available', async info => {
    updateCheckInProgress = false;
    updateAvailableVersion = info.version;
    console.log(`[WRB-TV] Atualização disponível: ${info.version}. Iniciando download automático.`);
    await downloadAndInstallUpdate();
  });

  autoUpdater.on('update-not-available', info => {
    updateCheckInProgress = false;
    console.log(`[WRB-TV] Nenhuma atualização disponível. Versão atual: ${info?.version || app.getVersion()}`);
  });

  autoUpdater.on('download-progress', progress => {
    console.log(`[WRB-TV] Baixando atualização: ${Math.round(progress.percent)}% - ${Math.round(progress.bytesPerSecond / 1024)} KB/s`);
  });

  autoUpdater.on('update-downloaded', info => {
    updateDownloadInProgress = false;
    updateCheckInProgress = false;
    updateAvailableVersion = info.version;
    console.log(`[WRB-TV] Atualização ${info.version} baixada. Será instalada automaticamente ao fechar o aplicativo.`);
  });

  autoUpdater.on('error', error => {
    updateDownloadInProgress = false;
    updateCheckInProgress = false;
    console.error('[WRB-TV] Erro no atualizador:', error);
  });
}

async function checkForUpdates() {
  if (!app.isPackaged || updateDownloadInProgress || updateCheckInProgress) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateCheckInProgress = false;
    console.error('[WRB-TV] Não foi possível verificar atualizações:', error);
  }
}

async function downloadAndInstallUpdate() {
  if (updateDownloadInProgress) return;
  updateDownloadInProgress = true;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateDownloadInProgress = false;
    updateCheckInProgress = false;
    console.error('[WRB-TV] Falha ao baixar atualização:', error);
  }
}

function scheduleAutomaticUpdateChecks() {
  if (!app.isPackaged) return;

  // Verificação inicial após o player abrir.
  setTimeout(() => checkForUpdates(), 3000);

  // Repetição periódica para o caso de o programa estar aberto quando
  // uma nova versão for publicada.
  updateCheckTimer = setInterval(() => checkForUpdates(), 15 * 60 * 1000);

  // Verifica novamente quando o usuário volta para a janela.
  app.on('browser-window-focus', () => {
    setTimeout(() => checkForUpdates(), 1500);
  });
}

ipcMain.handle('wrb:get-device-id', () => getDeviceId());

ipcMain.handle('wrb:set-fullscreen', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (enabled) {
    if (!mainWindow.isFullScreen()) {
      windowedBounds = mainWindow.getBounds();
      mainWindow.setFullScreen(true);
    }
  } else {
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && windowedBounds) {
          mainWindow.setBounds(windowedBounds, false);
        }
      }, 150);
    }
  }
  return mainWindow.isFullScreen();
});

function appRoot() {
  return app.getAppPath();
}

function serverPath() {
  return path.join(appRoot(), 'server.mjs');
}

function requestLocal(pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: PORT, path: pathname, timeout: 1200 },
      res => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await requestLocal('/')) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function startLocalServer() {
  if (localServer) return localServer;

  const serverModulePath = path.join(appRoot(), 'server.mjs');
  const serverModule = await import(require('url').pathToFileURL(serverModulePath).href);

  localServer = await serverModule.startServer(PORT);
  return localServer;
}

async function ensureLocalServer() {
  if (await requestLocal('/')) {
    return true;
  }

  try {
    await startLocalServer();
  } catch (error) {
    console.error('[WRB-TV] Falha ao iniciar servidor interno:', error);
    return false;
  }

  return await waitForServer();
}

function stopLocalServer() {
  if (!localServer) return;

  try {
    localServer.close();
  } catch {}

  localServer = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 420,
    minHeight: 460,
    backgroundColor: '#020711',
    show: false,
    autoHideMenuBar: true,
    title: 'WRB-TV Player',
    icon: path.join(appRoot(), 'build', 'icon.ico'),
    fullscreenable: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(appRoot(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Ao clicar no botão de maximizar da janela, entrar no modo TV/fullscreen.
  mainWindow.on('maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
    mainWindow.setFullScreen(true);
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('wrb:app-fullscreen-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('wrb:app-fullscreen-changed', false);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wrb:fullscreen-changed', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wrb:fullscreen-changed', false);
    }
  });

}

async function boot() {
  try {
    const ok = await ensureLocalServer();

    if (!ok) {
      throw new Error(
        `Não foi possível iniciar o servidor local em http://127.0.0.1:${PORT}.`
      );
    }

    createWindow();
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  } catch (error) {
    dialog.showErrorBox(
      'WRB-TV Player',
      `${error.message}\n\nVerifique se a porta ${PORT} está livre.`
    );
    app.quit();
  }
}

app.whenReady().then(async () => {
  configureAutoUpdater();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  await boot();

  scheduleAutomaticUpdateChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
});

app.on('before-quit', () => {
  shuttingDown = true;
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  stopLocalServer();
});

app.on('window-all-closed', () => {
  app.quit();
});
