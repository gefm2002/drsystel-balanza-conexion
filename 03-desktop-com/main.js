'use strict';
// Opción C — Electron: abre el COM en el proceso principal y envía el peso al renderer por IPC.
// COM por env: COM_PORT=COM5 npm start

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { buildFrame, parseWeightFn1, BAUD, POLL_MS, ADDRESS } = require('./protocol');

const COM_PORT = process.env.COM_PORT || 'COM3';

let win = null;
let port = null;
let pollTimer = null;
let retryTimer = null;
let rxBuf = [];
let rxTimer = null;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function onData(chunk) {
  for (const b of chunk) rxBuf.push(b);
  if (rxTimer) clearTimeout(rxTimer);
  rxTimer = setTimeout(flushFrame, 15);
}
function flushFrame() {
  if (!rxBuf.length) return;
  const frame = Buffer.from(rxBuf);
  rxBuf = [];
  try {
    send('peso', { ...parseWeightFn1(frame), ts: Date.now(), connected: true });
  } catch (e) {
    send('peso', { error: 'parse', rawHex: frame.toString('hex'), ts: Date.now() });
  }
}

function openPort() {
  port = new SerialPort({
    path: COM_PORT, baudRate: BAUD, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false,
  });
  port.on('data', onData);
  port.on('close', () => { stopPoll(); send('estado', { connected: false }); scheduleRetry(); });
  port.on('error', (err) => send('estado', { connected: false, error: err.message }));
  port.open((err) => {
    if (err) {
      send('estado', { connected: false, error: err.message });
      return scheduleRetry();
    }
    send('estado', { connected: true });
    startPoll();
  });
}
function startPoll() {
  stopPoll();
  const enq = buildFrame(ADDRESS, 1);
  pollTimer = setInterval(() => { if (port && port.isOpen) port.write(enq); }, POLL_MS);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; openPort(); }, 2000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 560, height: 720,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    send('estado', { connected: false, info: `COM=${COM_PORT} @${BAUD}` });
    openPort();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (port && port.isOpen) port.close();
  app.quit();
});
