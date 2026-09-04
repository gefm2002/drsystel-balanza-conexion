'use strict';
// Catálogo de productos (mock en memoria) para probar el flujo de venta sin backend real.
// Precios en pesos. Los PLUs y precios reproducen los ejemplos de reqNuevos.txt.
// tipo: 'PESO' (vende por kg) | 'UNIDAD' (vende por unidad).

const PRODUCTOS = [
  { plu: 1001, nombre: 'Queso Cremoso',   tipo: 'PESO',   precioKg: 8000 },
  { plu: 1010, nombre: 'Jamón Cocido',    tipo: 'PESO',   precioKg: 9000 },
  { plu: 1020, nombre: 'Salame',          tipo: 'PESO',   precioKg: 12000 },
  { plu: 2005, nombre: 'Coca Cola 2.25L', tipo: 'UNIDAD', precioUnitario: 2500 },
  { plu: 2010, nombre: 'Pan Lactal',      tipo: 'UNIDAD', precioUnitario: 1800 },
];

function buscarProducto(plu) {
  const n = Number(plu);
  return PRODUCTOS.find((p) => p.plu === n) || null;
}

module.exports = { PRODUCTOS, buscarProducto };
