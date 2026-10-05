const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

// electron-updater writes its own detailed internal trace here when set as its logger
// (checking-for-update, found/not-found, download progress, errors — everything). File
// lives at %APPDATA%\Sourcr AI\logs\main.log on Windows; log.transports.file.getFile()
// prints the exact resolved path below on every launch.
log.transports.file.level = "info";
log.transports.console.level = "info";
autoUpdater.logger = log;

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function resolveServerPath() {
  // Electron's forked child (spawned via the Electron binary in
  // ELECTRON_RUN_AS_NODE mode) can read straight out of app.asar, so this
  // works unchanged whether packaged or running from source.
  return path.join(app.getAppPath(), "server.js");
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = resolveServerPath();

    // No `cwd` override here: when packaged, serverPath lives inside app.asar,
    // which is a virtual archive, not a real directory — passing its dirname
    // as `cwd` makes Windows' CreateProcess fail with a misleading ENOENT on
    // the executable itself. server.js resolves its own paths via __dirname
    // and process.resourcesPath, so the default cwd is fine.
    serverProcess = fork(serverPath, [], {
      // SOURCR_DATA_DIR: writable home for runtime data (Keepa cache, token stats) —
      // the bundled database/ folder sits inside read-only app.asar when packaged.
      env: { ...process.env, PORT: String(PORT), SOURCR_DATA_DIR: app.getPath("userData") },
      silent: true,
    });

    serverProcess.stdout?.on("data", (data) => console.log(`[server] ${data}`.trim()));
    serverProcess.stderr?.on("data", (data) => console.error(`[server] ${data}`.trim()));

    const onMessage = (msg) => {
      if (msg === "server-ready") {
        serverProcess.off("message", onMessage);
        resolve();
      }
    };
    serverProcess.on("message", onMessage);

    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Backend server exited with code ${code}`);
      }
    });

    // Fallback in case the "server-ready" IPC message is ever missed.
    setTimeout(resolve, 5000);
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Sourcr AI",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  // target="_blank" links (Amazon listings, Seller Central approval requests) open in the
  // user's default browser, where they're signed in — not in a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadURL(SERVER_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  log.info(`[updater] log file: ${log.transports.file.getFile().path}`);
  log.info(`[updater] app version: ${app.getVersion()}, isPackaged: ${app.isPackaged}`);

  // electron-updater errors out immediately when running unpacked (dev) —
  // there's no packaged app.asar/app-update.yml for it to compare against.
  if (!app.isPackaged) {
    log.info("[updater] skipping — not a packaged build");
    return;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] update available: ${info.version} (current: ${app.getVersion()})`);
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info(`[updater] no update available — latest is ${info.version}, already up to date`);
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(`[updater] downloading: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on("error", (err) => {
    log.error("[updater] error:", err.stack || err.message);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    log.info(`[updater] download complete: ${info.version}`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update ready",
      message: `Sourcr AI ${info.version} has been downloaded.`,
      detail: "Restart now to install it, or install it the next time you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  log.info("[updater] calling checkForUpdates()");
  autoUpdater.checkForUpdates().catch((err) => {
    log.error("[updater] checkForUpdates() rejected:", err.stack || err.message);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await createWindow();
    setupAutoUpdater();
  });

  app.on("window-all-closed", () => {
    stopServer();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", stopServer);
}
