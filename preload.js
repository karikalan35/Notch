const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islet', {
  setInteractive: on => ipcRenderer.send('interactive', on),
  getClips: () => ipcRenderer.invoke('clips'),
  onClips: cb => ipcRenderer.on('clips', (_, list) => cb(list)),
  copy: t => ipcRenderer.send('copy', t),
  sys: (cmd, val) => ipcRenderer.send('sys', cmd, val),
  getSys: () => ipcRenderer.invoke('sys-state'),
  onSys: cb => ipcRenderer.on('sys', (_, s) => cb(s)),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  openFile: p => ipcRenderer.send('open-file', p),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit')
});
