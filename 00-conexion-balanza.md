# Conexión Balanza Systel (Cuora / Cuora MAX) — Guía única

> **Fuente de verdad:** `conectar/Protocolo-Cuora-2-y-Cuora-MAX/`
> - `enMD/cuora-protocolo-integracion-erp.md` — protocolo y funciones
> - `enMD/cuora-implementacion-cliente-erp.md` — código cliente (frame builder, XOR, servicio)
> - `carpetaOriginal/` — PDFs oficiales + ejemplo VB de Systel (`Form1.vb`)
>
> Este documento reemplaza las notas viejas (POS / `ENQ 0x05` / streaming), que **no aplican** a Cuora.
> Ver al final "Descartado y por qué".

---

## 1. Hechos confirmados

La Cuora habla un **protocolo de funciones maestro-esclavo**, no el POS `ENQ 0x05`.

| Parámetro | Valor | Fuente |
|---|---|---|
| Velocidad | **115200** baudios | `Form1.vb:40` (ejemplo oficial) |
| Formato | 8 bits / sin paridad / 1 stop / sin control de flujo | doc oficial |
| Driver | FTDI **CDM21228** (crea COM virtual sobre USB) | `notas` + drivers Systel |
| Modelo de comunicación | Maestro-esclavo: **el ERP pregunta, la balanza responde**. Sin push espontáneo. | doc oficial |
| Lectura de peso | **Solo polling** (Función 1). No hay streaming nativo. | doc oficial |
| Restricción | No usar USB y RS-232 a la vez | doc oficial |

**Trama (igual en ambos sentidos):**
```
[ Dirección 1B ] [ Función 1B ] [ Datos NB ASCII ] [ XOR 1B ]
```
- **XOR** = XOR de todos los bytes previos. Verificar siempre en la respuesta.
- **Fin de trama** = silencio de ~5 ms (no hay terminador fijo).
- Respuestas de control: `ACK` (ok) / `NAK` + código (reintentar, máx. 3).
- Números siempre **ASCII, en gramos, sin coma**. La conversión a kg/$ la hace el ERP.

---

## 2. Transporte según modelo

| Modelo | Transporte | Llega a la PC como | Modo |
|---|---|---|---|
| **CUORA 2** | RS-485 o USB | COM físico/virtual (FTDI) | Unicast + Broadcast (bus multi-balanza) |
| **CUORA MAX** | **Ethernet / WiFi (TCP/IP)** o USB | COM virtual sobre TCP/IP, **o socket TCP directo** | Solo Unicast |

> Diferencia clave: la **Cuora MAX ya tiene red nativa** → el backend puede abrir un socket TCP a su IP sin USB ni bridge. La Cuora 2 siempre necesita COM en una PC.

---

## 3. Mapa de funciones (qué dato devuelve la balanza)

| Dato para el ERP | Función | Respuesta | Cuora 2 | Cuora MAX |
|---|---|---|---|---|
| **Peso + estabilidad + tara** | `1` | `[6 peso][e/i][6 tara]` (gramos) | ✓ | ✓ |
| PING / ¿conectada? | `23` | estado conexión/sincronización | ✓ | ✓ |
| Firma del equipo (modelo, versión protocolo, capacidad, decimales) | `2` | `F..C..S..P..A..D.` | ✓ | ✓ |
| Enviar/actualizar PLU | `4` | `ACK`/`NAK` (flag `N` nuevo / `M` modifica) | ✓ | ✓ |
| Actualizar solo precio | `33` | `ACK`/`NAK` | ✓ | ✓ |
| Borrar PLU | `5` | `ACK`/`NAK` | ✓ | ✓ |
| Sincronizar sectores | `10`/`11` | envío / lista | ✓ | ✓ |
| Datos del comercio (ticket) | `17` | `ACK` | ✓ | ✓ |
| Auditar PLUs cargados | `31` | `N[PLU]V[ver]...F` (ver `2` = modificado en balanza) | ✓ | ✓ |
| **Ventas detalladas ticket a ticket** | `72` | entradas separadas por `^`, fin `F` | — | ✓ |
| **Totales de ventas por PLU** | `20`/`21` | acumulados por vendedor + cantidad | ✓ | — |
| Cierre de ventas (resetea acumuladores) | `32` | `"I"` (procesando) → `ACK` | ✓ | ✓ |

