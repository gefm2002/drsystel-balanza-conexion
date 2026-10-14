# Cómo conectar la balanza Systel (Cuora / Cuora MAX) y variantes de conexión

Guía autocontenida para conectar la balanza a la PC y elegir la vía de integración. Resume qué funcionó,
qué puertos se usan y cómo arrancar cada alternativa. Para el paso a paso extendido ver
[`COMO-PROBAR-CON-BALANZA.md`](./COMO-PROBAR-CON-BALANZA.md); para el estado de cada opción ver
[`docs/ESTADO-de-las-opciones.md`](./docs/ESTADO-de-las-opciones.md).

---

## TL;DR — lo que funcionó (2026-06-25)

```
Balanza ──USB-B──> COM5 ──(serial 115200 8N1, dirección 0)──> bridge.js ──REST + WebSocket──> navegador / ERP
```

- **Vía elegida:** Opción A / A.1 — **bridge local** (`01.1-bridge-reportes`).
- **Puerto serie:** `COM5` (FTDI, VID_0403+PID_6001) — cambia de número según la PC; el bridge lo **detecta solo**.
- **Parámetros:** `115200 / 8 / N / 1`, **dirección de balanza `0`** ⚠️ (clave, ver abajo).
- **Puerto del servidor:** `http://localhost:3001` (REST + `ws://localhost:3001`).

```powershell
cd 01.1-bridge-reportes
npm install
npm start                            # detecta el COM del FTDI solo
# $env:COM_PORT="COM5"; npm start    # solo para forzar un COM puntual
```
→ `http://localhost:3001/` (peso en vivo) · `http://localhost:3001/reportes.html` (ventas + cobro).

---

## Paso a paso para conectar (USB / serial)

1. **Instalar el driver FTDI CDM21228.** El instalador (`CDM21228_Setup.exe`) **no está en este repo**
   (es un binario del fabricante). Está en la carpeta hermana `Drivers_Cuora-Cuora_Max-..._CDM21228_Setup/`
   del proyecto, o se baja de FTDI (VCP driver). La balanza usa un chip FTDI estándar.
2. **Conectar la balanza por USB-B.** No usar USB y RS-232 a la vez.
3. **Confirmar el COM:** Administrador de dispositivos → *Puertos (COM y LPT)* → `USB Serial Port (COMx)`.
   Anotar el número (ej. `COM5`).
4. **Configurar la balanza** en `115200 / 8 / N / 1`.
5. **Verificar que Node ve el puerto** (opcional):
   ```powershell
   cd 01.1-bridge-reportes
   node -e "require('serialport').SerialPort.list().then(p=>p.forEach(x=>console.log(x.path,x.friendlyName)))"
   ```
6. **Arrancar el bridge** (ver TL;DR). Busca el FTDI (VID 0403 / PID 6001) y abre su COM, sea cual sea el
   número. Si no lo encuentra, el log lista los puertos vistos y reintenta cada 2 s. `COM_PORT` lo fuerza.

> **⚠️ El fix que lo hizo andar:** el protocolo original polleaba la **dirección 1**; la unidad real
> responde a la **dirección 0** (`protocol.js: ADDRESS = 0`). Con otra dirección el puerto abre
> ("conectado") pero **no llega ningún byte**. DTR/RTS resultaron indiferentes.

---

## Variantes de conexión

Cuatro PoC independientes, mismo protocolo maestro-esclavo (trama `[Dir][Func][Datos][XOR]`, polling
de Función 1 @115200). Cambia el **transporte** balanza→software y cómo llega al navegador.

| Carpeta | Opción | Balanza → SW | Al navegador | Puerto app | Estado |
|---|---|---|---|---|---|
| `01-bridge-local/` | **A** — Bridge local | COM serial (FTDI) | REST + WebSocket | `:3001` | ✅ funcionó 2026-06-23 |
| `01.1-bridge-reportes/` | **A.1** — Bridge + reportes (F1+F72+F32) | COM serial (FTDI) | REST + WebSocket | `:3001` | ✅ validado con balanza real 2026-06-25 |
| `02-cuora-max-tcp/` | **B** — Cuora MAX por TCP/IP | Socket TCP a IP de la balanza | REST + WebSocket | `:3002` | ⬜ solo Cuora MAX en red (no aplica a USB) |
| `03-desktop-com/` | **C** — Electron desktop | COM serial (FTDI) | IPC (app nativa) | ventana | ⬜ no probada |
| `04-web-serial/` | **D** — Web Serial API | COM desde el navegador | directo | `:5004` | ⬜ prototipo (Chrome/Edge) |

### A / A.1 — Bridge local *(recomendada)*
Node abre el COM, pollea Función 1 y re-expone el peso por REST/WebSocket. El navegador/ERP **no toca
bytes seriales**, solo consume HTTP/WS. La **A.1** agrega Función 72 (reporte de ventas) + Función 32
(cierre) + flujo de cobro "balanza manda". Es la vía de producción.

### B — Cuora MAX por TCP/IP
Para una **Cuora MAX en red** (la Cuora 2 no tiene red). Socket TCP a la IP de la balanza:
```powershell
cd 02-cuora-max-tcp
npm start 192.168.1.50 4000     # <IP real> <puerto TCP real — 4000 es placeholder, confirmar en manual>
```
No compite por el COM. Requiere IP fija/reserva DHCP y el puerto TCP real (Anexos VI/VII del manual).

### C — Electron desktop
Mismo protocolo serial que A, pero la app de escritorio abre el COM en su proceso principal (IPC, sin
HTTP). Para un ERP nativo en la misma PC que la balanza. Requiere `ADDRESS = 0` igual que A.

### D — Web Serial API *(prototipo)*
El navegador abre el COM con `navigator.serial`. Solo Chrome/Edge, requiere `http://localhost` o HTTPS
y permiso manual del usuario para elegir el puerto. Frágil para producción; útil para demo rápida.

---

## Puertos — resumen

**Puerto serie (balanza ↔ PC):**
- `COM5` @ `115200 / 8 / N / 1`, dirección `0`. USB-B vía chip FTDI (VID_0403 + PID_6001). El número de
  COM puede variar entre PCs; confirmar en Administrador de dispositivos.
- **Un solo proceso puede tomar el COM a la vez.** No correr A, C y D sobre el mismo `COMx` en simultáneo.

**Puerto TCP/HTTP (software ↔ navegador/ERP):**
- Opción A / A.1 → `http://localhost:3001` (+ `ws://localhost:3001`).
- Opción B → `http://localhost:3002` (y TCP hacia la balanza, `4000` placeholder).
- Opción D → `http://localhost:5004`.

---

## Diagnóstico rápido

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "no se pudo abrir COMx" | COM equivocado o tomado por otra app | Revisar Administrador de dispositivos; cerrar apps que usen el puerto |
| Conecta pero no llega peso | **Dirección ≠ 0**, o baudios mal | Poner `ADDRESS = 0`; barrer direcciones 0..3 pidiendo Función 1 |
| `XOR ✗` en las tramas | Ruido / baudios incorrectos | Confirmar 115200/8N1, cable |
| Peso siempre "Inestable" | Balanza sin asentar / vibración | Esperar a que se estabilice (normal en movimiento) |
| Opción B `ECONNREFUSED` | IP/puerto mal o balanza fuera de red | `Test-NetConnection <ip> -Port <puerto>` |
