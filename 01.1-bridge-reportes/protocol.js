'use strict';
// Protocolo Cuora / Cuora MAX — maestro-esclavo @115200
// Trama: [Dir 1B][Func 1B][Datos NB ASCII][XOR 1B]
// Alternativa 1.1: mantiene Función 1 (peso) y agrega Función 72 (reporte de ventas) + 32 (cierre).
// Fuente: conectar/.../enMD/cuora-implementacion-cliente-erp.md y los manuales CUORA MAX.

const BAUD = 115200;   // confirmado por el ejemplo oficial Systel (Form1.vb)
const POLL_MS = 400;   // polling de Función 1 (no hay streaming en Cuora)
const ADDRESS = 0;     // dirección de la balanza — la unidad real responde a 0 (verificado en COM5)

const SEP = '^';       // separador de campos en el reporte de ventas (0x5E)
const FIN = 'F';       // indicador de fin del reporte

function buildFrame(address, func, data = '') {
  const payload = [address, func, ...Buffer.from(data, 'ascii')];
  const xor = payload.reduce((a, b) => a ^ b, 0);
  return Buffer.from([...payload, xor]);
}

function verifyXOR(frame) {
  if (!frame || frame.length < 2) return false;
  const body = frame.subarray(0, frame.length - 1);
  const recv = frame[frame.length - 1];
  const calc = body.reduce((a, b) => a ^ b, 0);
  return calc === recv;
}

function toHex(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// ---------- Función 1: peso ----------
// Respuesta: payload (sin dir/func/xor) = [6 peso][1 'e'/'i'][6 tara], gramos sin coma.
function parseWeightFn1(frame) {
  const xorOk = verifyXOR(frame);
  const payload = frame.subarray(2, frame.length - 1).toString('ascii');
  const rawWeight = payload.slice(0, 6);
  const estable = payload[6] === 'e';
  const rawTara = payload.slice(7, 13);
  const pesoGramos = rawWeight.startsWith('-')
    ? -parseInt(rawWeight.slice(1), 10)
    : parseInt(rawWeight, 10);
  const taraGramos = parseInt(rawTara, 10);
  return {
    pesoGramos: Number.isFinite(pesoGramos) ? pesoGramos : null,
    pesoKg: Number.isFinite(pesoGramos) ? pesoGramos / 1000 : null,
    estable,
    taraGramos: Number.isFinite(taraGramos) ? taraGramos : null,
    rawHex: toHex(frame),
    xorOk,
  };
}

// ---------- Función 72: reporte de ventas (solo CUORA MAX) ----------
// Construye los 12 dígitos del rango: DDMMAA inicio + DDMMAA fin.
function buildDateRange(d1, m1, a1, d2, m2, a2) {
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(d1) + p2(m1) + p2(a1) + p2(d2) + p2(m2) + p2(a2);
}

// Formato REAL verificado contra la CUORA MAX (2026-06-25, ver _probe-f72 / análisis de trama):
//   - Los tickets se separan con ';' (0x3B), NO van pegados a ancho fijo.
//   - Dentro de cada ticket, 10 campos separados por '^':
//       [0]Id(9) [1]Fecha(DD/MM/AA) [2]Hora(HH:MM:SS) [3]Vend(2) [4]PLU(4) [5]Sector(2)
//       [6]Unidades(4) [7]Gramos(5) [8]Drenado(5) [9]Importe(12)
//   - Importe viene ×1000 (NO ×100 como decía el manual): '000002800000' = $2800,00
//     (confirmado: ticket #386 = pan, 0,100 kg → $2800; venta x unidad #8001 → $3500 redondo).
//   - Unidades solo en unitarios, Gramos solo en pesables (el resto en cero).
const ANCHOS = [9, 8, 8, 2, 4, 2, 4, 5, 5, 12]; // referencia; el parser usa split, no ancho fijo
const ESCALA_IMPORTE = 1000;

// "DD/MM/AA" o "DDMMAA" -> número AAMMDD comparable cronológicamente (para filtrar por rango).
function fechaKey(f) {
  const d = String(f).replace(/\D/g, ''); // saca '/' y ':'
  if (d.length < 6) return NaN;
  const DD = d.slice(0, 2), MM = d.slice(2, 4), AA = d.slice(4, 6);
  return parseInt(AA + MM + DD, 10);
}

// Recibe el payload ASCII (sin dir/func/xor) de la respuesta de F72 y devuelve los tickets.
function parseSalesReport(payloadAscii) {
  let s = String(payloadAscii);
  const idx = s.indexOf(FIN); // por si el firmware cierra con 'F' después del último ';'
  if (idx >= 0) s = s.slice(0, idx);
  const tickets = [];
  for (const rec of s.split(';')) {
    const p = rec.split(SEP);
    if (p.length < 10) continue; // fragmento incompleto / cabecera / cola
    const ticketId = parseInt(p[0], 10);
    if (!Number.isFinite(ticketId)) continue;
    const importeRaw = parseInt(p[9], 10);
    const unidades = parseInt(p[6], 10);
    const gramos = parseInt(p[7], 10);
    const plu = parseInt(p[4], 10);
    tickets.push({
      ticketId,
      fecha: p[1],
      hora: p[2],
      vendedor: parseInt(p[3], 10) || 0,
      plu: Number.isFinite(plu) ? plu : 0,
      sector: parseInt(p[5], 10) || 0,
      tipo: gramos > 0 ? 'PESO' : 'UNIDAD',
      unidades: Number.isFinite(unidades) ? unidades : 0,
      gramos: Number.isFinite(gramos) ? gramos : 0,
      drenado: parseInt(p[8], 10) || 0,
      importeRaw: Number.isFinite(importeRaw) ? importeRaw : 0,
      importe: Number.isFinite(importeRaw) ? importeRaw / ESCALA_IMPORTE : 0,
    });
  }
  return tickets;
}

// Dada una trama completa de respuesta F72 ([Dir][72][datos...F][XOR]) la valida y parsea.
function parseSalesReportFrame(frame) {
  const xorOk = verifyXOR(frame);
  const payload = frame.subarray(2, frame.length - 1).toString('ascii');
  return { xorOk, tickets: parseSalesReport(payload), rawLen: frame.length };
}

// ¿La trama de respuesta de F72 ya está completa? (datos terminan en 'F' y luego 1 byte XOR)
function isReportComplete(buf) {
  if (!buf || buf.length < 5) return false;
  // ...[F][XOR]  → el penúltimo byte es 'F' (0x46) y el XOR cierra
  return buf[buf.length - 2] === 0x46 && verifyXOR(buf);
}

module.exports = {
  BAUD, POLL_MS, ADDRESS, SEP, FIN, ANCHOS, ESCALA_IMPORTE,
  buildFrame, verifyXOR, parseWeightFn1, toHex, fechaKey,
  buildDateRange, parseSalesReport, parseSalesReportFrame, isReportComplete,
};
