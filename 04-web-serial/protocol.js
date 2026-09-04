'use strict';
// Protocolo Cuora / Cuora MAX — versión navegador (Uint8Array)
// Trama: [Dir 1B][Func 1B][Datos NB ASCII][XOR 1B]
(function (global) {
  function buildFrame(address, func, data = '') {
    const bytes = [address, func];
    for (let i = 0; i < data.length; i++) bytes.push(data.charCodeAt(i) & 0xff);
    let xor = 0;
    for (const b of bytes) xor ^= b;
    bytes.push(xor);
    return new Uint8Array(bytes);
  }

  function verifyXOR(frame) {
    if (!frame || frame.length < 2) return false;
    let xor = 0;
    for (let i = 0; i < frame.length - 1; i++) xor ^= frame[i];
    return xor === frame[frame.length - 1];
  }

  function toHex(a) {
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  function parseWeightFn1(frame) {
    const xorOk = verifyXOR(frame);
    let s = '';
    for (let i = 2; i < frame.length - 1; i++) s += String.fromCharCode(frame[i]);
    const rawWeight = s.slice(0, 6);
    const estable = s[6] === 'e';
    const rawTara = s.slice(7, 13);
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

  // ADDRESS: 0 — la unidad real responde a la dirección 0 (verificado por diagnóstico en COM5)
  global.Cuora = { buildFrame, verifyXOR, parseWeightFn1, toHex, BAUD: 115200, POLL_MS: 400, ADDRESS: 0 };
})(window);
