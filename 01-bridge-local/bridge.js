'use strict';
// Opción A — Bridge local: COM serial @115200 -> REST + WebSocket -> navegador
// + Flujo de venta (catálogo / carrito / cierre) y modo SIMULADOR para probar sin balanza.
// Uso:  node bridge.js [COM_PORT]            (modo real)
//       SIMULAR=1 node bridge.js            (modo simulador, sin COM)

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const { buildFrame, parseWeightFn1, BAUD, POLL_MS, ADDRESS } = require('./protocol');
const { buscarProducto } = require('./catalogo');
const ventaSvc = require('./venta');
const simulator = require('./simulator');

const COM_PORT = process.env.COM_PORT || process.argv[2] || 'COM3';
const HTTP_PORT = Number(process.env.PORT || 3001);
const SIMULAR = process.env.SIMULAR === '1' || process.argv.includes('--sim');

let lastReading = null; // último JSON válido leído de la balanza
let connected = false;
let port = null;
let pollTimer = null;
let retryTimer = null;
let simTimer = null;

// ---------- Servidor web (estáticos + REST) ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Peso (existente) ---
app.get('/peso', (req, res) => {
  if (!lastReading) return res.status(503).json({ error: 'sin lectura todavía', connected });
  res.json(lastReading);
});
app.get('/estado', (req, res) => res.json({ connected, comPort: SIMULAR ? 'SIMULADOR' : COM_PORT, baud: BAUD, simulando: SIMULAR }));

// --- Catálogo ---
app.get('/producto/:plu', (req, res) => {
  const prod = buscarProducto(req.params.plu);
  if (!prod) return res.status(404).json({ error: `PLU ${req.params.plu} no existe` });
  res.json(prod);
});

// --- Carrito ---
app.get('/carrito', (req, res) => res.json(ventaSvc.getCarrito()));

app.post('/carrito/item', (req, res) => {
  try {
    res.json(ventaSvc.agregarItem(req.body || {}));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

app.delete('/carrito/item/:idx', (req, res) => {
  try {
    res.json(ventaSvc.quitarItem(req.params.idx));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// --- Cierre de venta ---
app.post('/venta/cerrar', (req, res) => {
  try {
    const venta = ventaSvc.cerrarVenta(Date.now());
    console.log(`[venta] cerrada ticket #${venta.ticket}  ${venta.items.length} items  total $${venta.total}`);
    res.json(venta);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// --- Simulador de peso (solo en modo SIMULAR) ---
app.post('/sim/peso', (req, res) => {
  if (!SIMULAR) return res.status(409).json({ error: 'bridge no está en modo simulador (usar SIMULAR=1)' });
  const estado = simulator.setSim(req.body || {});
  res.json({ ok: true, sim: estado });
});

const server = app.listen(HTTP_PORT, () => {
  const fuente = SIMULAR ? 'SIMULADOR (sin balanza)' : `COM=${COM_PORT} @${BAUD}`;
  console.log(`[bridge] web  http://localhost:${HTTP_PORT}/venta.html   ${fuente}`);
});

// ---------- WebSocket (push de peso en vivo) ----------
const wss = new WebSocketServer({ server });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(lastReading || { connected, estado: connected ? 'conectado' : 'desconectado' }));
});

// ---------- Procesado común de una trama de respuesta Función 1 ----------
function handleFrame(frame) {
  try {
    const r = parseWeightFn1(frame);
    lastReading = { ...r, ts: Date.now(), connected: true };
    broadcast(lastReading);
  } catch (e) {
    broadcast({ error: 'parse', rawHex: frame.toString('hex'), ts: Date.now() });
  }
}

// ====================================================================
// MODO SIMULADOR: sin COM. Genera la trama real de Función 1 cada POLL_MS.
// ====================================================================
if (SIMULAR) {
  connected = true;
  console.log('[sim] modo simulador activo — POST /sim/peso para fijar el peso');
  simTimer = setInterval(() => handleFrame(simulator.currentFrame()), POLL_MS);
} else {
  openPort();
}

// ---------- Lectura serial con framing por silencio (~5ms) ----------
let rxBuf = [];
let rxTimer = null;
function onData(chunk) {
  for (const b of chunk) rxBuf.push(b);
  if (rxTimer) clearTimeout(rxTimer);
  rxTimer = setTimeout(flushFrame, 15); // > 5ms de silencio = fin de trama
}
function flushFrame() {
  if (!rxBuf.length) return;
  const frame = Buffer.from(rxBuf);
  rxBuf = [];
  handleFrame(frame);
}

// ---------- Conexión + polling de Función 1 (modo real) ----------
function openPort() {
  port = new SerialPort({
    path: COM_PORT, baudRate: BAUD, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false,
  });
  port.on('data', onData);
  port.on('close', () => {
    connected = false; stopPoll();
    broadcast({ connected: false, estado: 'desconectado', ts: Date.now() });
    scheduleRetry();
  });
  port.on('error', (err) => {
    connected = false;
    console.error('[serial]', err.message);
    broadcast({ connected: false, error: err.message, ts: Date.now() });
  });
  port.open((err) => {
    if (err) {
      connected = false;
      console.error(`[serial] no se pudo abrir ${COM_PORT}: ${err.message}`);
      broadcast({ connected: false, error: err.message, ts: Date.now() });
      return scheduleRetry();
    }
    connected = true;
    console.log(`[serial] abierto ${COM_PORT}`);
    broadcast({ connected: true, estado: 'conectado', ts: Date.now() });
    startPoll();
  });
}
function startPoll() {
  stopPoll();
  const enq = buildFrame(ADDRESS, 1); // Función 1 = pedir peso
  pollTimer = setInterval(() => {
    if (port && port.isOpen) port.write(enq);
  }, POLL_MS);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; openPort(); }, 2000);
}
