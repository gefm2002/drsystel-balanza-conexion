# Casos de uso usuario–sistema — Venta (enfoque "ERP manda")

> Enfoque **ERP manda**: el flujo lo conduce la PC/UI. La balanza Cuora MAX ST aporta
> **solo el peso** (Función 1, polling). PLU, confirmaciones y cierre se manejan en la PC.
> Implementado sobre la Alternativa 1 (`01-bridge-local`). Ver `SPEC-flujo-venta.md`.

## Convenciones

- **Actor:** operador de mostrador (cajero).
- **Sistema:** UI de venta (`venta.html`) + bridge (`bridge.js`) + backend de venta (`venta.js`).
- **Balanza:** Cuora MAX ST, solo peso en vivo por WebSocket.

### Mapeo de teclas (ERP, no de la balanza)

| Tecla / botón | Acción |
|---|---|
| Tipear PLU + **Buscar** (o Enter con el campo PLU lleno) | Cargar el producto |
| **`1`** | Agregar el artículo actual al carrito |
| **Enter** / botón **Nueva venta** | Cerrar la venta (con carrito no vacío) |
| **Esc** | Cancelar el artículo en curso |

### Catálogo de prueba (mock, `catalogo.js`)

| PLU | Producto | Tipo | Precio |
|---|---|---|---|
| 1001 | Queso Cremoso | PESO | $8.000/kg |
| 1010 | Jamón Cocido | PESO | $9.000/kg |
| 2005 | Coca Cola 2.25L | UNIDAD | $2.500/u |
| 2010 | Pan Lactal | UNIDAD | $1.800/u |

> Sin balanza se prueba con el **simulador de peso** (`SIMULAR=1`): el panel de la UI fija el
> peso que "devolvería" la balanza. En producción ese peso viene de la balanza real.

---

# Caso de uso 1 — Venta solo de artículos por PESO

**Objetivo:** vender una o más fiambres/quesos pesados en la balanza.
**Precondición:** bridge corriendo, balanza conectada (o simulador activo), estado `ESPERANDO_PLU`, carrito vacío.

**Ejemplo:** Queso Cremoso 1,250 kg + Jamón Cocido 0,450 kg.

| # | Actor (operador) | Sistema | Estado |
|---|---|---|---|
| 1 | Tipea `1001` y confirma (Buscar / Enter) | `GET /producto/1001` → "Queso Cremoso, $8.000/kg". Muestra **"Coloque el producto en la balanza"** | ESPERANDO_PLU → ESPERANDO_PESO_ESTABLE |
| 2 | Coloca el queso en la balanza | Muestra el peso en vivo (WS). Mientras oscila: semáforo **amarillo (inestable)**, tecla `1` **bloqueada** | ESPERANDO_PESO_ESTABLE |
| 3 | Espera a que se estabilice | Peso fijo (1,250 kg), semáforo **verde (estable)**, habilita "Agregar 1.250 kg (tecla 1)" | ESPERANDO_PESO_ESTABLE |
| 4 | Presiona **`1`** | `POST /carrito/item {productoId:1001, tipoEntrada:"PESO", pesoKg:1.250}` → backend calcula `1.250 × 8.000 = $10.000` y agrega el renglón. Vuelve a pedir PLU | AGREGANDO_ITEM → ESPERANDO_PLU |
| 5 | Tipea `1010` y confirma | "Jamón Cocido, $9.000/kg" → "Coloque el producto en la balanza" | ESPERANDO_PESO_ESTABLE |
| 6 | Coloca el jamón, espera estable, presiona **`1`** | `0.450 × 9.000 = $4.050` agregado. Carrito: 2 renglones, total **$14.050** | ESPERANDO_PLU |
| 7 | Presiona **Enter** (o botón **Nueva venta**) | `POST /venta/cerrar` → registra ticket #N, total **$14.050**, vacía el carrito | CERRANDO_VENTA → ESPERANDO_PLU |

**Resultado:** ticket con 2 renglones por peso, total $14.050. Carrito limpio para la próxima venta.

**Flujos alternativos:**
- *Peso inestable:* en el paso 4, si el semáforo está amarillo, la tecla `1` no hace nada (el backend igual rechazaría con 400 si llegara peso inválido).
- *Producto equivocado:* antes de presionar `1`, el operador presiona **Esc** → cancela el artículo, vuelve a `ESPERANDO_PLU` sin tocar el carrito.
- *PLU inexistente:* `GET /producto/9999` → 404, mensaje "PLU no existe", sigue en `ESPERANDO_PLU`.

---

# Caso de uso 2 — Venta solo de artículos por UNIDAD

**Objetivo:** vender productos envasados que se cobran por unidad (la balanza no interviene).
**Precondición:** estado `ESPERANDO_PLU`, carrito vacío.

**Ejemplo:** 3 Coca Cola 2.25L + 2 Pan Lactal.

