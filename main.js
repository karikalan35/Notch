const { app, BrowserWindow, Tray, Menu, screen, ipcMain, clipboard, globalShortcut, nativeImage, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit();

const W = 480, H = 230;          // window is bigger than the closed notch so it has room to open
let win, tray;
let clips = [], last = '';
const picked = new Set();          // files the user added to the shelf (only these can be opened from the notch)
let ps = null, psBuf = '';
const sysState = {};

/* a small PowerShell helper keeps running in the background to change volume, brightness and mic */
function startSystemHelper() {
  if (process.platform !== 'win32') return;
  try {
    ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'system.ps1')], { windowsHide: true });
    ps.stdout.on('data', d => {
      psBuf += d.toString();
      let i;
      while ((i = psBuf.indexOf('\n')) >= 0) { handleLine(psBuf.slice(0, i).trim()); psBuf = psBuf.slice(i + 1); }
    });
    ps.on('error', () => { ps = null; });
    ps.on('exit', () => { ps = null; });
    sysSend('get');
  } catch (e) { ps = null; }
}
function sysSend(line) { try { if (ps && ps.stdin.writable) ps.stdin.write(line + '\n'); } catch (e) {} }
function handleLine(l) {
  const [k, v] = l.split(' ');
  if (k === 'err') sysState['err_' + v] = true;
  else if (k === 'vol' || k === 'bri' || k === 'mic') { sysState[k] = Number(v); delete sysState['err_' + k]; }
  if (win && !win.isDestroyed()) win.webContents.send('sys', sysState);
}

function place() {
  const d = screen.getPrimaryDisplay();
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - W) / 2), y: d.bounds.y, width: W, height: H });
}

function createWindow() {
  win = new BrowserWindow({
    width: W, height: H,
    frame: false, transparent: true, resizable: false, movable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });   // click-through until the pointer is over the notch
  place();
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.showInactive());
  screen.on('display-metrics-changed', place);
}

function toggle() { win.isVisible() ? win.hide() : win.showInactive(); }

app.whenReady().then(() => {
  createWindow();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Islet');
  tray.on('click', toggle);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show or hide the notch', click: toggle },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Islet', click: () => app.quit() }
  ]));

  globalShortcut.register('Control+Alt+N', toggle);
  startSystemHelper();

  // clipboard history lives in memory only; nothing is written to disk
  // clipboard.readText() can return text or a Promise depending on the Electron version, so await handles both
  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const raw = await clipboard.readText();
      const t = String(raw || '').trim().slice(0, 300);
      if (t && t !== last) {
        last = t;
        clips = [t, ...clips.filter(x => x !== t)].slice(0, 8);
        if (win && !win.isDestroyed()) win.webContents.send('clips', clips);
      }
    } catch (e) { /* ignore a failed clipboard read and try again next tick */ }
    polling = false;
  }, 700);
});

ipcMain.on('interactive', (_, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.handle('clips', () => clips);
ipcMain.on('copy', async (_, t) => { last = t; try { await clipboard.writeText(t); } catch (e) {} });

ipcMain.handle('sys-state', () => sysState);
ipcMain.on('sys', (_, cmd, val) => {
  if (['vol', 'bri', 'mic'].includes(cmd)) sysSend(cmd + ' ' + Math.max(0, Math.min(100, Math.round(Number(val) || 0))));
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map(p => { picked.add(p); return { path: p, name: path.basename(p) }; });
});
ipcMain.on('open-file', (_, p) => { if (picked.has(p)) shell.openPath(p); });
ipcMain.on('hide', () => win.hide());
ipcMain.on('quit', () => app.quit());

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (ps) ps.kill(); });
app.on('window-all-closed', () => app.quit());
