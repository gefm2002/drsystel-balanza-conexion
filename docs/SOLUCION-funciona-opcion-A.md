# ✅ Solución que funcionó — Opción A (Bridge local COM → REST/WebSocket)

> Verificado el **2026-06-23** con balanza Systel Cuora conectada por **USB-B** a la PC.
> Lectura en vivo confirmada: **352 g, estable, tara 0, XOR ✓**.

---

## En qué consiste (resumen)

Un proceso Node (`01-bridge-local/bridge.js`) corre en la PC que tiene la balanza:

1. Abre el puerto **COM** de la balanza @115200.
2. Cada 400 ms envía la trama de **Función 1** ("pedir peso").
3. Recibe la respuesta, valida el **XOR**, decodifica peso/estabilidad/tara.
4. Re-expone el dato por **REST** (`GET /peso`) y **WebSocket** (push en vivo).

El navegador (o el ERP) **no toca bytes seriales**: solo consume HTTP/WS. Por eso es la
recomendada para DrSystel web.

```
Balanza ──USB-B──> COM5 ──(serial 115200)──> bridge.js ──REST + WS──> navegador / ERP
```

---

## Parámetros confirmados

| Parámetro | Valor | Nota |
|---|---|---|
| Puerto | **COM5** | FTDI `USB Serial Port`, VID_0403+PID_6001 (verificar en Administrador de dispositivos; puede cambiar de número) |
| Baudrate | **115200** | 8 / N / 1 |
| **Dirección balanza** | **0** | ⚠️ Clave. La unidad responde a la dirección **0**, no a la 1 (default original) |
| Polling | Función 1 cada 400 ms | No hay streaming; la balanza solo responde a pedido |
| Trama | `[Dir 1B][Func 1B][Datos ASCII][XOR 1B]` | |

### Trama de respuesta decodificada

```
14 01 30 30 30 33 35 32 65 30 30 30 30 30 30 74
│  │  └──"000352"──┘ │  └──"000000"──┘  └ XOR
│  │     peso(g)     │      tara(g)
│  │                 └ 'e' = estable / 'i' = inestable
│  └ Función (01)
└ Dirección de la balanza en la respuesta (0x14 = 20)
```

→ `pesoGramos = 352` (0,352 kg), `estable = true`, `taraGramos = 0`, `xorOk = true`.

---

## El fix que lo hizo andar

El protocolo polleaba la **dirección 1**, pero la balanza real solo contesta a la **dirección 0**.
Con dirección 1/2/3 el puerto abría ("conectado") pero **no llegaba ningún byte**.

Archivo: `01-bridge-local/protocol.js`

```js
const ADDRESS = 0;   // antes era 1 — la unidad real responde a 0
```

---

## Cómo correrlo

```powershell
cd 01-bridge-local
npm install                      # solo la 1ra vez
$env:COM_PORT="COM5"; npm start  # ajustar COM si cambia
```

Abrir **http://localhost:3001** → peso en vivo, semáforo verde (estable) / amarillo (inestable),
tara, neto, trama hex y `XOR ✓`.

### Endpoints

| Endpoint | Devuelve |
|---|---|
| `GET /peso` | `{ pesoGramos, pesoKg, estable, taraGramos, rawHex, xorOk, ts, connected }` |
| `GET /estado` | `{ connected, comPort, baud }` |
| `ws://localhost:3001` | push del mismo JSON en cada lectura |

---

## Cómo aplicar el aprendizaje a otras opciones

Las opciones C (Electron) y D (Web Serial) usan el **mismo protocolo** y, sobre USB, requieren
**el mismo fix de dirección**:

- En sus `protocol.js`, usar **`ADDRESS = 0`** al construir la Función 1.
- Mismos parámetros: COM correcto, 115200 / 8 / N / 1.

## Cómo diagnosticar si en otra PC/balanza "conecta pero no da peso"

1. Confirmar el COM real en **Administrador de dispositivos** (FTDI = VID_0403+PID_6001).
2. Si abre pero no llegan bytes → **barrer direcciones 0..3** pidiendo Función 1; la que devuelva
   una trama válida (XOR ✓) es la dirección de esa unidad.
3. Baudrate fijo 115200; DTR/RTS resultaron **indiferentes** en esta unidad.
