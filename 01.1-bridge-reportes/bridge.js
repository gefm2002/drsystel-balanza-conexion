'use strict';
// Alternativa 1.1 — Bridge local con PESO (Función 1, en vivo) + REPORTE DE VENTAS (Función 72) + CIERRE (Función 32).
// Mantiene en funcionamiento la Función 1 (peso por WebSocket); agrega endpoints REST para el reporte.
// Uso:  node bridge.js                  (modo real, detecta solo el COM del FTDI de la balanza)
//       node bridge.js [COM_PORT]        (modo real, COM forzado)
//       SIMULAR=1 node bridge.js        (modo simulador, sin COM)

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const P = require('./protocol');
const simulator = require('./simulator');
const { detectarPuertoFtdi } = require('./puerto');

// Sin COM_PORT se busca el FTDI de la balanza en cada intento de apertura (sigue al COM si Windows lo renumera).
const COM_FORZADO = process.env.COM_PORT || process.argv[2] || null;
let comPort = COM_FORZADO; // COM en uso (null hasta detectarlo)
const HTTP_PORT = Number(process.env.PORT || 3001);
const SIMULAR = process.env.SIMULAR === '1' || process.argv.includes('--sim');

let lastReading = null;
let connected = false;
let port = null;
let pollTimer = null;
let retryTimer = null;
let simTimer = null;

// modo de la línea serie: 'weight' (polling F1) | 'report' (esperando respuesta de F72/F32)
let mode = 'weight';
let pending = null; // { resolve, reject, buf:[], timer, kind:'report'|'close' }

// Ventas asentadas por el bucle de polling de F72 (clave = ticketId)
const ventas = new Map();
let pollVentasTimer = null;
let pollVentasMs = 0;
let rangoPolling = null; // {desde, hasta} para F72; null = día de hoy

// --- Polling gateado por inactividad (modo B) ---
// El reporte F72 bloquea el teclado de la balanza mientras se transmite (~4 s con muchos tickets).
// Para no molestar al operario, sólo pedimos F72 cuando la balanza está OCIOSA (plato vacío y peso
// estable hace un rato = nadie vendiendo). Si nunca aparece un hueco, un FALLBACK por tiempo fuerza
// igual la consulta a los 90 s para que ninguna venta quede sin asentar demasiado tiempo.
const IDLE_PESO_MAX_G = Number(process.env.IDLE_PESO_MAX_G || 5);    // plato "vacío" si |peso| ≤ 5 g
const IDLE_ESTABLE_MS = Number(process.env.IDLE_ESTABLE_MS || 4000); // hay que estar vacío+estable este tiempo
const FALLBACK_MS = Number(process.env.FALLBACK_MS || 90000);        // tope: forzar F72 si no hubo hueco
let pollIdleMs = IDLE_ESTABLE_MS;
let pollPesoMaxG = IDLE_PESO_MAX_G;
let pollFallbackMs = FALLBACK_MS;
let idleDesde = null;            // ts en que el plato quedó vacío+estable (null = no ocioso)
let ultimaImportacionTs = 0;     // ts de la última importación F72 exitosa (0 = nunca → fuerza al arrancar)
let pollEnCurso = false;         // evita reentrar mientras una importación está en vuelo

// ---------- Servidor web ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Peso (Función 1, se mantiene) ---
app.get('/peso', (req, res) => {
  if (!lastReading) return res.status(503).json({ error: 'sin lectura todavía', connected });
  res.json(lastReading);
});
app.get('/estado', (req, res) => res.json({ connected, comPort: SIMULAR ? 'SIMULADOR' : (comPort || 'buscando FTDI…'), baud: P.BAUD, simulando: SIMULAR, mode }));

