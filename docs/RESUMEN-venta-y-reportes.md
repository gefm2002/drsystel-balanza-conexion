# Resumen — Flujo de venta y reportes con balanza Systel Cuora MAX ST

> Sesión 2026-06-24. Base: la conexión que funcionó es la **Alternativa 1 / Opción A**
> (`pruebas-conexion/01-bridge-local/`), verificada con balanza real el 2026-06-23.

---

## Qué se hizo (resumido)

1. **Flujo de venta sobre la Alternativa 1** (`01-bridge-local/`): catálogo mock, carrito,
   validación/cálculo en backend, máquina de estados y mapeo de teclas (`1` agregar, Enter/Nueva
   venta cerrar, Esc cancelar). Simulador de peso para probar sin balanza.
   - Docs: `01-bridge-local/SPEC-flujo-venta.md` y `01-bridge-local/CASOS-DE-USO-venta.md`.

2. **Definición de los dos enfoques posibles** (limitación del protocolo Cuora MAX, que es
   maestro-esclavo y solo expone peso en vivo; la balanza no puede enviar el PLU/teclas en vivo —
   Función 3 deshabilitada, campo de F23 "balanza→PC" reservado pero sin implementar):
   - **ERP manda** (en vivo): balanza = solo peso; PLU/teclas/carrito en la PC. → Alternativa 1.
   - **Balanza manda** (diferido): el operario vende en la balanza; el ERP importa las ventas. → Alternativa 1.1.

3. **Alternativa 1.1** (nueva, ver abajo): agrega reportes de venta (F72), cierre (F32) y un
   **bucle de polling** que asienta las ventas en casi-tiempo-real, manteniendo el peso (F1) en vivo.

---

## Alternativa creada

### Ruta
`pruebas-conexion/01.1-bridge-reportes/`

### En qué consiste
Extiende la Alternativa 1 (bridge local COM @115200 → REST + WebSocket). En un solo proceso:
- **Función 1 — peso en vivo** (se mantiene igual que la 1.0, por WebSocket).
- **Función 72 — reporte de ventas** (solo Cuora MAX): trae los tickets por rango de fechas.
- **Función 32 — cierre** de ventas (destructivo: resetea acumuladores).
- **Bucle de polling de F72 (gateado por inactividad)**: detecta tickets nuevos, los agrupa por
  `ticketId` (una venta = todos los renglones del mismo ticket) y los **asienta** automáticamente,
  empujándolos por WebSocket a la UI. Para no trabar el teclado de la balanza (el firmware es
  monotarea: mientras transmite el reporte completo no atiende teclas), **solo pide F72 cuando la
  balanza está ociosa** (plato vacío + peso estable, detectado del F1 en vivo); si se vende sin parar
  y nunca hay hueco, un **fallback fuerza la consulta a los 90 s**. Válvula manual: `POST /ventas/importar`.

Como la línea serie es maestro-esclavo (un pedido por vez), el bridge **serializa**: en reposo
pollea el peso; al pedir F72/F32 pausa el peso, manda la trama, acumula la respuesta hasta el fin
(`F` + XOR) y reanuda el peso.

> **Bloqueo del teclado durante el polling — RESUELTO (2026-06-25).** Pollear F72 a alta frecuencia
> trababa el teclado (reporte completo = 542 tickets/37 KB/~4 s por vuelta). No se puede acotar: F72
> solo acepta rango de fechas (sin consulta incremental) y "solo hoy" = reporte completo igual. Se
> resolvió con el gate por inactividad + fallback descrito arriba. Detalle en el README de la 1.1,
> sección "✅ RESUELTO — polling de F72 vs teclado".

Archivos clave: `bridge.js` (orquestación), `protocol.js` (F1 + parseo F72), `simulator.js`
(peso + tickets simulados), `public/index.html` (peso), `public/reportes.html` + `reportes.js`
(reportes + ventas asentadas). Detalle completo en `01.1-bridge-reportes/README.md`.

### Por qué la desarrollamos
Para responder al pedido de un flujo donde el operario opera **desde la balanza** (ingresa PLU,
pesa, finaliza) y la venta se asienta en el sistema. El protocolo de la Cuora MAX **no permite el
item-por-item en vivo** (no expone el PLU que se tipea ni eventos de tecla), pero **sí** permite
importar las ventas ya cerradas con la Función 72. La 1.1 implementa ese camino: el operario cierra
el ticket en la balanza y, vía el bucle de F72, la venta aparece en el sistema 1–2 s después — lo
más cercano al "en vivo" que el equipo permite, sin perder el peso en tiempo real de la 1.0.

### Cómo probarla sin balanza
```bash
cd pruebas-conexion/01.1-bridge-reportes
SIMULAR=1 POLL_VENTAS_MS=2000 npm start     # PowerShell: $env:SIMULAR="1"; $env:POLL_VENTAS_MS="2000"; npm start
```
- http://localhost:3001/ → peso en vivo (simulado).
- http://localhost:3001/reportes.html → "Iniciar polling" y "+ Venta nueva" (simula un ticket
  cerrado en la balanza) → se asienta sola a los ~2 s.

Verificado el 2026-06-24 (simulador): peso vivo OK · F72 4 tickets $24.450 XOR ✓ · bucle asienta
demos y detecta ventas nuevas sin duplicar · start/stop OK · peso sigue vivo con el bucle activo.
Verificado el 2026-06-25 (simulador): **gate por inactividad** — plato vacío importa en el hueco,
plato ocupado fuerza por tope (`FALLBACK_MS`), puesta al día al arrancar, `POST /ventas/importar` OK.

---

## Mapa de archivos de la sesión

| Ruta | Qué es |
|---|---|
| `00-conexion-balanza.md` | Guía base del protocolo Cuora (fuente de verdad previa) |
| `pruebas-conexion/docs/SOLUCION-funciona-opcion-A.md` | Por qué la Alternativa 1 funcionó (dirección 0, COM5, 115200) |
| `pruebas-conexion/01-bridge-local/` | **Alternativa 1** — peso + flujo de venta "ERP manda" |
| `pruebas-conexion/01-bridge-local/SPEC-flujo-venta.md` | Especificación del flujo de venta |
| `pruebas-conexion/01-bridge-local/CASOS-DE-USO-venta.md` | Casos de uso (peso / unidad / mixto) |
| `pruebas-conexion/01.1-bridge-reportes/` | **Alternativa 1.1** — peso + F72/F32 + bucle de polling "balanza manda" |
| `pruebas-conexion/01.1-bridge-reportes/README.md` | Detalle de la 1.1 (endpoints, formato F72, bucle) |
| `pruebas-conexion/docs/RESUMEN-venta-y-reportes.md` | **Este documento** |
