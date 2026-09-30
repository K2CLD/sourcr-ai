const { app, BrowserWindow } = require("electron");
const path = require("path");
const { fork } = require("child_process");

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
      env: { ...process.env, PORT: String(PORT) },
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
  mainWindow.loadURL(SERVER_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
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

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => {
    stopServer();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", stopServer);
}
