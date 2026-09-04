'use strict';
// Protocolo Cuora / Cuora MAX — maestro-esclavo @115200
// Trama: [Dir 1B][Func 1B][Datos NB ASCII][XOR 1B]
// Fuente: conectar/.../enMD/cuora-implementacion-cliente-erp.md

const BAUD = 115200;   // confirmado por el ejemplo oficial Systel (Form1.vb)
const POLL_MS = 400;   // polling de Función 1 (no hay streaming en Cuora)
const ADDRESS = 0;     // dirección de la balanza — la unidad real responde a 0 (verificado por diagnóstico en COM5)

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

// Respuesta Función 1: payload (sin dir/func/xor) = [6 peso][1 'e'/'i'][6 tara], gramos sin coma
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

module.exports = { BAUD, POLL_MS, ADDRESS, buildFrame, verifyXOR, parseWeightFn1, toHex };
