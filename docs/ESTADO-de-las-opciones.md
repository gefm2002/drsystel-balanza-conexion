# Estado de las opciones de conexión — Systel Cuora

> Contexto de la prueba (**2026-06-23**): balanza conectada por **USB-B** → aparece como **COM5**
> (FTDI `USB Serial Port`, VID_0403+PID_6001). Parámetros: **115200 / 8 / N / 1**, **dirección 0**.

## Tabla resumen

| Opción | Qué es | Estado | Resultado |
|---|---|---|---|
| **A — Bridge local** (`01-bridge-local`) | Node abre el COM, pollea Función 1 y re-expone REST + WebSocket | ✅ **PROBADA** | **FUNCIONA** — lectura en vivo confirmada (352 g, estable, XOR ✓). Ver [SOLUCION-funciona-opcion-A.md](./SOLUCION-funciona-opcion-A.md) |
| **B — Cuora MAX por TCP/IP** (`02-cuora-max-tcp`) | Socket TCP a la IP de la balanza en red | ⬜ **NO PROBADA** | **No aplica a este escenario** — es solo para Cuora MAX por red; acá la conexión es USB. Quedaría para cuando se use una MAX en red |
| **C — Electron (COM directo)** (`03-desktop-com`) | App de escritorio que abre el COM en el proceso principal (IPC, sin HTTP) | ⬜ **NO PROBADA** | Debería funcionar sobre COM5 aplicando el **mismo fix de dirección (`ADDRESS = 0`)`** |
| **D — Web Serial API** (`04-web-serial`) | El navegador (Chrome/Edge) abre el COM con `navigator.serial` | ⬜ **NO PROBADA** | Debería funcionar sobre COM5 con el **mismo fix de dirección**; frágil para producción |

## Detalle

### ✅ A — Bridge local — FUNCIONA (elegida)
Probada de punta a punta. Se corrigió la dirección (1 → **0**) y empezó a leer peso en vivo.
Recomendada para DrSystel web porque el navegador/ERP solo consume HTTP/WS.
Documentación completa: **[SOLUCION-funciona-opcion-A.md](./SOLUCION-funciona-opcion-A.md)**.

### ⬜ B — TCP/IP — NO probada (fuera de alcance)
Requiere balanza **Cuora MAX con red**. En esta prueba la balanza está por **USB**, así que no
corresponde. Además el puerto TCP (`4000`) es un placeholder a confirmar en el manual (Anexos VI-VII).

### ⬜ C — Electron — NO probada
Mismo protocolo serial que la Opción A. Para probarla: `npm install` (baja el binario de Electron),
poner `ADDRESS = 0` en su `protocol.js`, y `$env:COM_PORT="COM5"; npm start`.

### ⬜ D — Web Serial — NO probada
Solo Chrome/Edge, requiere `http://localhost` o HTTPS y permiso manual del usuario para elegir el COM.
Para probarla: aplicar `ADDRESS = 0` en su `protocol.js` y servir en `http://localhost:5004`.

## Hallazgo transversal (aplica a A, C y D)

El síntoma **"conecta pero no da peso"** se debía a que el protocolo polleaba la **dirección 1**;
la unidad real responde a la **dirección 0**. Cualquier opción sobre COM necesita `ADDRESS = 0`.
DTR/RTS resultaron indiferentes; baudrate 115200 correcto.