// --- Reporte de ventas (Función 72) ---
// GET /ventas?desde=DDMMAA&hasta=DDMMAA   (ambos opcionales; default = hoy..hoy es responsabilidad del cliente)
app.get('/ventas', async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const tickets = await pedirReporte(desde, hasta);
    const total = Math.round(tickets.reduce((a, t) => a + t.importe, 0) * 100) / 100;
    res.json({ tickets, total, count: tickets.length, desde: desde || null, hasta: hasta || null });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Cierre de ventas (Función 32) — DESTRUCTIVO: resetea acumuladores y nº de ticket ---
app.post('/ventas/cerrar', async (req, res) => {
  try {
    await pedirCierre();
    res.json({ ok: true, mensaje: 'cierre de ventas ejecutado (acumuladores reseteados)' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Bucle de polling de F72: ventas asentadas automáticamente ---
app.get('/ventas/asentadas', (req, res) => {
  const lista = [...ventas.values()].sort((a, b) => a.asentadaTs - b.asentadaTs);
  const total = Math.round(lista.reduce((a, v) => a + v.total, 0) * 100) / 100;
  res.json({ ventas: lista, count: lista.length, total });
});

// --- Cobro: confirmar / cancelar la venta que llegó desde la balanza ---
// El operario arma el ticket en la balanza; el bridge lo asienta como PENDIENTE;
// el cajero ve el carrito completo en el sistema y confirma (cobra) o cancela.
app.get('/ventas/pendientes', (req, res) => {
  const lista = [...ventas.values()]
    .filter((v) => v.estado === 'pendiente')
    .sort((a, b) => a.asentadaTs - b.asentadaTs); // FIFO: la más vieja primero
  const total = Math.round(lista.reduce((a, v) => a + v.total, 0) * 100) / 100;
  res.json({ pendientes: lista, count: lista.length, total });
});

const MEDIOS_PAGO = ['EF', 'TARJ']; // Efectivo / Tarjeta (spec A: el bridge es la caja)
app.post('/ventas/confirmar', (req, res) => {
  const id = req.body && req.body.id;
  const medioPago = req.body && req.body.medioPago;
  const venta = id && ventas.get(id);
  if (!venta) return res.status(404).json({ error: 'venta no encontrada', id });
  if (venta.estado !== 'pendiente') return res.status(409).json({ error: `venta ya ${venta.estado}`, id });
  if (medioPago && !MEDIOS_PAGO.includes(medioPago)) return res.status(400).json({ error: `medioPago inválido (${MEDIOS_PAGO.join('/')})`, id });
  venta.estado = 'confirmada';
  venta.confirmadaTs = Date.now();
  venta.medioPago = medioPago || 'EF'; // default Efectivo si el cliente no lo manda
  console.log(`[cobro] CONFIRMADA ${id} · $${venta.total} · ${venta.medioPago}`);
  // TODO ERP: cuando exista el ERP, acá se empuja la venta (ventas/stock/caja). Por ahora solo se asienta local.
  broadcast({ tipo: 'venta-confirmada', venta });
  res.json({ ok: true, venta });
});

app.post('/ventas/cancelar', (req, res) => {
  const id = req.body && req.body.id;
  const venta = id && ventas.get(id);
  if (!venta) return res.status(404).json({ error: 'venta no encontrada', id });
  if (venta.estado !== 'pendiente') return res.status(409).json({ error: `venta ya ${venta.estado}`, id });
  venta.estado = 'cancelada';
  venta.canceladaTs = Date.now();
  console.log(`[cobro] CANCELADA ${id} · $${venta.total}`);
  broadcast({ tipo: 'venta-cancelada', venta });
  res.json({ ok: true, venta });
});
app.post('/polling/start', (req, res) => {
  const b = req.body || {};
  const ms = Math.max(500, Number(b.intervaloMs || 1500)); // cadencia de CHEQUEO del hueco (no de importación)
  const rango = (b.desde && b.hasta) ? { desde: b.desde, hasta: b.hasta } : null;
  startPollVentas(ms, rango, { idleMs: b.idleMs, pesoMaxG: b.pesoMaxG, fallbackMs: b.fallbackMs });
  res.json({ ok: true, activo: true, intervaloMs: ms, idleMs: pollIdleMs, fallbackMs: pollFallbackMs });
});
app.post('/polling/stop', (req, res) => { stopPollVentas(); res.json({ ok: true, activo: false }); });
app.get('/polling/estado', (req, res) => res.json({
  activo: !!pollVentasTimer,
  intervaloMs: pollVentasMs,
  idleMs: pollIdleMs,
  fallbackMs: pollFallbackMs,
  ocioso: idleDesde !== null && (Date.now() - idleDesde) >= pollIdleMs,
  segDesdeUltimaImport: ultimaImportacionTs ? Math.round((Date.now() - ultimaImportacionTs) / 1000) : null,
  totalVentas: ventas.size,
}));

// --- Importar ventas a demanda (válvula A): fuerza UNA consulta F72 ya, ignorando el gate ---
// El cajero la dispara cuando quiere las ventas al instante (acepta el bloqueo breve del teclado).
app.post('/ventas/importar', async (req, res) => {
  if (pollEnCurso) return res.status(409).json({ error: 'importación en curso' });
  pollEnCurso = true;
  try {
    const r = await pollVentasOnce();
    if (!r.error) ultimaImportacionTs = Date.now();
    res.json({ ok: !r.error, ...r });
  } finally { pollEnCurso = false; }
});

// --- Simuladores (solo modo SIMULAR) ---
app.post('/sim/peso', (req, res) => {
  if (!SIMULAR) return res.status(409).json({ error: 'usar SIMULAR=1' });
  res.json({ ok: true, sim: simulator.setSim(req.body || {}) });
});
app.post('/sim/ventas', (req, res) => {
  if (!SIMULAR) return res.status(409).json({ error: 'usar SIMULAR=1' });
  const tickets = simulator.setVentasSim((req.body && req.body.tickets) || undefined);
  res.json({ ok: true, count: tickets.length });
});
// simula que el operario cerró una venta nueva en la balanza (para probar el bucle)
app.post('/sim/ventas/nueva', (req, res) => {
  if (!SIMULAR) return res.status(409).json({ error: 'usar SIMULAR=1' });
  const ticket = simulator.addVentaSim(req.body || {});
  res.json({ ok: true, ticket });
});

const server = app.listen(HTTP_PORT, () => {
  const fuente = SIMULAR ? 'SIMULADOR (sin balanza)' : `COM=${COM_FORZADO || 'auto (FTDI)'} @${P.BAUD}`;
  console.log(`[bridge 1.1] http://localhost:${HTTP_PORT}/  (peso) · /reportes.html (ventas)   ${fuente}`);
});

// ---------- WebSocket (peso en vivo) ----------
const wss = new WebSocketServer({ server });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(lastReading || { connected, estado: connected ? 'conectado' : 'desconectado' }));
});

// ---------- Peso: procesar una trama F1 ----------
function handleWeightFrame(frame) {
  try {
    const r = P.parseWeightFn1(frame);
    lastReading = { ...r, ts: Date.now(), connected: true };
    actualizarOcio(r);
    broadcast(lastReading);
  } catch (e) {
    broadcast({ error: 'parse', rawHex: frame.toString('hex'), ts: Date.now() });
  }
}

// Marca/limpia el inicio de la ventana de inactividad según el peso en vivo (modo B).
// Plato vacío (|peso| ≤ umbral) + lectura estable ⇒ arranca a contar el hueco; cualquier
// movimiento o peso lo reinicia. El gate del polling consulta idleDesde para decidir.
function actualizarOcio(r) {
  const vacioYQuieto = r.estable && Math.abs(r.pesoGramos || 0) <= pollPesoMaxG;
  if (vacioYQuieto) { if (idleDesde === null) idleDesde = Date.now(); }
  else { idleDesde = null; }
}

// ====================================================================
// PEDIDOS PUNTUALES sobre la línea serie (F72 / F32): pausan el polling de peso,
// envían la trama, acumulan la respuesta y reanudan el peso. (Maestro-esclavo: una a la vez.)
// ====================================================================
function pedirReporte(desde, hasta) {
  if (SIMULAR) {
    const { tickets } = P.parseSalesReportFrame(simulator.buildSalesReportFrame());
    return Promise.resolve(filtrarPorFecha(tickets, desde, hasta));
  }
  // El firmware filtra raro por rango (una consulta de un solo día devolvió 'E7' / error):
  // pedimos TODO con rango amplio y filtramos por fecha en JS, que es robusto.
  return enviarYRecibir(P.buildFrame(P.ADDRESS, 72, '010100311299'), 'report', 25000)
    .then((frame) => {
      const { xorOk, tickets } = P.parseSalesReportFrame(frame);
      const tail = P.toHex(frame.subarray(Math.max(0, frame.length - 6)));
      console.log(`[F72] frame ${frame.length}b · XOR ${xorOk ? 'OK' : 'NO'} · ${tickets.length} tickets · cola: ${tail}`);
      return filtrarPorFecha(tickets, desde, hasta);
    });
}

// Filtra los tickets por rango de fecha 'DDMMAA' (ambos opcionales), comparando cronológicamente.
function filtrarPorFecha(tickets, desde, hasta) {
  let res = tickets;
  if (desde) { const k = P.fechaKey(desde); if (Number.isFinite(k)) res = res.filter((t) => P.fechaKey(t.fecha) >= k); }
  if (hasta) { const k = P.fechaKey(hasta); if (Number.isFinite(k)) res = res.filter((t) => P.fechaKey(t.fecha) <= k); }
  return res;
}

function pedirCierre() {
  if (SIMULAR) { console.log('[sim] cierre F32 (no-op en simulador)'); return Promise.resolve(); }
  // F32 responde "I" (procesando) y luego ACK; damos más tiempo.
  return enviarYRecibir(P.buildFrame(P.ADDRESS, 32), 'close', 8000);
}

// ====================================================================
// BUCLE DE POLLING DE F72: detecta tickets nuevos y los "asienta" (agrupados por venta).
// Una venta = todos los renglones de F72 con el mismo ticketId.
// ====================================================================
function rangoHoy() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const hoy = p2(d.getDate()) + p2(d.getMonth() + 1) + String(d.getFullYear()).slice(-2);
  return { desde: hoy, hasta: hoy };
}

function agruparPorTicket(tickets) {
  const m = new Map();
  for (const t of tickets) {
    if (!m.has(t.ticketId)) {
      m.set(t.ticketId, { ticketId: t.ticketId, fecha: t.fecha, hora: t.hora, vendedor: t.vendedor, items: [], total: 0 });
    }
    const v = m.get(t.ticketId);
    v.items.push({ plu: t.plu, tipo: t.tipo, unidades: t.unidades, gramos: t.gramos, importe: t.importe });
    v.total = Math.round((v.total + t.importe) * 100) / 100;
  }
  return m;
}

async function pollVentasOnce() {
  let tickets;
  try {
    const { desde, hasta } = rangoPolling || rangoHoy();
    tickets = await pedirReporte(desde, hasta);
  } catch (e) {
    // 409 (otro pedido en curso) / 504 (timeout) / 503 (sin balanza) → saltar esta vuelta
    return { nuevas: 0, error: e.message };
  }
  const agrupadas = agruparPorTicket(tickets);
  let nuevas = 0;
  for (const [, v] of agrupadas) {
    // Clave compuesta fecha+ticketId: el cierre F32 (CUORA MAX) resetea el nº de ticket,
    // así que ticketId solo NO es único entre días/cierres. fecha+ticketId sí lo es.
    const id = `${v.fecha}#${v.ticketId}`;
    if (!ventas.has(id)) {
      const venta = { ...v, id, estado: 'pendiente', asentadaTs: Date.now() };
      ventas.set(id, venta);
      nuevas++;
      console.log(`[venta] asentada ${id} · ${venta.items.length} items · $${venta.total} · PENDIENTE de cobro`);
      broadcast({ tipo: 'venta-nueva', venta });
    }
  }
  return { nuevas, total: ventas.size };
}

// Una "vuelta" del loop: NO consulta siempre. Sólo pide F72 si la balanza está ociosa (hay un hueco)
// o si venció el tope de fallback (hace rato que no se importa). Si no, saltea para no trabar el teclado.
async function pollVentasTick() {
  if (pollEnCurso) return; // ya hay una importación en vuelo (o esperando respuesta serial)
  const ahora = Date.now();
  const ocioso = idleDesde !== null && (ahora - idleDesde) >= pollIdleMs;
  const arranque = ultimaImportacionTs === 0; // puesta al día al iniciar el loop
  const vencioTope = !arranque && (ahora - ultimaImportacionTs) >= pollFallbackMs;
  if (!ocioso && !arranque && !vencioTope) return; // ni hueco ni tope → no molestar
  pollEnCurso = true;
  if (!ocioso && vencioTope) {
    console.warn(`[polling] sin hueco hace ${Math.round((ahora - ultimaImportacionTs) / 1000)}s → fuerzo F72 por tope (acepta bloqueo breve)`);
  }
  try {
    const r = await pollVentasOnce();
    if (!r.error) ultimaImportacionTs = Date.now(); // sólo cuenta como import si no falló (409/504/503 reintenta)
  } finally {
    pollEnCurso = false;
  }
}

function startPollVentas(ms, rango, opts = {}) {
  stopPollVentas();
  pollVentasMs = ms;
  rangoPolling = rango || null;
  pollIdleMs = Math.max(0, Number(opts.idleMs ?? IDLE_ESTABLE_MS));
  pollPesoMaxG = Math.max(0, Number(opts.pesoMaxG ?? IDLE_PESO_MAX_G));
  pollFallbackMs = Math.max(0, Number(opts.fallbackMs ?? FALLBACK_MS));
  idleDesde = null;
  ultimaImportacionTs = 0; // 0 ⇒ el primer tick fuerza una importación de "puesta al día"
  console.log(`[polling] F72 gateado: chequeo cada ${ms}ms · hueco=plato≤${pollPesoMaxG}g estable ${pollIdleMs}ms · tope ${Math.round(pollFallbackMs / 1000)}s${rango ? ` (rango ${rango.desde}-${rango.hasta})` : ' (hoy)'}`);
  pollVentasTick(); // primera evaluación inmediata (puesta al día al arrancar)
  pollVentasTimer = setInterval(pollVentasTick, ms);
}
function stopPollVentas() {
  if (pollVentasTimer) clearInterval(pollVentasTimer);
  pollVentasTimer = null;
  pollVentasMs = 0;
  pollEnCurso = false;
  idleDesde = null;
}

// Serializa un pedido sobre la línea: pausa peso, manda, acumula hasta completar (o timeout).
function enviarYRecibir(frame, kind, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!connected || !port || !port.isOpen) {
      const e = new Error('balanza no conectada'); e.status = 503; return reject(e);
    }
    if (pending) { const e = new Error('hay otro pedido en curso'); e.status = 409; return reject(e); }
    stopPoll();
    mode = 'report';
    rxBuf = [];
    pending = {
      kind, buf: [],
      resolve: (buf) => { cleanupPending(); resolve(buf); },
      reject: (err) => { cleanupPending(); reject(err); },
      timer: setTimeout(() => {
        const e = new Error(`timeout esperando respuesta (${kind})`); e.status = 504;
        if (pending) pending.reject(e);
      }, timeoutMs),
    };
    port.write(frame);
  });
}
function cleanupPending() {
  if (pending && pending.timer) clearTimeout(pending.timer);
  if (pending && pending.silence) clearTimeout(pending.silence);
  pending = null;
  mode = 'weight';
  rxBuf = [];
  startPoll(); // reanudar peso
}

