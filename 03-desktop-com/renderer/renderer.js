'use strict';
// UI de la Opción C — recibe el peso por IPC (window.balanza expuesto en preload.js)
const $ = (id) => document.getElementById(id);

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

window.balanza.onEstado((d) => {
  if (d.connected) setEstado('Conectado (esperando peso…)', 'amarillo');
  else setEstado(d.error ? 'Error: ' + d.error : 'Desconectado', 'rojo');
  if (d.info) log(d.info);
  if (d.error) log('estado: ' + d.error);
});

window.balanza.onPeso((d) => {
  if (d.error) { log('parse error: ' + d.rawHex); return; }
  if (d.pesoKg == null) return;
  $('peso').textContent = d.pesoKg.toFixed(3) + ' kg';
  const tara = (d.taraGramos || 0) / 1000;
  $('tara').textContent = tara.toFixed(3) + ' kg';
  $('neto').textContent = (d.pesoKg - tara).toFixed(3) + ' kg';
  setEstado(d.estable ? 'Estable' : 'Inestable', d.estable ? 'verde' : 'amarillo');
  $('xor').innerHTML = d.xorOk ? '<span class="ok">XOR ✓</span>' : '<span class="bad">XOR ✗</span>';
  $('hex').textContent = 'trama: ' + (d.rawHex || '—');
  log(`${new Date(d.ts).toLocaleTimeString()}  ${d.pesoKg.toFixed(3)}kg ${d.estable ? 'E' : 'I'}  [${d.rawHex}]`);
});