| # | Actor (operador) | Sistema | Estado |
|---|---|---|---|
| 1 | Tipea `2005` y confirma | `GET /producto/2005` → "Coca Cola 2.25L, $2.500/u". Muestra **"Ingrese cantidad"** (default 1) | ESPERANDO_PLU → ESPERANDO_CANTIDAD |
| 2 | Ajusta cantidad a **3** (botones +/− o tipea) | Refleja cantidad = 3 | ESPERANDO_CANTIDAD |
| 3 | Presiona **`1`** (agregar) | `POST /carrito/item {productoId:2005, tipoEntrada:"UNIDAD", cantidad:3}` → `3 × 2.500 = $7.500` agregado | AGREGANDO_ITEM → ESPERANDO_PLU |
| 4 | Tipea `2010` y confirma | "Pan Lactal, $1.800/u" → "Ingrese cantidad" | ESPERANDO_CANTIDAD |
| 5 | Ajusta a **2**, presiona **`1`** | `2 × 1.800 = $3.600` agregado. Carrito: 2 renglones, total **$11.100** | ESPERANDO_PLU |
| 6 | Presiona **Enter** / **Nueva venta** | `POST /venta/cerrar` → ticket #N, total **$11.100**, carrito vacío | ESPERANDO_PLU |

**Resultado:** ticket con 2 renglones por unidad, total $11.100. La balanza nunca se usó.

**Flujos alternativos:**
- *Cantidad por defecto:* si el operador no toca la cantidad (queda 1) y presiona `1`, se agrega 1 unidad. (Variante rápida de `reqNuevos.txt`.)
- *Cantidad inválida (0 o vacío):* el backend rechaza con 400 ("cantidad debe ser un entero > 0").
- *Cancelar:* **Esc** descarta el artículo en curso sin agregarlo.

---

# Caso de uso 3 — Venta MIXTA (peso + unidad en el mismo carrito)

**Objetivo:** una sola venta que combina fiambre pesado y bebidas por unidad.
**Precondición:** estado `ESPERANDO_PLU`, carrito vacío.
**Punto clave:** cada renglón decide su propio flujo según el tipo del producto; la venta **no** es "por peso" o "por unidad" a nivel global.

**Ejemplo (el de `reqNuevos.txt`):** Queso 1,250 kg + Coca ×2 + Jamón 0,450 kg.

| # | Actor (operador) | Sistema | Estado |
|---|---|---|---|
| 1 | Tipea `1001` y confirma | "Queso Cremoso (PESO)" → "Coloque el producto en la balanza" | ESPERANDO_PESO_ESTABLE |
| 2 | Coloca queso, espera **estable**, presiona **`1`** | `1.250 × 8.000 = $10.000` agregado | ESPERANDO_PLU |
| 3 | Tipea `2005` y confirma | "Coca Cola 2.25L (UNIDAD)" → "Ingrese cantidad" | ESPERANDO_CANTIDAD |
| 4 | Pone cantidad **2**, presiona **`1`** | `2 × 2.500 = $5.000` agregado | ESPERANDO_PLU |
| 5 | Tipea `1010` y confirma | "Jamón Cocido (PESO)" → "Coloque el producto en la balanza" | ESPERANDO_PESO_ESTABLE |
| 6 | Coloca jamón, espera **estable**, presiona **`1`** | `0.450 × 9.000 = $4.050` agregado. Carrito: 3 renglones, total **$19.050** | ESPERANDO_PLU |
| 7 | Presiona **Enter** / **Nueva venta** | `POST /venta/cerrar` → ticket #N, total **$19.050**, carrito vacío | ESPERANDO_PLU |

**Carrito resultante:**

```txt
- Queso Cremoso  | 1.250 kg × $8.000/kg | $10.000
- Coca Cola 2.25L | ×2 × $2.500/u        | $5.000
- Jamón Cocido   | 0.450 kg × $9.000/kg | $4.050
                                    TOTAL  $19.050
```

**Lo que el sistema garantiza en el flujo mixto:**
- Clasifica cada PLU **después** de cargarlo (peso vs unidad) y ramifica solo.
- No mezcla los datos: a un renglón por peso le exige `pesoKg`; a uno por unidad le exige `cantidad`. La combinación cruzada se **rechaza con 400** (lo valida el backend, no la UI).
- No deja cerrar la venta con el carrito vacío.
- No agrega dos veces el mismo artículo (la tecla `1` se rehabilita recién con el próximo PLU).

---

## Cómo probar estos 3 casos sin balanza

```bash
cd pruebas-conexion/01-bridge-local
SIMULAR=1 npm start        # PowerShell: $env:SIMULAR="1"; npm start
```

Abrir **http://localhost:3001/venta.html**. Para los pasos por peso, fijar el peso en el panel
**Simulador** (gramos + "estable") antes de presionar `1`. Para los pasos por unidad, ajustar la
cantidad y presionar `1`. El simulador genera la **misma trama de Función 1** que la balanza real,
así que el flujo es idéntico al de producción (donde el peso lo pone la balanza).