// ---------- Lectura serial ----------
let rxBuf = [];
let rxTimer = null;
function onData(chunk) {
  for (const b of chunk) rxBuf.push(b);

  if (mode === 'report' && pending) {
    const buf = Buffer.from(rxBuf);
    if (pending.kind === 'report') {
      // Terminador REAL: el reporte F72 cierra con 'F' (0x46) + XOR (el manual lo documenta y la 'F'
      // no aparece en medio: los datos son sólo dígitos y separadores '^' ';' '/' ':'). Es un
      // centinela limpio, así que ESPERAMOS la 'F' final aunque la balanza stremee en ráfagas con
      // pausas (juntando registros). isReportComplete = última-data 'F' + XOR válido sobre todo.
      if (P.isReportComplete(buf)) return pending.resolve(buf);
      // Red de seguridad por si un firmware no manda la 'F': sólo si hay un silencio LARGO (más que
      // cualquier pausa entre ráfagas) y ya parseamos ≥1 ticket. Generoso para no cortar a mitad.
      if (pending.silence) clearTimeout(pending.silence);
      pending.silence = setTimeout(() => {
        if (!pending || !rxBuf.length) return;
        const b = Buffer.from(rxBuf);
        const { tickets } = P.parseSalesReportFrame(b);
        if (tickets.length >= 1) { console.warn(`[F72] sin 'F' final; cierro por silencio largo con ${tickets.length} tickets`); pending.resolve(b); }
      }, 2000);
    } else if (pending.kind === 'close') {
      // F32: nos alcanza con recibir el ACK final (3 bytes 'ACK') tras la 'I'
      const s = buf.toString('ascii');
      if (s.includes('ACK')) pending.resolve(buf);
    }
    return;
  }

  // modo peso: framing por silencio (~15ms)
  if (rxTimer) clearTimeout(rxTimer);
  rxTimer = setTimeout(() => {
    if (!rxBuf.length) return;
    const frame = Buffer.from(rxBuf);
    rxBuf = [];
    handleWeightFrame(frame);
  }, 15);
}

