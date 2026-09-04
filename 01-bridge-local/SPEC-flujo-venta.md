# SPEC — Flujo de venta integrado con balanza (sobre Alternativa 1 / Opción A)

> **Asignada a la alternativa que funcionó:** `pruebas-conexion/01-bridge-local/`
> (Bridge local COM serial @115200 → REST + WebSocket). Verificada el 2026-06-23
> con balanza Cuora real — ver `../docs/SOLUCION-funciona-opcion-A.md`.
>
> Origen de requisitos: `../../reqNuevos.txt`.
> Casos de uso usuario–sistema (peso / unidad / mixto): `CASOS-DE-USO-venta.md`.

---

## 1. Restricción que condiciona todo el diseño

El protocolo Cuora es **maestro-esclavo, solo polling**: el ERP pregunta y la balanza
responde. La balanza **no emite eventos espontáneos** (ni PLU, ni teclas, ni "Vender").
Lo único que se le puede pedir en vivo es el **peso** (Función 1, cada 400 ms).

`reqNuevos.txt` describe un flujo donde "la balanza envía PLU / ENTER / VENDER". Con el
protocolo confirmado **eso no es posible por la balanza**. Por lo tanto:

| Acción del flujo | De dónde viene realmente |
|---|---|
| Peso estable | **Balanza** (Función 1, polling) — único dato real de hardware |
| Ingreso de PLU | **PC / UI** (teclado o lector) |
| Confirmar artículo (agregar al carrito) | **PC / UI** → tecla **`1`** |
| Confirmar carrito / cerrar venta | **PC / UI** → **Enter** o botón **Nueva venta** |
| Cancelar artículo actual | **PC / UI** → tecla **Esc** |

> Conclusión: el "mapeo de teclas de la balanza" de `reqNuevos.txt` se resuelve como
> **mapeo de teclas del ERP**. La balanza queda como **fuente de peso** y nada más.

### Mapeo de teclas confirmado (pedido del usuario)

```txt
Tecla "1"            → agregar el producto actual al carrito (confirmar artículo)
Tecla Enter          → confirmar carrito y cerrar venta
Botón "Nueva venta"  → equivalente a Enter: confirmar carrito y cerrar venta
Tecla Esc            → cancelar el artículo actual (vuelve a ESPERANDO_PLU)
```

---

## 2. Alcance

La venta es un **bucle**: se cargan artículos uno por uno y se cierra cuando el operador
decide. Cada renglón decide su propio flujo según el tipo de producto (no hay venta
"global por peso" o "por unidad").

Tres casos soportados (de `reqNuevos.txt`):

- **Por peso** — usa el peso estable de la balanza.
- **Por unidad** — usa una cantidad ingresada (default 1).
- **Mixta** — combina ambos en el mismo carrito.

**El backend valida y calcula.** El frontend nunca calcula importes.

---

## 3. Máquina de estados (frontend)

```txt
        ┌──────────────────────────────────────────────┐
        ▼                                              │
  ESPERANDO_PLU ──(PLU válido, tipo PESO)──► ESPERANDO_PESO_ESTABLE
        │                                              │
        │                                       (peso estable + tecla 1)
        │                                              ▼
        │                                        AGREGANDO_ITEM ──► (vuelve a ESPERANDO_PLU)
        │                                              ▲
        └──(PLU válido, tipo UNIDAD)──► ESPERANDO_CANTIDAD ──(cantidad + tecla 1)──┘

  En cualquier estado con artículo en curso:  Esc ──► cancela ──► ESPERANDO_PLU
  En ESPERANDO_PLU con carrito no vacío:       Enter / "Nueva venta" ──► CERRANDO_VENTA
```

Estados (de `reqNuevos.txt`, recortados a lo que aplica):

| Estado | Qué muestra / espera |
|---|---|
| `ESPERANDO_PLU` | Campo de PLU. Buscar producto al confirmar el PLU. |
| `ESPERANDO_PESO_ESTABLE` | "Coloque el producto en la balanza". Peso en vivo (WS). Habilita tecla `1` **solo si `estable=true`**. |
| `ESPERANDO_CANTIDAD` | "Ingrese cantidad". Input numérico (default 1). Habilita tecla `1`. |
| `AGREGANDO_ITEM` | Transitorio: POST al backend, agrega renglón, vuelve a `ESPERANDO_PLU`. |
| `CERRANDO_VENTA` | POST cierre, registra venta, limpia carrito. |

Reglas que la máquina evita (de `reqNuevos.txt`):
- No agregar dos veces el mismo artículo (la tecla `1` se deshabilita tras agregar).
- No calcular con peso inestable (tecla `1` bloqueada si `estable=false`).
- No mandar peso en productos por unidad ni cantidad en productos por peso (lo valida el backend).
- No cerrar venta con el carrito vacío.

