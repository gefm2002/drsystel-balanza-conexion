'use strict';
// UI de Caja/Cobro (tab superior) + Reporte de ventas F72 / cierre F32 (tab inferior).
const $ = (id) => document.getElementById(id);
function log(l){ const e=$('log'); if(!e) return; e.textContent += l+'\n'; e.scrollTop=e.scrollHeight; }
function dinero(n){ return '$' + Number(n).toLocaleString('es-AR'); }

// Descripción de producto: F72 no trae nombre (es dato de PLU/maestro de artículos, no de la balanza).
// Placeholder por ahora: "Prod <PLU>". Cuando exista el maestro de artículos se reemplaza por el nombre real.
function descProd(it){ return 'Prod ' + (it.plu != null ? it.plu : '?'); }
// Valor unitario de referencia: $/kg para venta por peso, $/u para venta por unidad.
function valorUnit(it){
  if (it.tipo === 'PESO'){ const kg = (it.gramos||0)/1000; return kg > 0 ? it.importe/kg : 0; }
  return (it.unidades||0) > 0 ? it.importe/it.unidades : 0;
}
function pesoTxt(it){ return it.tipo === 'PESO' ? ((it.gramos||0)/1000).toFixed(3)+' kg' : '×'+(it.unidades||0)+' u'; }

// ---------------- Tab inferior: consulta de ventas (F72) ----------------
// Clave cronológica para ordenar: fecha 'DD/MM/AA' + hora 'HH:MM:SS' → número YYMMDDHHMMSS comparable.
function cronoKey(t){
  const f = (t.fecha || '').split('/'); // [DD, MM, AA]
  const h = (t.hora || '').split(':');  // [HH, MM, SS]
  if (f.length < 3) return -1;
  const n = (s) => String(s || '0').padStart(2, '0');
  return Number(n(f[2]) + n(f[1]) + n(f[0]) + n(h[0]) + n(h[1]) + n(h[2]));
}