// ---------- Conexión + polling F1 ----------
async function openPort() {
  if (!COM_FORZADO) {
    try { comPort = await detectarPuertoFtdi(); }
    catch (err) { connected = false; console.error(`[serial] ${err.message}`); broadcast({ connected: false, error: err.message, ts: Date.now() }); return scheduleRetry(); }
  }
  port = new SerialPort({ path: comPort, baudRate: P.BAUD, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false });
  port.on('data', onData);
  port.on('close', () => { connected = false; stopPoll(); broadcast({ connected: false, estado: 'desconectado', ts: Date.now() }); scheduleRetry(); });
  port.on('error', (err) => { connected = false; console.error('[serial]', err.message); broadcast({ connected: false, error: err.message, ts: Date.now() }); });
  port.open((err) => {
    if (err) { connected = false; console.error(`[serial] no se pudo abrir ${comPort}: ${err.message}`); broadcast({ connected: false, error: err.message, ts: Date.now() }); return scheduleRetry(); }
    connected = true;
    console.log(`[serial] abierto ${comPort}${COM_FORZADO ? '' : ' (detectado FTDI)'}`);
    broadcast({ connected: true, estado: 'conectado', ts: Date.now() });
    startPoll();
  });
}
function startPoll() {
  stopPoll();
  if (mode !== 'weight') return;
  const enq = P.buildFrame(P.ADDRESS, 1);
  pollTimer = setInterval(() => { if (port && port.isOpen && mode === 'weight') port.write(enq); }, P.POLL_MS);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function scheduleRetry() { if (retryTimer) return; retryTimer = setTimeout(() => { retryTimer = null; openPort(); }, 2000); }

// ====================================================================
// Arranque
// ====================================================================
if (SIMULAR) {
  connected = true;
  console.log('[sim] modo simulador — POST /sim/peso (peso) · POST /sim/ventas/nueva (venta) · GET /ventas');
  simTimer = setInterval(() => handleWeightFrame(simulator.currentFrame()), P.POLL_MS);
} else {
  openPort();
}

// Auto-arrancar el bucle de F72 si se define POLL_VENTAS_MS (ej: POLL_VENTAS_MS=2000)
const autoPoll = Number(process.env.POLL_VENTAS_MS || 0);
if (autoPoll > 0) startPollVentas(Math.max(500, autoPoll));
