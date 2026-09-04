'use strict';
// UI del flujo de venta (Opción A). Máquina de estados + mapeo de teclas:
//   tecla "1"  = agregar artículo actual al carrito
//   Enter      = cerrar venta (o, si el campo PLU tiene texto, buscar ese PLU)
//   Esc        = cancelar artículo en curso
// La balanza solo aporta el peso (Función 1 por WS). Todo lo demás es PC/UI.

const $ = (id) => document.getElementById(id);

// --- Estado del flujo ---
let estado = 'ESPERANDO_PLU';     // ESPERANDO_PLU | ESPERANDO_PESO_ESTABLE | ESPERANDO_CANTIDAD
let prodActual = null;            // producto cargado por PLU
let ultimoPeso = null;            // último JSON de peso recibido por WS

// --- Helpers UI ---
function log(line) { const el = $('log'); el.textContent += line + '\n'; el.scrollTop = el.scrollHeight; }
function dinero(n) { return '$' + Number(n).toLocaleString('es-AR'); }
function setFase(f, msg) { estado = f; $('fase').textContent = f; if (msg != null) $('msg').innerHTML = msg; }

function setEstadoPeso(txt, cls) {
  const el = $('estadoPeso');
  el.className = 'estado ' + cls;
  el.innerHTML = '<span class="dot"></span>' + txt;
}

// Habilita la tecla/botón "Agregar" según el estado y la estabilidad del peso.
function refrescarBotonAgregar() {
  const btn = $('btnAgregar');
  if (estado === 'ESPERANDO_PESO_ESTABLE') {
    const estable = !!(ultimoPeso && ultimoPeso.estable && ultimoPeso.pesoKg != null);
    btn.disabled = !estable;
    btn.textContent = estable
      ? `Agregar ${ultimoPeso.pesoKg.toFixed(3)} kg al carrito (tecla 1)`
      : 'Esperando peso estable…';
  } else if (estado === 'ESPERANDO_CANTIDAD') {
    btn.disabled = false;
    btn.textContent = 'Agregar al carrito (tecla 1)';
  } else {
    btn.disabled = true;
    btn.textContent = 'Agregar al carrito (tecla 1)';
  }
}

// --- WebSocket: peso en vivo ---
function render(d) {
  if (!d) return;
  if (d.connected === false || d.error) {
    setEstadoPeso(d.error ? 'Error: ' + d.error : 'Desconectado', 'rojo');
    if (d.connected === false) { $('peso').textContent = '— kg'; ultimoPeso = null; refrescarBotonAgregar(); }
    return;
  }
  if (d.pesoKg != null) {
    ultimoPeso = d;
    $('peso').textContent = d.pesoKg.toFixed(3) + ' kg';
    setEstadoPeso(d.estable ? 'Estable' : 'Inestable', d.estable ? 'verde' : 'amarillo');
    $('hex').textContent = 'trama: ' + (d.rawHex || '—') + (d.xorOk ? '  ✓' : '  ✗');
    refrescarBotonAgregar();
  } else if (d.estado === 'conectado') {
    setEstadoPeso('Conectado (esperando peso…)', 'amarillo');
  }
}
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => { setEstadoPeso('Desconectado', 'rojo'); setTimeout(connectWS, 1500); };
}

// --- Paso 1: buscar PLU ---
async function buscarPLU() {
  const plu = $('plu').value.trim();
  if (!plu) return;
  try {
    const r = await fetch('/producto/' + encodeURIComponent(plu));
    if (!r.ok) { const e = await r.json(); $('msg').innerHTML = '<span class="bad">' + (e.error || 'PLU no encontrado') + '</span>'; return; }
    prodActual = await r.json();
    log(`PLU ${prodActual.plu} → ${prodActual.nombre} (${prodActual.tipo})`);
    if (prodActual.tipo === 'PESO') {
      $('panelCantidad').style.display = 'none';
      $('panelPlu').style.display = 'none';
      setFase('ESPERANDO_PESO_ESTABLE',
        `<b>${prodActual.nombre}</b> · ${dinero(prodActual.precioKg)}/kg — <b>Coloque el producto en la balanza</b> y presione <span class="kbd">1</span> cuando esté estable.`);
      $('plu').blur(); // sacar foco para que la tecla "1" agregue (no escriba)
    } else {
      $('panelPlu').style.display = 'none';
      $('panelCantidad').style.display = 'flex';
      $('cantidad').value = 1;
      setFase('ESPERANDO_CANTIDAD',
        `<b>${prodActual.nombre}</b> · ${dinero(prodActual.precioUnitario)}/u — Ingrese cantidad y presione <span class="kbd">1</span>.`);
      $('plu').blur();
    }
    refrescarBotonAgregar();
  } catch (e) { log('error buscarPLU: ' + e.message); }
}

