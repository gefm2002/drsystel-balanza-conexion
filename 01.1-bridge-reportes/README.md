# Alternativa 1.1 — Bridge local: Peso (F1) + Reporte de ventas (F72) + Cierre (F32)

Extiende la **Alternativa 1** (`../01-bridge-local`, la que funcionó con la balanza real). Mantiene la
**Función 1 (peso en vivo)** y suma la **Función 72 (reporte de ventas, solo CUORA MAX)** y la
**Función 32 (cierre)**. Mismo transporte que la 1.0: COM serial @115200, **dirección 0**, trama
`[Dir][Func][Datos][XOR]`.

> Pensada para el enfoque **"balanza manda" (diferido)**: el operador vende en la balanza y el ERP
> **importa** los tickets con F72. Complementa el flujo en vivo de la 1.0 (peso como sensor).

## Correr

```bash
npm install                         # (las deps ya vienen copiadas de la 1.0)
# Modo real (con balanza) — detecta solo el COM del FTDI (VID 0403 / PID 6001):
npm start
# o forzando el puerto:
COM_PORT=COM5 npm start             # PowerShell: $env:COM_PORT="COM5"; npm start
# Modo simulador (sin balanza):
SIMULAR=1 npm start                 # PowerShell: $env:SIMULAR="1"; npm start
```

- **http://localhost:3001/** → peso en vivo (Función 1, igual que la 1.0).
- **http://localhost:3001/reportes.html** → reporte de ventas (Función 72) + cierre (Función 32).

## Endpoints

| Endpoint | Función | Devuelve |
|---|---|---|
| `GET /peso` · `ws://…` | F1 | peso en vivo (se mantiene) |
| `GET /estado` | — | `{ connected, comPort, baud, simulando, mode }` |
| `GET /ventas?desde=DDMMAA&hasta=DDMMAA` | **F72** | `{ tickets:[…], total, count }` (consulta puntual) |
| `POST /ventas/cerrar` | **F32** | ejecuta el cierre (⚠️ destructivo) |
| `GET /ventas/asentadas` | — | ventas detectadas por el bucle, agrupadas por ticket |
| `GET /ventas/pendientes` | — | ventas asentadas en estado `pendiente` (cola de cobro, FIFO) |
| `POST /ventas/confirmar` `{id}` | — | confirma (cobra) una venta pendiente → `confirmada` |
| `POST /ventas/cancelar` `{id}` | — | cancela una venta pendiente → `cancelada` |
| `POST /polling/start` `{intervaloMs,idleMs?,pesoMaxG?,fallbackMs?,desde?,hasta?}` | — | arranca el bucle gateado de F72 |
| `POST /polling/stop` · `GET /polling/estado` | — | detiene / estado del bucle (`{activo,ocioso,segDesdeUltimaImport,…}`) |
| `POST /ventas/importar` | **F72** | fuerza UNA importación ya (válvula manual "Importar ahora") |
| `POST /sim/peso` | — | fija el peso simulado (solo SIMULAR) |
| `POST /sim/ventas/nueva` `{tipo,plu,gramos\|unidades,importe}` | — | simula que el operario cerró una venta nueva en la balanza (solo SIMULAR) |
| `ws://…` `{tipo:'venta-nueva',venta}` | — | push cuando el bucle asienta una venta |

## Bucle de polling de F72 (ventas en casi-tiempo-real)

Enfoque **"balanza manda"**: el operario hace toda la venta en la balanza (PLU, pesa, Vender por
ítem, Total/Finalizar para cerrar el ticket). El bridge **pollea F72** cada N ms, agrupa los
renglones por `ticketId` (una venta = todos los renglones del mismo ticket) y **asienta** los
tickets nuevos, empujándolos por WebSocket a la UI.

- Latencia: la venta aparece en el sistema 1–2 s después de que el operario aprieta **Finalizar**.
- **No** es item-por-item en vivo (el protocolo Cuora MAX no lo permite — ver
  `../docs/` y la discusión de F3/F23). Es el ticket completo, apenas se cierra.
- El bucle **convive con el peso**: cada vuelta de F72 pausa el polling de peso unas décimas y lo reanuda.

Arrancarlo: botón "Iniciar polling" en `reportes.html`, o `POST /polling/start`, o
`POLL_VENTAS_MS=2000 npm start` (auto-arranque).

## Cobro / confirmación ("balanza manda" → sistema)

Sobre el bucle de F72 se agregó el **flujo de cobro**: el operario arma toda la venta en la balanza
(pesa/cuenta los renglones y cierra el ticket); el bridge la detecta, la **asienta como `pendiente`**
y la manda al sistema; en `reportes.html` aparece el **carrito completo "listo para cobrar"** y el
cajero **confirma o cancela**.

