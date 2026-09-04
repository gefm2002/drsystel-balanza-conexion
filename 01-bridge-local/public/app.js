'use strict';
// UI de la Opción A — consume WebSocket (peso en vivo) + REST /peso (captura puntual)
const $ = (id) => document.getElementById(id);
let ws;

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
  if (!d) return;
  if (d.connected === false || d.error) {
    setEstado(d.error ? 'Error: ' + d.error : 'Desconectado', 'rojo');
    return;
  }
  if (d.pesoKg != null) {
    $('peso').textContent = d.pesoKg.toFixed(3) + ' kg';
    const tara = (d.taraGramos || 0) / 1000;
    $('tara').textContent = tara.toFixed(3) + ' kg';
    $('neto').textContent = (d.pesoKg - tara).toFixed(3) + ' kg';
    setEstado(d.estable ? 'Estable' : 'Inestable', d.estable ? 'verde' : 'amarillo');
    $('xor').innerHTML = d.xorOk ? '<span class="ok">XOR ✓</span>' : '<span class="bad">XOR ✗</span>';
    $('hex').textContent = 'trama: ' + (d.rawHex || '—');
    log(`${new Date(d.ts).toLocaleTimeString()}  ${d.pesoKg.toFixed(3)}kg ${d.estable ? 'E' : 'I'}  [${d.rawHex}]`);
  } else if (d.estado === 'conectado') {
    setEstado('Conectado (esperando peso…)', 'amarillo');
  }
}
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => log('WS conectado');
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => { setEstado('Desconectado', 'rojo'); log('WS cerrado, reintentando…'); setTimeout(connect, 1500); };
  ws.onerror = () => log('WS error');
}
$('capturar').onclick = async () => {
  try {
    const r = await fetch('/peso');
    const d = await r.json();
    log('REST /peso → ' + JSON.stringify(d));
    if (!d.error) render(d);
  } catch (e) { log('REST error ' + e.message); }
};
connect();