// --- Paso 2: agregar artículo al carrito (tecla 1) ---
async function agregarItem() {
  if (!prodActual) return;
  let body;
  if (estado === 'ESPERANDO_PESO_ESTABLE') {
    if (!ultimoPeso || !ultimoPeso.estable) { log('peso inestable: no se agrega'); return; }
    body = { productoId: prodActual.plu, tipoEntrada: 'PESO', pesoKg: ultimoPeso.pesoKg };
  } else if (estado === 'ESPERANDO_CANTIDAD') {
    const cant = parseInt($('cantidad').value, 10);
    body = { productoId: prodActual.plu, tipoEntrada: 'UNIDAD', cantidad: cant };
  } else {
    return; // en ESPERANDO_PLU la tecla 1 no agrega
  }
  try {
    const r = await fetch('/carrito/item', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { $('msg').innerHTML = '<span class="bad">' + (d.error || 'error') + '</span>'; log('rechazo backend: ' + d.error); return; }
    log(`+ ${d.item.nombre}  →  ${dinero(d.item.total)}`);
    pintarCarrito(d.carrito);
    volverAEsperarPLU();
  } catch (e) { log('error agregarItem: ' + e.message); }
}

// --- Cancelar artículo en curso (Esc) ---
function volverAEsperarPLU() {
  prodActual = null;
  $('panelCantidad').style.display = 'none';
  $('panelPlu').style.display = 'flex';
  setFase('ESPERANDO_PLU', 'Ingresá el próximo PLU, o <span class="kbd">Enter</span> / <b>Nueva venta</b> para cerrar.');
  $('plu').value = '';
  $('plu').focus();
  refrescarBotonAgregar();
}

// --- Cerrar venta (Enter / Nueva venta) ---
async function cerrarVenta() {
  try {
    const r = await fetch('/venta/cerrar', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { log('no se cerró: ' + d.error); return; }
    log(`=== VENTA CERRADA · ticket #${d.ticket} · ${d.items.length} items · TOTAL ${dinero(d.total)} ===`);
    $('msg').innerHTML = `<span class="ok">Venta #${d.ticket} registrada — ${dinero(d.total)}. Nueva venta lista.</span>`;
    pintarCarrito({ items: [], total: 0 });
    volverAEsperarPLU();
  } catch (e) { log('error cerrarVenta: ' + e.message); }
}

// --- Pintar carrito ---
function pintarCarrito(c) {
  const tb = $('carrito');
  tb.innerHTML = '';
  c.items.forEach((it, i) => {
    const detalle = it.tipo === 'PESO' ? `${it.pesoKg.toFixed(3)} kg × ${dinero(it.precioKg)}/kg` : `×${it.cantidad} × ${dinero(it.precioUnitario)}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${it.nombre}</td><td>${detalle}</td><td class="num">${dinero(it.total)}</td>` +
      `<td><button class="del" data-i="${i}" title="Quitar">×</button></td>`;
    tb.appendChild(tr);
  });
  $('total').textContent = dinero(c.total);
}
async function quitarItem(i) {
  try {
    const r = await fetch('/carrito/item/' + i, { method: 'DELETE' });
    const d = await r.json();
    if (r.ok) pintarCarrito(d.carrito);
  } catch (e) { log('error quitarItem: ' + e.message); }
}

// --- Eventos de botones ---
$('btnBuscar').onclick = buscarPLU;
$('btnAgregar').onclick = agregarItem;
$('btnCancelar').onclick = () => { if (estado !== 'ESPERANDO_PLU') volverAEsperarPLU(); };
$('btnCerrar').onclick = cerrarVenta;
$('menos').onclick = () => { const c = $('cantidad'); c.value = Math.max(1, (parseInt(c.value, 10) || 1) - 1); };
$('mas').onclick = () => { const c = $('cantidad'); c.value = (parseInt(c.value, 10) || 1) + 1; };
$('carrito').addEventListener('click', (e) => { if (e.target.classList.contains('del')) quitarItem(e.target.dataset.i); });

// --- Mapeo de teclas global ---
function esCampoTexto(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // En el campo PLU con texto → buscar; en cualquier otro caso → cerrar venta.
    if (document.activeElement === $('plu') && $('plu').value.trim()) { e.preventDefault(); buscarPLU(); }
    else { e.preventDefault(); cerrarVenta(); }
    return;
  }
  if (e.key === 'Escape') {
    if (estado !== 'ESPERANDO_PLU') { e.preventDefault(); volverAEsperarPLU(); }
    return;
  }
  if (e.key === '1') {
    // Si estoy escribiendo en un campo de texto (PLU o cantidad), dejo que se escriba el "1".
    if (esCampoTexto(document.activeElement)) return;
    if (estado === 'ESPERANDO_PESO_ESTABLE' || estado === 'ESPERANDO_CANTIDAD') {
      e.preventDefault();
      agregarItem();
    }
  }
});

// --- Init ---
async function init() {
  try {
    const est = await (await fetch('/estado')).json();
    $('modo').textContent = est.simulando ? 'MODO SIMULADOR' : ('COM ' + est.comPort);
    if (est.simulando) $('panelSim').style.display = 'block';
  } catch (e) { /* ignore */ }
  pintarCarrito({ items: [], total: 0 });
  volverAEsperarPLU();
  connectWS();
}
$('btnSim').onclick = async () => {
  const body = { gramos: Number($('simGramos').value), estable: $('simEstable').checked, taraGramos: Number($('simTara').value) };
  try { await fetch('/sim/peso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); log('sim → ' + JSON.stringify(body)); }
  catch (e) { log('error sim: ' + e.message); }
};
init();