- **Estados de una venta:** `pendiente` → `confirmada` (cobrada) | `cancelada`.
- **UI (panel "🧾 Caja — Cobro"):** muestra la venta más vieja en cola (FIFO) con sus renglones y total.
  - **Enter** = confirmar cobro · **Esc** = cancelar (también hay botones). Tras la acción, avanza a la siguiente.
- **API:** `GET /ventas/pendientes`, `POST /ventas/confirmar {id}`, `POST /ventas/cancelar {id}`
  (responden `409` si la venta ya no está pendiente, `404` si el `id` no existe).
- **`id` de venta = `fecha#ticketId`** (clave compuesta). Es importante porque el **cierre F32 de
  CUORA MAX resetea el nº de ticket**: usar solo `ticketId` colisionaría entre días/cierres.
- **Gancho ERP (pendiente):** en `POST /ventas/confirmar` (`bridge.js`) quedó marcado el `// TODO ERP`
  donde, cuando exista el ERP, se empujará la venta (ventas / stock / caja). Hoy solo se asienta local.

#### ✅ Medio de pago por venta — spec acordada (2026-06-25): enfoque (A) "el bridge es la caja"

El medio de pago **no viene de F72** (la balanza no lo sabe): es dato de caja. Se decidió que **el bridge
es la caja** y captura la forma de pago al confirmar. **Flujo de cobro:**

1. La venta llega de la balanza y se asienta con estado **`pendiente`** (bucle de F72, ya implementado).
2. Se **muestra en la interfaz** del sistema con sus **campos automáticos** (lo que trae F72: ítems/PLU,
   cantidades, total, `ticketId`, hora, vendedor).
3. El usuario **revisa** esos campos, **asigna la forma de pago** (Efectivo / Tarjeta / Transferencia) y
   da **Enter**.
4. La venta pasa a **`confirmada`** con su `medioPago`, lista para empujar al POS ya clasificada.

> **⚡ Requisito crítico — VELOCIDAD.** El sistema debe servir la venta con la **mínima latencia** para que
> el usuario cargue la forma de pago sin esperar. **Atención:** el *gate por inactividad* del polling agrega
> demora (espera el hueco; si se vende sin parar, recién el fallback de 90 s → demasiado para una cola de
> cobro veloz). Reconciliar con la **válvula `POST /ventas/importar`** ("Importar ahora") para latencia casi
> inmediata bajo demanda y/o un **`FALLBACK_MS` más corto** en este deployment. A afinar con balanza real.

> **Decisión (2026-06-25):** por ahora se **mantiene el gate por inactividad** (prioridad = no trabar el
> teclado) para **probar cómo se comporta la balanza real**. La tensión con la velocidad de cobro se
> evalúa después, con los datos de esa prueba.

**Actividades pendientes:**
1. **Probar el gate con la balanza real** — confirmar que no traba el teclado y medir la latencia real de
   aparición de la venta (hueco vs fallback); afinar `IDLE_ESTABLE_MS`/`FALLBACK_MS`.
2. **Implementar medio de pago** (spec A): `/ventas/confirmar` (`bridge.js`) acepta y valida `medioPago`
   y lo guarda en la venta (+ broadcast); en `reportes.html`/`reportes.js`, selector de forma de pago en el
   panel "Caja — Cobro" con atajos (**E/T/R** = elegir + confirmar, o seleccionar + Enter).
3. **Cablear el botón "Importar ahora"** → endpoint `POST /ventas/importar` (ya existe).
4. **Resolver la latencia de cobro** según el resultado de (1): válvula manual y/o `FALLBACK_MS` más corto.

Pagos mixtos / vuelto / propina → 2ª etapa; primer corte = **un medio por venta**.

### ¿Cubre el flujo "peso N productos y los veo en el sistema"?

Sí, con una salvedad. Pesás varios productos en **un mismo ticket** y el carrito agrupado muestra,
por cada renglón:

| Dato | ¿Está? | Origen |
|---|---|---|
| Id de producto | ✅ | PLU (campo de F72) |
| Cantidad de cada artículo | ✅ | gramos → kg (o unidades si es por unidad) |
| Precio | ✅ | importe por renglón ($); precio/kg derivable (importe ÷ kg) |
| **Nombre del producto** | ❌ | **F72 no trae el nombre, solo el N° de PLU** |

- Para mostrar el **nombre** hay que sumar un **catálogo PLU→nombre** en el sistema (cargado o
  sincronizado de la balanza con F31/F4). Hoy **no está**; el carrito muestra el número de PLU.
- El agrupamiento por ticket (una venta = todos los renglones con el mismo `ticketId`) ya funciona
  (verificado en simulador: ticket de 3 renglones de peso → carrito de 3 ítems, total correcto).
  **Falta confirmar con la balanza real** que pesar N productos y cerrar una vez genere **un ticket
  con N renglones** (y no N tickets sueltos) — depende del flujo de teclas de la Cuora.

