'use strict';
// Simulador para probar SIN balanza:
//  - Peso (Función 1): sintetiza la misma trama que la balanza real.
//  - Reporte de ventas (Función 72): sintetiza un stream de tickets '^...F' + XOR.
// Todo pasa por los MISMOS parsers que el hardware (parseWeightFn1 / parseSalesReportFrame).

const { SEP, FIN } = require('./protocol');

const RESP_ADDR = 0x14; // dirección que devolvió la unidad real en la respuesta (ver SOLUCION-funciona-opcion-A.md)

// ---------- Peso (F1) ----------
function fmt6(gramos) {
  const g = Math.trunc(gramos);
  if (g < 0) return '-' + String(Math.min(99999, -g)).padStart(5, '0');
  return String(Math.min(999999, g)).padStart(6, '0');
}
function buildWeightResponse(gramos, estable, taraGramos) {
  const bytes = [RESP_ADDR, 0x01];
  for (const ch of fmt6(gramos)) bytes.push(ch.charCodeAt(0));
  bytes.push((estable ? 'e' : 'i').charCodeAt(0));
  for (const ch of fmt6(taraGramos || 0)) bytes.push(ch.charCodeAt(0));
  bytes.push(bytes.reduce((a, b) => a ^ b, 0));
  return Buffer.from(bytes);
}
let sim = { gramos: 0, estable: true, taraGramos: 0 };
function setSim({ gramos, estable, taraGramos }) {
  if (gramos != null) sim.gramos = Number(gramos);
  if (estable != null) sim.estable = !!estable;
  if (taraGramos != null) sim.taraGramos = Number(taraGramos);
  return { ...sim };
}
function currentFrame() { return buildWeightResponse(sim.gramos, sim.estable, sim.taraGramos); }

// ---------- Reporte de ventas (F72) ----------
const pad = (n, w) => String(n).padStart(w, '0');

// arma un ticket con el layout REAL: 10 campos '^', PLU de 4, importe ×1000 (ver protocol.js).
function buildTicket(t) {
  const campos = [
    pad(t.ticketId, 9),
    t.fecha,                 // "DD/MM/AA" (8)
    t.hora,                  // "HH:MM:SS" (8)
    pad(t.vendedor, 2),
    pad(t.plu, 4),
    pad(t.sector, 2),
    pad(t.unidades || 0, 4),
    pad(t.gramos || 0, 5),
    pad(t.drenado || 0, 5),
    pad(t.importeRaw, 12),   // pesos ×1000
  ];
  return campos.join(SEP);
}

// Tickets de ejemplo (mezcla peso + unidad). importeRaw = pesos ×1000 (formato real CUORA MAX).
const TICKETS_DEMO = [
  { ticketId: 1, fecha: '01/06/26', hora: '09:15:03', vendedor: 1, plu: 1001, sector: 1, unidades: 0, gramos: 1250, drenado: 0, importeRaw: 10000000 }, // Queso 1.250kg = $10.000
  { ticketId: 2, fecha: '01/06/26', hora: '09:16:40', vendedor: 1, plu: 2005, sector: 2, unidades: 2, gramos: 0,    drenado: 0, importeRaw: 5000000 },  // Coca x2 = $5.000
  { ticketId: 3, fecha: '01/06/26', hora: '10:02:11', vendedor: 2, plu: 1010, sector: 1, unidades: 0, gramos: 450,  drenado: 0, importeRaw: 4050000 },  // Jamón 0.450kg = $4.050
  { ticketId: 4, fecha: '02/06/26', hora: '11:30:55', vendedor: 1, plu: 2010, sector: 2, unidades: 3, gramos: 0,    drenado: 0, importeRaw: 5400000 },  // Pan x3 = $5.400
];

let ticketsSim = TICKETS_DEMO.slice();
function setVentasSim(tickets) {
  if (Array.isArray(tickets)) ticketsSim = tickets;
  return ticketsSim;
}

// Simula que el operario cerró una venta NUEVA en la balanza: agrega un ticket con id auto-incremental.
// Sirve para probar el bucle de polling de F72 (el loop lo detectará como nuevo y lo asentará).
function addVentaSim(opts = {}) {
  const nextId = ticketsSim.reduce((m, t) => Math.max(m, t.ticketId), 0) + 1;
  const tipo = (opts.tipo === 'UNIDAD' || opts.tipo === 'PESO') ? opts.tipo : (opts.gramos ? 'PESO' : 'UNIDAD');
  const gramos = tipo === 'PESO' ? Number(opts.gramos || 500) : 0;
  const unidades = tipo === 'UNIDAD' ? Number(opts.unidades || 1) : 0;
  const importeRaw = opts.importeRaw != null ? Number(opts.importeRaw)
    : opts.importe != null ? Math.round(Number(opts.importe) * 1000)
    : 1000000;
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const t = {
    ticketId: nextId,
    fecha: `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`,
    hora: `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`,
    vendedor: Number(opts.vendedor || 1),
    plu: Number(opts.plu || (tipo === 'PESO' ? 1001 : 2005)),
    sector: Number(opts.sector || (tipo === 'PESO' ? 1 : 2)),
    unidades, gramos, drenado: 0, importeRaw,
  };
  ticketsSim.push(t);
  return t;
}

// arma la trama completa de respuesta F72: [Dir][72][ticket1;ticket2;...;F][XOR]  (separador ';' real)
function buildSalesReportFrame() {
  const datos = ticketsSim.map(buildTicket).join(';') + ';' + FIN;
  const bytes = [RESP_ADDR, 72, ...Buffer.from(datos, 'ascii')];
  bytes.push(bytes.reduce((a, b) => a ^ b, 0));
  return Buffer.from(bytes);
}

module.exports = {
  buildWeightResponse, setSim, currentFrame, getSim: () => ({ ...sim }),
  buildTicket, buildSalesReportFrame, setVentasSim, addVentaSim, getVentasSim: () => ticketsSim.slice(), TICKETS_DEMO,
};