---

## 4. Contrato de API (sobre el bridge de la Alternativa 1)

Todo cuelga del mismo servidor `http://localhost:3001`.

### Existentes (peso — ya funcionan)
| Endpoint | Devuelve |
|---|---|
| `GET /peso` | `{ pesoGramos, pesoKg, estable, taraGramos, rawHex, xorOk, ts, connected }` |
| `GET /estado` | `{ connected, comPort, baud, simulando }` |
| `ws://localhost:3001` | push del JSON de peso en cada lectura |

### Nuevos (venta)
| Endpoint | Body | Devuelve |
|---|---|---|
| `GET /producto/:plu` | — | `{ plu, nombre, tipo:"PESO"\|"UNIDAD", precioKg?, precioUnitario? }` o 404 |
| `GET /carrito` | — | `{ items:[...], total }` |
| `POST /carrito/item` | ver abajo | `{ item, carrito }` o 400 si la validación falla |
| `DELETE /carrito/item/:idx` | — | `{ carrito }` |
| `POST /venta/cerrar` | — | `{ ticket, items, total, ts }`; vacía el carrito. 400 si carrito vacío. |

### Body de `POST /carrito/item`

Producto **por peso**:
```json
{ "productoId": 1001, "tipoEntrada": "PESO", "pesoKg": 1.250 }
```
Producto **por unidad**:
```json
{ "productoId": 2005, "tipoEntrada": "UNIDAD", "cantidad": 3 }
```

### Validación del backend (regla dura)

```txt
Producto PESO    → exige pesoKg > 0   · rechaza si llega cantidad   · total = pesoKg * precioKg
Producto UNIDAD  → exige cantidad > 0 · rechaza si llega pesoKg     · total = cantidad * precioUnitario
tipoEntrada debe coincidir con el tipo real del producto, si no → 400.
```

Importes redondeados a 2 decimales. El backend es la única fuente de verdad del total.

---

## 5. Simulador de peso (para probar sin balanza)

Como hoy no hay balanza, el bridge incorpora un **modo simulador** que sintetiza tramas
reales de Función 1 (`[0x14][01][6 peso][e/i][6 tara][XOR]`) y las hace pasar por el
**mismo parser** que usa el hardware (`parseWeightFn1`). Así se prueba el flujo completo
de punta a punta sin tocar el COM.

- Activación: `SIMULAR=1` al arrancar (o automático si el COM no abre, opcional).
- `POST /sim/peso { "gramos": 1250, "estable": true, "taraGramos": 0 }` fija el peso simulado.
- El polling sigue empujando por WS igual que con balanza real → la UI no distingue.

> El modo real (con balanza) queda intacto: sin `SIMULAR`, el bridge abre el COM como antes.

---

## 6. Ejemplos de referencia (de `reqNuevos.txt`)

```txt
PLU 1001  Queso Cremoso   PESO    1.250 kg × $8.000/kg  = $10.000
PLU 2005  Coca Cola 2.25L UNIDAD  ×2     × $2.500/u     = $5.000
PLU 1010  Jamón Cocido    PESO    0.450 kg × $9.000/kg  = $4.050
```

Carrito mixto resultante → total $19.050, luego **Enter / Nueva venta** → cierre.

---

## 7. Criterios de aceptación

1. Con `SIMULAR=1`, `GET /producto/1001` devuelve el producto y la UI pasa a `ESPERANDO_PESO_ESTABLE`.
2. Fijando peso simulado estable y pulsando `1`, se agrega el renglón con `total = pesoKg*precioKg`.
3. `GET /producto/2005` lleva a `ESPERANDO_CANTIDAD`; con cantidad 3 y `1`, total = `3*precioUnitario`.
4. El backend rechaza con 400: peso en producto por unidad, cantidad en producto por peso, y peso ≤ 0.
5. La tecla `1` está **bloqueada** mientras el peso es inestable.
6. **Enter** o **Nueva venta** con carrito no vacío cierra la venta, devuelve ticket y vacía el carrito.
7. **Enter** con carrito vacío no hace nada (sin error visible que rompa el flujo).
8. Quitando `SIMULAR`, el bridge abre el COM real sin cambios respecto a la versión verificada.

---

## 8. Fuera de alcance (por ahora)

- Persistencia de ventas (se registran en memoria/log; integración con backend DrSystel real es el siguiente paso).
- Envío de catálogo a la balanza (Función 4) y extracción de ventas de la balanza (Función 72/21).
- Multi-balanza / direcciones distintas de 0.
