'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('balanza', {
  onPeso: (cb) => ipcRenderer.on('peso', (_e, d) => cb(d)),
  onEstado: (cb) => ipcRenderer.on('estado', (_e, d) => cb(d)),
});