function pintar(data){
  const tb = $('tbody'); tb.innerHTML = '';
  // Más nuevo → más viejo: por fecha+hora desc, y ticketId desc como desempate.
  const filas = [...(data.tickets || [])].sort((a, b) => (cronoKey(b) - cronoKey(a)) || ((b.ticketId||0) - (a.ticketId||0)));
  filas.forEach((t) => {
    const cantPeso = t.tipo === 'PESO' ? (t.gramos/1000).toFixed(3)+' kg' : '×'+t.unidades;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${t.ticketId}</td><td>${t.fecha}</td><td>${t.hora}</td><td>${t.vendedor}</td>`+
      `<td>${t.plu}</td><td><span class="tag ${t.tipo.toLowerCase()}">${t.tipo}</span></td>`+
      `<td class="num">${cantPeso}</td><td class="num">${dinero(t.importe)}</td>`;
    tb.appendChild(tr);
  });
  $('total').firstChild.textContent = dinero(data.total || 0) + ' ';
  $('count').textContent = `(${data.count || 0} tickets)`;
}

async function consultar(){
  const desde = $('desde').value.trim();
  const hasta = $('hasta').value.trim();
  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  try {
    const r = await fetch('/ventas?' + qs.toString());
    const d = await r.json();
    if (!r.ok) { log('error F72: ' + (d.error||r.status)); return; }
    log(`F72 → ${d.count} tickets · total ${dinero(d.total)}`);
    pintar(d);
  } catch (e) { log('error: ' + e.message); }
}

async function cerrar(){
  if (!confirm('Cerrar ventas en la balanza (F32). Esto RESETEA los acumuladores. ¿Continuar?')) return;
  try {
    const r = await fetch('/ventas/cerrar', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { log('error F32: ' + (d.error||r.status)); return; }
    log('F32 → ' + d.mensaje);
  } catch (e) { log('error: ' + e.message); }
}

$('btnConsultar').onclick = consultar;
$('btnCerrar').onclick = cerrar;

// Mostrar el tab inferior (oculto por defecto) y disparar la consulta.
$('tabConsultar').onclick = () => {
  const p = $('panelConsulta');
  const visible = !p.classList.contains('hidden');
  if (visible){ p.classList.add('hidden'); $('tabConsultar').classList.remove('active'); return; }
  p.classList.remove('hidden'); $('tabConsultar').classList.add('active');
  p.scrollIntoView({ behavior:'smooth', block:'start' });
  consultar();
};

// Importar ahora: fuerza una consulta F72 ya (válvula manual, ignora el gate de inactividad).
$('btnImportar').onclick = async () => {
  try {
    const d = await (await fetch('/ventas/importar', { method:'POST' })).json();
    if (d.ok) log(`⤓ importar ahora → ${d.nuevas} venta(s) nueva(s) · total asentadas ${d.total}`);
    else log('importar: ' + (d.error||''));
    refrescarPendientes(); refrescarAsentadas();
  } catch(e){ log('error importar: ' + e.message); }
};

// ---------------- Tab superior · Caja / Cobro ----------------
let cola = [];           // ventas pendientes (FIFO)
let actual = null;       // venta que se está mostrando para cobrar

function pintarCobro(){
  const vacio = $('cobroVacio'), activo = $('cobroActivo');
  $('colaPend').textContent = `${cola.length} en cola`;
  actual = cola[0] || null;
  if (!actual){ vacio.classList.remove('hidden'); activo.classList.add('hidden'); return; }
  vacio.classList.add('hidden'); activo.classList.remove('hidden');
  $('cobroTicket').textContent = '#' + actual.ticketId;
  $('cobroVend').textContent = actual.vendedor;
  $('cobroHora').textContent = actual.hora || '';
  const tb = $('cobroItems'); tb.innerHTML = '';
  actual.items.forEach((it) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><b>${it.plu}</b></td>`+
      `<td>${descProd(it)}</td>`+
      `<td class="num">${pesoTxt(it)}</td>`+
      `<td class="num">${dinero(Math.round(valorUnit(it)))}</td>`+
      `<td class="num">${dinero(it.importe)}</td>`;
    tb.appendChild(tr);
  });
  $('cobroTotal').textContent = dinero(actual.total || 0);
}
async function refrescarPendientes(){
  try { const d = await (await fetch('/ventas/pendientes')).json(); cola = d.pendientes || []; pintarCobro(); } catch(e){}
}
async function confirmarActual(){
  if (!actual) return;
  const id = actual.id;
  const medioPago = $('medioPago').value;
  try {
    const r = await fetch('/ventas/confirmar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, medioPago }) });
    const d = await r.json();
    if (!r.ok) { log('error cobro: ' + (d.error||r.status)); return; }
    const mp = d.venta && d.venta.medioPago === 'TARJ' ? 'Tarjeta' : 'Efectivo';
    log(`✓ COBRADA venta ${id} · ${dinero(d.venta.total)} · ${mp}`);
    refrescarPendientes(); refrescarAsentadas();
  } catch(e){ log('error cobro: ' + e.message); }
}
async function cancelarActual(){
  if (!actual) return;
  const id = actual.id;
  try {
    const r = await fetch('/ventas/cancelar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    const d = await r.json();
    if (!r.ok) { log('error cancelar: ' + (d.error||r.status)); return; }
    log(`✕ CANCELADA venta ${id}`);
    refrescarPendientes(); refrescarAsentadas();
  } catch(e){ log('error cancelar: ' + e.message); }
}
$('btnConfirmar').onclick = confirmarActual;
$('btnCancelar').onclick = cancelarActual;
// Atajos del cajero: E = Efectivo · T = Tarjeta · Enter = confirmar · Esc = cancelar.
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // no robar el teclado de los filtros
  if (!actual) return;
  const k = e.key.toLowerCase();
  if (k === 'e') { $('medioPago').value = 'EF'; }
  else if (k === 't') { $('medioPago').value = 'TARJ'; }
  else if (e.key === 'Enter') { e.preventDefault(); confirmarActual(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelarActual(); }
});

// ---------------- Bucle de polling de F72: ventas asentadas (historial) ----------------
function pintarAsentadas(data){
  const tb = $('tbodyAsentadas'); tb.innerHTML = '';
  // Más nuevo → más viejo: por momento de asentado desc (desempate por ticketId desc).
  const lista = [...(data.ventas || [])].sort((a, b) => ((b.asentadaTs||0) - (a.asentadaTs||0)) || ((b.ticketId||0) - (a.ticketId||0)));
  lista.forEach((v) => {
    const renglones = v.items.map((it) => it.tipo === 'PESO'
      ? `${it.plu}:${(it.gramos/1000).toFixed(3)}kg`
      : `${it.plu}:×${it.unidades}`).join('  ');
    const hora = v.asentadaTs ? new Date(v.asentadaTs).toLocaleTimeString() : '';
    const estado = v.estado || 'pendiente';
    const pago = v.medioPago === 'TARJ' ? 'Tarjeta' : v.medioPago === 'EF' ? 'Efectivo' : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${v.ticketId}</td><td>${v.hora}</td><td>${v.vendedor}</td>`+
      `<td>${renglones}</td><td class="num">${dinero(v.total)}</td>`+
      `<td><span class="estado ${estado}">${estado}</span></td><td>${pago}</td><td class="muted">${hora}</td>`;
    tb.appendChild(tr);
  });
  $('totalAsentadas').firstChild.textContent = dinero(data.total || 0) + ' ';
  $('countAsentadas').textContent = `(${data.count || 0} ventas)`;
}
async function refrescarAsentadas(){
  try { const d = await (await fetch('/ventas/asentadas')).json(); pintarAsentadas(d); } catch(e){}
}
function setPollDot(activo, ms){
  const el = $('pollDot');
  el.style.background = activo ? '#11341f' : '#3a1d1d';
  el.style.color = activo ? '#3fb950' : '#f85149';
  el.textContent = activo ? `● activo (${ms} ms)` : '● detenido';
}
$('btnPollStart').onclick = async () => {
  const intervaloMs = Number($('intervalo').value) || 2000;
  try {
    const d = await (await fetch('/polling/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ intervaloMs }) })).json();
    setPollDot(true, d.intervaloMs); log('polling F72 iniciado cada ' + d.intervaloMs + ' ms');
  } catch(e){ log('error start: ' + e.message); }
};
$('btnPollStop').onclick = async () => {
  try { await fetch('/polling/stop', { method:'POST' }); setPollDot(false); log('polling F72 detenido'); } catch(e){}
};
$('btnSimNueva').onclick = async () => {
  const body = {
    tipo: $('simTipo').value,
    plu: $('simPlu').value || undefined,
    importe: $('simImporte').value || undefined,
  };
  if ($('simTipo').value === 'PESO') body.gramos = $('simCant').value || undefined;
  else body.unidades = $('simCant').value || undefined;
  try {
    const d = await (await fetch('/sim/ventas/nueva', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })).json();
    if (d.ok) log(`simulada venta nueva en balanza → ticket #${d.ticket.ticketId}`);
    else log('sim error: ' + (d.error||''));
  } catch(e){ log('error sim: ' + e.message); }
};

// WebSocket: peso (lo ignora) + eventos de venta (nueva / confirmada / cancelada)
function connectWS(){
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch(_) { return; }
    if (!m || !m.tipo) return;
    if (m.tipo === 'venta-nueva') log(`🧾 venta nueva desde balanza: #${m.venta.ticketId} · ${dinero(m.venta.total)} — esperando cobro`);
    if (m.tipo === 'venta-nueva' || m.tipo === 'venta-confirmada' || m.tipo === 'venta-cancelada') {
      refrescarPendientes(); refrescarAsentadas();
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1500);
}

(async () => {
  try {
    const est = await (await fetch('/estado')).json();
    $('modo').textContent = est.simulando ? 'MODO SIMULADOR' : ('COM ' + est.comPort);
    if (est.simulando) $('panelSim').classList.remove('hidden');
  } catch (e) {}
  try { const ps = await (await fetch('/polling/estado')).json(); setPollDot(ps.activo, ps.intervaloMs); } catch(e){}
  refrescarPendientes();
  refrescarAsentadas();
  connectWS();
})();
