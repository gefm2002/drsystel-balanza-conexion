'use strict';
// Simulador de balanza para probar SIN hardware.
// Sintetiza una trama REAL de respuesta de Función 1 y la hace pasar por el mismo
// parser que el hardware (parseWeightFn1), así el flujo se prueba de punta a punta.
//
// Trama de respuesta Función 1 (igual que la verificada con balanza real):
//   [Dir 0x14][Func 0x01][6 peso ASCII][ 'e'|'i' ][6 tara ASCII][XOR]

const RESP_ADDR = 0x14; // dirección que devolvió la unidad real en la respuesta (ver SOLUCION-funciona-opcion-A.md)
const FUNC = 0x01;

// formatea gramos a 6 chars ASCII: positivos con ceros a la izquierda; negativos como '-' + 5 dígitos.
function fmt6(gramos) {
  const g = Math.trunc(gramos);
  if (g < 0) return '-' + String(Math.min(99999, -g)).padStart(5, '0');
  return String(Math.min(999999, g)).padStart(6, '0');
}

// construye la trama de respuesta de Función 1 para un peso/estabilidad/tara dados.
function buildWeightResponse(gramos, estable, taraGramos) {
  const bytes = [RESP_ADDR, FUNC];
  for (const ch of fmt6(gramos)) bytes.push(ch.charCodeAt(0));
  bytes.push((estable ? 'e' : 'i').charCodeAt(0));
  for (const ch of fmt6(taraGramos || 0)) bytes.push(ch.charCodeAt(0));
  const xor = bytes.reduce((a, b) => a ^ b, 0);
  bytes.push(xor);
  return Buffer.from(bytes);
}

// Estado del peso simulado (lo cambia POST /sim/peso).
let sim = { gramos: 0, estable: true, taraGramos: 0 };

function setSim({ gramos, estable, taraGramos }) {
  if (gramos != null) sim.gramos = Number(gramos);
  if (estable != null) sim.estable = !!estable;
  if (taraGramos != null) sim.taraGramos = Number(taraGramos);
  return { ...sim };
}

function currentFrame() {
  return buildWeightResponse(sim.gramos, sim.estable, sim.taraGramos);
}

module.exports = { buildWeightResponse, setSim, currentFrame, getSim: () => ({ ...sim }) };
