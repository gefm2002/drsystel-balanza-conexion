'use strict';
// Opción B — Cuora MAX por TCP/IP: socket a la IP de la balanza -> REST + WebSocket -> navegador
// Uso:  node server.js [SCALE_IP] [SCALE_PORT]   (o env SCALE_IP / SCALE_PORT / PORT)

const path = require('path');
const net = require('net');
const express = require('express');
const { WebSocketServer } = require('ws');
const { buildFrame, parseWeightFn1, POLL_MS, ADDRESS } = require('./protocol');

const SCALE_IP = process.env.SCALE_IP || process.argv[2] || '192.168.1.50';
const SCALE_PORT = Number(process.env.SCALE_PORT || process.argv[3] || 4000);
const HTTP_PORT = Number(process.env.PORT || 3002);

let lastReading = null;
let connected = false;
let socket = null;
let pollTimer = null;
let retryTimer = null;

// ---------- Servidor web (estáticos + REST) ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/peso', (req, res) => {
  if (!lastReading) return res.status(503).json({ error: 'sin lectura todavía', connected });
  res.json(lastReading);
});
app.get('/estado', (req, res) => res.json({ connected, scaleIp: SCALE_IP, scalePort: SCALE_PORT }));

const server = app.listen(HTTP_PORT, () => {
  console.log(`[tcp] web  http://localhost:${HTTP_PORT}   balanza=${SCALE_IP}:${SCALE_PORT}`);
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(lastReading || { connected, estado: connected ? 'conectado' : 'desconectado' }));
});

// ---------- Framing por silencio ----------
let rxBuf = [];
let rxTimer = null;
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
    const r = parseWeightFn1(frame);
    lastReading = { ...r, ts: Date.now(), connected: true };
    broadcast(lastReading);
  } catch (e) {
    broadcast({ error: 'parse', rawHex: frame.toString('hex'), ts: Date.now() });
  }
}

// ---------- Conexión TCP + polling de Función 1 ----------
function connectScale() {
  socket = net.createConnection({ host: SCALE_IP, port: SCALE_PORT });
  socket.on('connect', () => {
    connected = true;
    console.log(`[tcp] conectado a ${SCALE_IP}:${SCALE_PORT}`);
    broadcast({ connected: true, estado: 'conectado', ts: Date.now() });
    startPoll();
  });
  socket.on('data', onData);
  socket.on('close', () => {
    connected = false; stopPoll();
    broadcast({ connected: false, estado: 'desconectado', ts: Date.now() });
    scheduleRetry();
  });
  socket.on('error', (err) => {
    connected = false;
    console.error('[tcp]', err.message);
    broadcast({ connected: false, error: err.message, ts: Date.now() });
  });
}
function startPoll() {
  stopPoll();
  const enq = buildFrame(ADDRESS, 1);
  pollTimer = setInterval(() => {
    if (socket && !socket.destroyed && connected) socket.write(enq);
  }, POLL_MS);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; connectScale(); }, 2000);
}

connectScale();
