'use strict';
// Lógica de venta: validar + calcular cada renglón, mantener el carrito en memoria,
// y cerrar la venta. El backend es la ÚNICA fuente de verdad del importe (regla de la SPEC).

const { buscarProducto } = require('./catalogo');

let carrito = [];          // [{ plu, nombre, tipo, tipoEntrada, pesoKg?, cantidad?, total }]
let ticketSeq = 1;         // numerador simple de tickets (en memoria)

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Valida la entrada contra el tipo real del producto y calcula el total.
// Lanza Error con .status=400 si la combinación es inválida (la SPEC exige rechazarlas).
function calcularItem({ productoId, tipoEntrada, pesoKg, cantidad }) {
  const prod = buscarProducto(productoId);
  if (!prod) {
    const e = new Error(`PLU ${productoId} no existe en el catálogo`);
    e.status = 404;
    throw e;
  }
  if (tipoEntrada && tipoEntrada !== prod.tipo) {
    const e = new Error(`tipoEntrada=${tipoEntrada} no coincide con el tipo real del producto (${prod.tipo})`);
    e.status = 400;
    throw e;
  }

  if (prod.tipo === 'PESO') {
    if (cantidad != null) {
      const e = new Error('producto por PESO: no debe enviarse cantidad');
      e.status = 400;
      throw e;
    }
    const kg = Number(pesoKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      const e = new Error('producto por PESO: pesoKg debe ser > 0');
      e.status = 400;
      throw e;
    }
    const total = round2(kg * prod.precioKg);
    return { plu: prod.plu, nombre: prod.nombre, tipo: 'PESO', tipoEntrada: 'PESO', pesoKg: kg, precioKg: prod.precioKg, total };
  }

  // UNIDAD
  if (pesoKg != null) {
    const e = new Error('producto por UNIDAD: no debe enviarse pesoKg');
    e.status = 400;
    throw e;
  }
  const cant = Number(cantidad);
  if (!Number.isInteger(cant) || cant <= 0) {
    const e = new Error('producto por UNIDAD: cantidad debe ser un entero > 0');
    e.status = 400;
    throw e;
  }
  const total = round2(cant * prod.precioUnitario);
  return { plu: prod.plu, nombre: prod.nombre, tipo: 'UNIDAD', tipoEntrada: 'UNIDAD', cantidad: cant, precioUnitario: prod.precioUnitario, total };
}

function totalCarrito() {
  return round2(carrito.reduce((a, it) => a + it.total, 0));
}

function getCarrito() {
  return { items: carrito.slice(), total: totalCarrito() };
}

function agregarItem(body) {
  const item = calcularItem(body);
  carrito.push(item);
  return { item, carrito: getCarrito() };
}

function quitarItem(idx) {
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= carrito.length) {
    const e = new Error('índice de renglón inválido');
    e.status = 400;
    throw e;
  }
  carrito.splice(i, 1);
  return { carrito: getCarrito() };
}

function cerrarVenta(ts) {
  if (carrito.length === 0) {
    const e = new Error('no se puede cerrar una venta con el carrito vacío');
    e.status = 400;
    throw e;
  }
  const venta = {
    ticket: ticketSeq++,
    items: carrito.slice(),
    total: totalCarrito(),
    ts: ts || null,
  };
  carrito = []; // vaciar para la próxima venta
  return venta;
}

module.exports = { calcularItem, agregarItem, quitarItem, getCarrito, cerrarVenta };