**Peso en tiempo real:** polling de Función 1 cada **300–500 ms**. Verificar byte `e` (estable) antes de registrar; si es `i`, descartar.

---

## 4. Opciones de desarrollo (todas maestro-esclavo @115200)

Hay dos capas independientes que se combinan:
**Capa A** = cómo el dato sale de la balanza · **Capa B** = cómo llega al ERP.

| Opción | Capa A (transporte) | Capa B (al ERP) | Sirve para web | Recomendación |
|---|---|---|---|---|
| **A. Bridge local** | COM (Cuora 2) o TCP (MAX) | REST + WebSocket | **Alto** | **Recomendada** — única pieza a construir |
| **B. Cuora MAX TCP directo** | Socket TCP a IP de la balanza | El backend habla el protocolo | **Alto** | Solo MAX; ideal si no querés instalar nada en la caja |
| **C. Desktop COM directo** | COM en la misma PC | En-proceso (.NET/Electron) | — | Solo si el ERP fuera desktop |
| (D. Web Serial) | COM desde el navegador | Directo | Bajo | Solo prototipo (Chrome/Edge, HTTPS, permiso manual) |

### Opción A — Bridge local (recomendada para DrSystel web)

```
   Cuora 2 (USB/RS-485) ──┐
                          ├─► BRIDGE  (Node/.NET en la PC de la caja)
   Cuora MAX (TCP/IP)   ──┘     · abre COM o socket TCP @115200
                                · arma trama [Dir][Func][Datos][XOR]
                                · valida XOR, parsea funciones 1/72/21/31...
                          ┌──────────────┴──────────────┐
              WebSocket (peso en vivo)         REST (captura puntual / ventas)
                          ▼                            ▼
                 DrSystel: display vivo     DrSystel: GET /peso al confirmar,
                                            import de ventas en el cierre
```

Por qué: DrSystel (web) **no toca bytes seriales ni XOR**, solo consume HTTP/WS; funciona en cualquier navegador; el mismo bridge unifica Cuora 2 (COM) y MAX (TCP). El núcleo ya está escrito en `cuora-implementacion-cliente-erp.md` (`buildFrame`, `verifyXOR`, `CuoraScaleService`) — reutilizable casi tal cual.

### Opción B — Cuora MAX TCP directo

El backend del ERP abre `net.createConnection({host: IP, port})` y habla el protocolo directamente. Sin instalar nada en la caja. El bridge igual conviene para reconexión, cache del último peso y unificar con Cuora 2.

### Flujo típico de pesaje (combina REST + WS)
1. Operario coloca producto → **WS** muestra peso en vivo (ve que se estabiliza).
2. Click "Confirmar" → **REST `GET /peso`** captura el valor estable (byte `e`).
3. Cierre diario → Función `72` (MAX) o `21` (Cuora 2) → import de ventas → Función `32` (cierre).

---

## 5. Plan de validación (antes de codear)

1. Instalar driver FTDI `CDM21228_Setup.exe` → verificar "USB Serial Port (COMx)" en Administrador de dispositivos.
2. Con un terminal serial (o el VB oficial) a **115200/8/N/1**, enviar Función `23` (PING) o `1` (peso) y confirmar respuesta + XOR válido.
3. Confirmar modelo (Cuora 2 vs MAX) con Función `2` (firma digital) → define si hay `72`/`21` disponibles.
4. Cuora MAX en red: configurar su subsistema de comunicaciones (Anexos VI/VII del manual) + IP fija / reserva DHCP.

---

## 6. Descartado y por qué (no desarrollar)

| Descartado | Motivo |
|---|---|
| Protocolo POS `ENQ 0x05` / `STX`+peso+`ETX` | Otra familia (PASSER/POS). Cuora usa tramas por función. |
| Streaming Protocolo 5 | Cuora no transmite solo; lectura es polling de Función 1. |
| 9600 baudios | El ejemplo oficial usa **115200**. |
| Qendra batch | Solo catálogo/reportes, no peso en vivo. Fuera de alcance. |
| Ticket + scanner | Descartado por ahora. |
| Cambiar a equipo POS | Descartado; a lo sumo probar manualmente drivers PASSER como último recurso. |
