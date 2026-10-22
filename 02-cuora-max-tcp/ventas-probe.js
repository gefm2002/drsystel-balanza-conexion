'use strict';
// Diagnóstico de solo lectura F72 para Cuora MAX por TCP.
// No ejecuta F32 ni escribe PLU/precios. La respuesta TCP debe validarse contra el firmware real.
const net = require('node:net');
const { buildFrame, verifyXOR, parseSalesReport } = require('../01.1-bridge-reportes/protocol');

const host = process.env.SCALE_IP || process.argv[2];
const port = Number(process.env.SCALE_PORT || process.argv[3] || 10001);
const address = Number(process.env.SCALE_ADDRESS ?? 0);
const timeoutMs = Number(process.env.SCALE_TIMEOUT_MS || 5000);

if (!host) {
  console.error('Uso: SCALE_IP=192.168.1.x SCALE_PORT=PUERTO_CONFIRMADO npm run probe:f72');
  process.exit(2);
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const date = d => pad(d.getDate()) + pad(d.getMonth() + 1) + pad(d.getFullYear() % 100);
const range = date(now) + date(now);
const request = buildFrame(address, 72, range);
const socket = net.createConnection({ host, port });
let received = Buffer.alloc(0);
let finished = false;
const timer = setTimeout(() => finish(new Error('Timeout esperando respuesta F72')), timeoutMs);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket.destroy();
  if (error) {
    console.error('[F72] ERROR:', error.message);
    console.error('[F72] Bytes recibidos:', received.length, received.toString('hex').match(/.{1,2}/g)?.join(' ') || '(ninguno)');
    process.exitCode = 1;
    return;
  }
  const frames = [];
  // F72 termina con ASCII 'F' seguido del byte XOR; no asumir que un paquete TCP equivale a una trama.
  for (let i = 2; i < received.length; i++) {
    if (received[i] === 0x46 && i + 1 < received.length) {
      const candidate = received.subarray(0, i + 2);
      if (verifyXOR(candidate)) frames.push(candidate);
    }
  }
  const frame = frames.at(-1);
  if (!frame) {
    console.error('[F72] No se pudo validar una trama completa con XOR. No interpretar respuesta como ventas.');
    console.error('HEX:', received.toString('hex').match(/.{1,2}/g)?.join(' ') || '(vacío)');
    process.exitCode = 1;
    return;
  }
  const payload = frame.subarray(2, frame.length - 1).toString('ascii');
  const tickets = parseSalesReport(payload);
  console.log(JSON.stringify({
    connected: true, host, port, address, function: 72, range,
    xorOk: true, rawBytes: frame.length, ticketRows: tickets.length,
    tickets, rawPayload: payload
  }, null, 2));
  if (!tickets.length) console.warn('Respuesta validada pero sin renglones parseables; revisar formato/firmware antes de integrar.');
}

socket.setTimeout(timeoutMs);
socket.on('connect', () => {
  console.log(`Conectado a ${host}:${port}; enviando consulta F72 de solo lectura para ${range}.`);
  socket.write(request);
});
socket.on('data', chunk => {
  received = Buffer.concat([received, chunk]);
  // Sólo finaliza cuando detectamos un final F + XOR válido.
  for (let i = 2; i + 1 < received.length; i++) {
    if (received[i] === 0x46 && verifyXOR(received.subarray(0, i + 2))) {
      finish(null);
      break;
    }
  }
});
socket.on('timeout', () => finish(new Error('Socket timeout')));
socket.on('error', err => finish(err));
