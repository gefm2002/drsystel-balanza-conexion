# Opción A — Bridge local (COM → REST + WebSocket)

Proceso Node que corre en la PC de la balanza: abre el puerto COM @115200, hace polling de la
**Función 1** (pedir peso) y re-expone el dato por **WebSocket** (peso en vivo) y **REST** (`GET /peso`,
captura puntual). El navegador solo consume HTTP/WS — no toca bytes seriales. **Recomendada para DrSystel web.**

## Correr

```bash
npm install
npm start            # usa COM3 por defecto
# o indicando el puerto:
COM_PORT=COM5 npm start        # PowerShell: $env:COM_PORT="COM5"; npm start
```

Abrir **http://localhost:3001**

## Qué vas a ver

- **Sin balanza:** la página carga con semáforo rojo "Desconectado" (confirma que el server + WS + REST levantan).
- **Con balanza:** peso en kg en vivo, semáforo verde (estable) / amarillo (inestable), tara, neto,
  trama cruda en hex y validación `XOR ✓`. El botón "Capturar peso" hace `GET /peso`.

## Requisitos hardware (cuando llegue la balanza)

- Driver FTDI `CDM21228_Setup.exe` instalado → confirmar `COMx` en Administrador de dispositivos.
- Balanza en 115200 / 8 / N / 1.

## Endpoints

**Peso**
- `GET /peso` → último JSON `{ pesoKg, estable, taraGramos, rawHex, xorOk, ts }`
- `GET /estado` → `{ connected, comPort, baud, simulando }`
- `ws://localhost:3001` → push del mismo JSON en cada lectura

**Venta** (ver `SPEC-flujo-venta.md`)
- `GET /producto/:plu` → `{ plu, nombre, tipo, precioKg|precioUnitario }` (catálogo mock en `catalogo.js`)
- `GET /carrito` · `POST /carrito/item` · `DELETE /carrito/item/:idx`
- `POST /venta/cerrar` → registra ticket y vacía el carrito
- `POST /sim/peso` → fija el peso simulado (solo en modo simulador)

---

## Flujo de venta integrado (SPEC)

Sobre este mismo bridge se montó el **flujo de venta con balanza** (`SPEC-flujo-venta.md`,
basado en `../../reqNuevos.txt`). UI en **http://localhost:3001/venta.html**.

Mapeo de teclas (decidido con el usuario; la balanza Cuora **no** envía teclas, solo peso):
- tecla **`1`** → agregar el artículo actual al carrito
- **Enter** / botón **Nueva venta** → cerrar la venta
- **Esc** → cancelar el artículo en curso

Soporta venta **por peso**, **por unidad** y **mixta**. El backend valida y calcula (regla dura:
peso ⇒ pesoKg, unidad ⇒ cantidad; la combinación cruzada se rechaza con 400).

### Probar SIN balanza (modo simulador)

```bash
SIMULAR=1 npm start            # PowerShell: $env:SIMULAR="1"; npm start
```

Abrir **http://localhost:3001/venta.html** → aparece el panel **Simulador de peso**.
Fijás gramos + "estable", buscás un PLU (ej. `1001` peso, `2005` unidad) y agregás con `1`.
El simulador sintetiza la **misma trama de Función 1** que la balanza real y la pasa por el
**mismo parser** (`parseWeightFn1`), así se prueba el flujo de punta a punta sin hardware.

> Verificado el 2026-06-24 vía endpoints: peso $10.000, unidad x2 $5.000, mixto **$19.050**
> (ejemplo de `reqNuevos.txt`), rechazos 400/404 y cierre de ticket correctos.

Sin `SIMULAR`, el bridge abre el **COM real** igual que la versión verificada con balanza.
