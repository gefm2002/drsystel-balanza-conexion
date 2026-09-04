'use strict';
// UI de la Opción D — Web Serial API: el navegador abre el COM y hace polling de Función 1.
const $ = (id) => document.getElementById(id);
let port = null;
let writer = null;
let reader = null;
let polling = false;
let rxBuf = [];
let rxTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setEstado(txt, cls) {
  const el = $('estado');
  el.className = 'estado ' + cls;
  el.innerHTML = '<span class="dot"></span>' + txt;
}
function log(line) {
  const el = $('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}
function render(d) {
  if (d.pesoKg == null) { log('trama incompleta: ' + d.rawHex); return; }
  $('peso').textContent = d.pesoKg.toFixed(3) + ' kg';
  const tara = (d.taraGramos || 0) / 1000;
  $('tara').textContent = tara.toFixed(3) + ' kg';
  $('neto').textContent = (d.pesoKg - tara).toFixed(3) + ' kg';
  setEstado(d.estable ? 'Estable' : 'Inestable', d.estable ? 'verde' : 'amarillo');
  $('xor').innerHTML = d.xorOk ? '<span class="ok">XOR ✓</span>' : '<span class="bad">XOR ✗</span>';
  $('hex').textContent = 'trama: ' + (d.rawHex || '—');
  log(`${new Date().toLocaleTimeString()}  ${d.pesoKg.toFixed(3)}kg ${d.estable ? 'E' : 'I'}  [${d.rawHex}]`);
}

// framing por silencio (~5ms): junta bytes y procesa la trama cuando se hace silencio
function pushBytes(value) {
  for (const b of value) rxBuf.push(b);
  if (rxTimer) clearTimeout(rxTimer);
  rxTimer = setTimeout(() => {
    if (!rxBuf.length) return;
    const frame = new Uint8Array(rxBuf);
    rxBuf = [];
    render(Cuora.parseWeightFn1(frame));
  }, 15);
}

async function readLoop() {
  reader = port.readable.getReader();
  try {
    while (port.readable && polling) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) pushBytes(value);
    }
  } catch (e) { log('read error: ' + e.message); }
  finally { try { reader.releaseLock(); } catch (_) {} }
}

async function pollLoop() {
  const enq = Cuora.buildFrame(Cuora.ADDRESS, 1); // Función 1 = pedir peso
  while (polling) {
    try { await writer.write(enq); }
    catch (e) { log('write error: ' + e.message); break; }
    await sleep(Cuora.POLL_MS);
  }
}

$('conectar').onclick = async () => {
  if (!('serial' in navigator)) { alert('Web Serial no soportado. Usá Chrome o Edge sobre http://localhost'); return; }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: Cuora.BAUD, dataBits: 8, parity: 'none', stopBits: 1 });
    writer = port.writable.getWriter();
    polling = true;
    setEstado('Conectado (esperando peso…)', 'amarillo');
    log('Puerto abierto @' + Cuora.BAUD);
    $('conectar').disabled = true;
    $('desconectar').disabled = false;
    readLoop();
    pollLoop();
  } catch (e) { log('Error al conectar: ' + e.message); }
};

$('desconectar').onclick = async () => {
  polling = false;
  try { if (reader) await reader.cancel(); } catch (_) {}
  try { if (writer) writer.releaseLock(); } catch (_) {}
  try { if (port) await port.close(); } catch (_) {}
  port = writer = reader = null;
  setEstado('Desconectado', 'rojo');
  $('conectar').disabled = false;
  $('desconectar').disabled = true;
  log('Desconectado');
};
