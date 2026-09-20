/* OptiDesk — coque de bureau (Electron).
   Lance le serveur OptiDesk (API + interface, compilé avec PyInstaller) sur un port libre de 127.0.0.1,
   attend qu'il réponde, puis affiche l'interface dans une vraie fenêtre d'application.
   Les données (base SQLite, clé de signature, journaux) vivent dans %APPDATA%\OptiDesk :
   elles survivent aux mises à jour et à la désinstallation. */
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const isWin = process.platform === "win32";
const DATA_DIR = path.join(app.getPath("appData"), "OptiDesk");
const LOG_FILE = path.join(DATA_DIR, "optidesk-serveur.log");
fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath("userData", path.join(DATA_DIR, "electron")); // cache Chromium séparé de la base

let server = null; // processus du serveur OptiDesk
let win = null;
let splash = null;
let quitting = false;
let baseUrl = "";

/* --- Une seule instance à la fois : relancer l'application ramène la fenêtre existante --- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start).catch(fatal);
}

function fatal(err) {
  quitting = true;
  stopServer();
  dialog.showErrorBox(
    "OptiDesk n'a pas pu démarrer",
    `${err && err.message ? err.message : err}\n\nJournal technique : ${LOG_FILE}`,
  );
  app.exit(1);
}

/* --- Serveur OptiDesk ----------------------------------------------------------------------- */
function serverCommand() {
  const exe = isWin ? "optidesk-api.exe" : "optidesk-api";
  if (app.isPackaged) return { cmd: path.join(process.resourcesPath, "api", exe), args: [], cwd: undefined };
  // Développement (npm start) : programme compilé s'il existe, sinon Python directement
  const built = path.join(__dirname, "..", "api", "dist", "optidesk-api", exe);
  if (fs.existsSync(built)) return { cmd: built, args: [], cwd: undefined };
  const apiDir = path.join(__dirname, "..", "api");
  return { cmd: process.env.OPTIDESK_PYTHON || (isWin ? "python" : "python3"), args: ["run_exe.py"], cwd: apiDir };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/v1/health`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServer() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const { cmd, args, cwd } = serverCommand();
  if (!fs.existsSync(cmd) && path.isAbsolute(cmd))
    throw new Error(`Le composant serveur est introuvable :\n${cmd}\nRéinstallez OptiDesk.`);

  try { // journal tronqué au-delà de 2 Mo
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.truncateSync(LOG_FILE, 0);
  } catch (_) {}
  const log = fs.openSync(LOG_FILE, "a");
  fs.writeSync(log, `\n--- ${new Date().toISOString()} · démarrage (port ${port}) ---\n`);

  server = spawn(cmd, args, {
    cwd,
    windowsHide: true, // pas de fenêtre console noire
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      OPTIDESK_MODE: "exe",
      OPTIDESK_PORT: String(port),
      OPTIDESK_DATA_DIR: DATA_DIR,
      OPTIDESK_OPEN_BROWSER: "false", // c'est la fenêtre Electron qui affiche l'interface
    },
  });
  let exited = false;
  server.on("error", (e) => {
    exited = true;
    if (!quitting) fatal(new Error(`Impossible de lancer le serveur : ${e.message}`));
  });
  server.on("exit", (code) => {
    exited = true;
    if (!quitting) fatal(new Error(`Le serveur OptiDesk s'est arrêté (code ${code}).`));
  });

  const deadline = Date.now() + 60000; // premier démarrage : création de la base, un peu plus long
  while (Date.now() < deadline) {
    if (exited) throw new Error("Le serveur OptiDesk s'est arrêté au démarrage.");
    if (await ping(baseUrl)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Le serveur OptiDesk ne répond pas (délai dépassé).");
}

function stopServer() {
  if (!server || server.killed) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true });
    else server.kill();
  } catch (_) {}
  server = null;
}

/* --- Fenêtres ---------------------------------------------------------------------------------- */
function showSplash() {
  let logo = "";
  try {
    logo = `<img src="data:image/png;base64,${fs.readFileSync(path.join(__dirname, "icon.png")).toString("base64")}" width="84" height="84">`;
  } catch (_) {}
  splash = new BrowserWindow({
    width: 420, height: 300, frame: false, resizable: false, movable: true, center: true,
    show: true, alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#FFFFFF",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const html = `<body style="margin:0;font-family:'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#fff;color:#1E2124;border:1px solid #DCEFE2;box-sizing:border-box">
    ${logo}<div style="font-size:26px;font-weight:600;margin-top:12px">Opti<span style="background:#4FB894;color:#fff;border-radius:6px;padding:0 7px;margin-left:2px">Desk</span></div>
    <div style="margin-top:6px;font-size:13px;color:#6B7A72">Pharmacie Adjololo · Lomé, Togo</div>
    <div style="margin-top:22px;width:180px;height:4px;background:#E7F1EB;border-radius:4px;overflow:hidden"><div style="width:40%;height:100%;background:#4FB894;border-radius:4px;animation:m 1.1s ease-in-out infinite alternate"></div></div>
    <div style="margin-top:10px;font-size:12px;color:#6B7A72">Démarrage en cours…</div>
    <style>@keyframes m{from{margin-left:0}to{margin-left:60%}}</style></body>`;
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 1100, minHeight: 700, show: false,
    title: "OptiDesk", icon: path.join(__dirname, "icon.png"), backgroundColor: "#F5F7F4",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => {
    if (splash) { splash.close(); splash = null; }
    win.maximize();
    win.show();
  });
  win.on("closed", () => { win = null; });

  // L'application ne navigue que vers son propre serveur ; les liens externes s'ouvrent dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(baseUrl)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (ctrl && (input.key === "+" || input.key === "=")) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (ctrl && input.key === "-") { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (ctrl && input.key === "0") { win.webContents.setZoomLevel(0); e.preventDefault(); }
    else if (!app.isPackaged && input.key === "F12") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadURL(baseUrl);
}

async function start() {
  Menu.setApplicationMenu(null);
  showSplash();
  await startServer();
  createWindow();
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { quitting = true; stopServer(); });
process.on("exit", stopServer);