### Estado de validación

**✅ Validado con BALANZA REAL (CUORA MAX, 2026-06-25):** F1 peso en vivo OK · F72 trae el reporte
completo (**542 tickets, 37 KB, XOR ✓**) · parser calibrado contra tickets reales (#386 pan 0,100 kg
= **$2800**, coincide exacto con la pantalla) · filtro por fecha del día OK · **flujo "balanza manda"
end-to-end**: se cierra un ticket en la balanza (#387, #388) y el bucle lo detecta y lo asienta como
`pendiente` solo, en una vuelta de polling. Cobro/cancelación validados antes en simulador.

> **⚠️ El formato real de F72 difiere del manual** — ver "Función 72 — formato" abajo (separador `;`,
> fecha con barras, PLU de 4, importe **×1000** no ×100, terminador `;F`). El parser quedó ajustado a
> lo real (`protocol.js: parseSalesReport`); el simulador emite el mismo formato.

> Pendientes conocidos: nombre de PLU (falta catálogo), medio de pago no viene de F72 (la "caja"
> registra el total del ticket), y el estado vive en RAM (al reiniciar el bridge se re-detectan las
> ventas del día) — persistir cuando se integre el ERP.

### ✅ RESUELTO — polling de F72 vs teclado de la balanza (gate por inactividad + fallback)

**Problema (2026-06-25):** con el bucle de F72 cada 5 s la balanza **no procesa el teclado**. Causa:
cada vuelta trae el **reporte completo** (542 tickets, 37 KB, ~4 s en la línea) y el firmware es
monotarea → mientras transmite no atiende teclas. El peso (F1, 400 ms) **no** traba (trama mínima).

**Por qué NO se puede acotar el reporte (descartado tras revisar el manual):** F72 **solo acepta un
rango de fechas** (manual V7, y tabla §10 del doc de implementación lo marca como *"cierre diario /
bajo demanda"*, nunca loop rápido). **No hay consulta incremental** ("desde el último ticketId"). Y
acotar la fecha **no achica** la trama: en un día con ventas, "solo hoy" *es* el reporte completo. Lo
caro es la **transmisión serial** de los 37 KB, no el parseo → ninguna optimización en JS lo reduce.

**Solución implementada (modo B = gate por inactividad + fallback por tiempo):** como el read es caro
e inevitable, se arquitectura alrededor de él. El bridge ya tiene el peso F1 en vivo; se usa esa señal
para pedir F72 **solo cuando la balanza está ociosa** (plato vacío y peso estable hace un rato = nadie
vendiendo). Si el operario vende sin parar y nunca hay hueco, un **fallback fuerza la consulta a los
90 s** para que ninguna venta quede sin asentar (acepta el bloqueo breve en ese instante). Ninguna
venta se pierde: F72 trae el día completo y el dedup `fecha#ticketId` asienta de golpe lo acumulado.

Complementa la **válvula manual A**: `POST /ventas/importar` fuerza una importación ya (botón
"Importar ahora") cuando el cajero la necesita al instante.

- **`bridge.js`:** `pollVentasTick()` (gate), `actualizarOcio()` (marca el hueco desde el peso),
  `POST /ventas/importar` (a demanda), `GET /polling/estado` ahora reporta `ocioso` y `segDesdeUltimaImport`.
- **Config (env o body de `/polling/start`):** `IDLE_PESO_MAX_G` (5 g), `IDLE_ESTABLE_MS` (4000),
  `FALLBACK_MS` (90000), `intervaloMs` = cadencia de **chequeo** del hueco (1500, no de importación).
- **Validado en simulador (2026-06-25):** plato vacío → importa en el hueco; plato ocupado → fuerza por
  tope a los N s; puesta al día al arrancar; `POST /ventas/importar` OK.
- **Pendiente:** validar con la **balanza real** que el gate efectivamente libera el teclado (medir
  duración real del bloqueo a primera hora vs fin del día) y afinar `IDLE_ESTABLE_MS`/`FALLBACK_MS`.

## Función 72 — formato (REAL, verificado contra CUORA MAX 2026-06-25)

> ⚠️ **Difiere del manual.** Lo de abajo es lo que devuelve la unidad real (capturado en COM5). Donde
> el manual decía otra cosa, está anotado.

**Solicitud:** `[Dir][72][DDMMAA inicio][DDMMAA fin][XOR]` (rango, 12 dígitos ASCII). **OJO:** una
consulta de **un solo día** devolvió error `E7` — el firmware filtra raro. El bridge pide el rango
amplio `010100`..`311299` (trae todo) y **filtra por fecha en JS** (`bridge.js: filtrarPorFecha`).

**Respuesta:** tickets **separados por `;` (0x3B)**, campos separados por `^` (0x5E), termina en
**`;F`** y luego XOR (sobre toda la trama). Cada ticket = **10 campos**:

```
[Id9]^[Fecha DD/MM/AA]^[Hora HH:MM:SS]^[Vend2]^[PLU4]^[Sector2]^[Unidades4]^[Gramos5]^[Drenado5]^[Importe12]
```

- **Importe ×1000** (NO ×100 como decía el manual): `000002800000` = **$2800,00**. Confirmado con
  ticket real de pan (0,100 kg → $2800) y con una venta por unidad (`#8001` → $3500 redondo).
- **Fecha** viene `DD/MM/AA` con barras; **Hora** `HH:MM:SS` con dos puntos (8 chars c/u).
- **PLU** es de **4** dígitos (el manual decía 6). El parser usa `split`, no ancho fijo, así que es robusto.
- **Unidades** solo en ventas por unidad · **Gramos** solo en pesables (el resto va en cero).
- El parser (`protocol.js: parseSalesReport`) separa por `;` y `^` (no ancho fijo). `protocol.fechaKey()`
  normaliza `DD/MM/AA`↔`DDMMAA` a `AAMMDD` para comparar rangos.

**Recepción en el bridge:** el reporte llega en **ráfagas con pausas** (la balanza junta los registros).
Por eso `bridge.js` acumula hasta ver el terminador **`;F`+XOR** (`isReportComplete`), con timeout de
25 s y una red de seguridad por silencio largo (2 s) si algún firmware no manda la `F`.

## Cómo maneja la línea serie (maestro-esclavo)

La línea es una sola y no admite dos pedidos a la vez. El bridge **serializa**:

1. En reposo: pollea **F1** (peso) cada 400 ms → WebSocket.
2. Al pedir **F72/F32**: **pausa** el polling de peso, manda la trama, **acumula** la respuesta hasta
   detectar fin (`isReportComplete`: datos terminan en `F` y el XOR cierra), valida y parsea.
3. Reanuda el polling de peso.

> El peso queda "congelado" el instante que dura el reporte (décimas de segundo) y vuelve solo.

## Probar SIN balanza

```bash
SIMULAR=1 npm start
```

- `GET /ventas` devuelve **tickets demo** (peso + unidad mezclados) — el simulador genera la **misma
  trama F72** y la pasa por el **mismo parser** que el hardware.
- `POST /sim/ventas {"tickets":[…]}` permite cambiar el set de tickets.
- `POST /ventas/cerrar` es no-op en simulador (en real ejecuta F32).

> Verificado el 2026-06-24 (simulador): F1 peso vivo OK · F72 4 tickets, total **$24.450**, XOR ✓ ·
> reensamblado de la trama en chunks OK · F32 OK · **bucle F72**: asienta los 4 demo + detecta ventas
> nuevas (#5/#6) automáticamente, sin duplicar; start/stop OK; el peso sigue vivo con el bucle activo.

### Probar el bucle sin balanza

```bash
SIMULAR=1 POLL_VENTAS_MS=2000 npm start
```

En `reportes.html` (panel "Ventas asentadas"): "Iniciar polling" → aparecen las demo. Luego
"+ Venta nueva" (simula que el operario cerró un ticket en la balanza) → a los ~2 s se asienta
sola y se ve en la tabla y en el log. Con "Detener", las ventas nuevas no se asientan hasta reanudar.

## Estado tras conectar la balanza real (2026-06-25)

- ✅ **Formato F72 confirmado** contra la unidad real → parser reescrito (`;`/`^`, importe ×1000,
  terminador `;F`). Ver "Función 72 — formato (REAL…)" arriba.
- ✅ **Rango de fechas:** se pide amplio `010100`..`311299` (trae todo) y se filtra en JS; una consulta
  de un solo día daba error `E7` en el firmware.
- ✅ **Bloqueo del teclado resuelto** (gate por inactividad + fallback 90 s) — ver "✅ RESUELTO — polling
  de F72 vs teclado" arriba. Validado en simulador; **falta confirmarlo con la balanza real**.
- ℹ️ Apareció un `ticketId` chico (`#100`) intercalado entre los altos (#387/#388): revisar si la
  balanza re-numera o usa contadores por sector/vendedor. La clave `fecha#ticketId` lo tolera, pero
  conviene entenderlo.

### Archivos de diagnóstico (este directorio)

- `_probe-f72.js` — sondeo crudo: manda F1 y F72 y vuelca byte por byte lo que vuelve (sirvió para
  descubrir el formato real). Correr con el bridge **detenido** (toma COM5): `node _probe-f72.js`.
- `_test-parser.js` — test offline del parser contra la trama real capturada + el simulador (regresión).
