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

function configureAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    console.log('[WRB-TV] Verificando atualizações...');
  });

  autoUpdater.on('update-available', info => {
    updateAvailableVersion = info.version;
    console.log(`[WRB-TV] Atualização disponível: ${info.version}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: 'Atualização do WRB-TV Player',
      message: `Uma nova versão do WRB-TV Player está disponível.`,
      detail: `Versão instalada: ${app.getVersion()}\nNova versão: ${info.version}\n\nVocê pode atualizar agora sem desinstalar o aplicativo. Seus dados e o ID do dispositivo serão preservados.`,
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (choice === 0) downloadAndInstallUpdate();
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[WRB-TV] Nenhuma atualização disponível.');
  });

  autoUpdater.on('download-progress', progress => {
    console.log(`[WRB-TV] Baixando atualização: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', info => {
    updateDownloadInProgress = false;
    updateAvailableVersion = info.version;
    console.log(`[WRB-TV] Atualização baixada: ${info.version}`);

    if (!mainWindow || mainWindow.isDestroyed()) return;

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: 'Atualização pronta',
      message: 'A atualização do WRB-TV Player foi baixada.',
      detail: `A versão ${info.version} será instalada quando você reiniciar o aplicativo.`,
      buttons: ['Reiniciar e atualizar', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (choice === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on('error', error => {
    updateDownloadInProgress = false;
    console.error('[WRB-TV] Erro no atualizador:', error);
  });
}

async function checkForUpdates() {
  if (!app.isPackaged || updateDownloadInProgress) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
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
    console.error('[WRB-TV] Falha ao baixar atualização:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Atualização do WRB-TV Player',
        'Não foi possível baixar a atualização agora. Tente novamente mais tarde.'
      );
    }
  }
}

ipcMain.handle('wrb:get-device-id', () => getDeviceId());

ipcMain.handle('wrb:set-fullscreen', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setFullScreen(!!enabled);
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
    minWidth: 1024,
    minHeight: 650,
    backgroundColor: '#020711',
    show: false,
    autoHideMenuBar: true,
    title: 'WRB-TV Player',
    icon: path.join(appRoot(), 'build', 'icon.ico'),
    fullscreenable: true,
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

  // A primeira verificação ocorre alguns segundos após o aplicativo abrir,
  // evitando atrasar o carregamento do player.
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(), 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
});

app.on('before-quit', () => {
  shuttingDown = true;
  stopLocalServer();
});

app.on('window-all-closed', () => {
  app.quit();
});
