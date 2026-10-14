# Cómo probar las 4 PoC cuando llegue la balanza

Guía paso a paso para verificar que el peso de la balanza Systel (Cuora / Cuora MAX) llega correctamente a
la PC. Las 4 PoC ya están construidas y arrancan en "Desconectado"; acá está lo que falta: **conectar el
hardware real y confirmar la lectura**.

---

## Paso 0 — Preparación (común a todas)

### 0.1 Instalar el driver FTDI (opciones A, C, D — conexión USB/serial)
1. Ejecutar `../Drivers_Cuora-Cuora_Max-Cuora_Max_ST_CDM21228_Setup/CDM21228_Setup.exe`.
2. Conectar la balanza por USB.
3. Abrir **Administrador de dispositivos → Puertos (COM y LPT)** → debe aparecer `USB Serial Port (COMx)`.
4. **Anotar el número de COM** (ej. `COM5`). Lo vas a usar en las opciones A, C y D.

> La Cuora MAX por red (opción B) **no usa** este driver: se conecta por IP, no por COM.

### 0.2 Configurar la balanza
- Comunicación en **115200 / 8 / N / 1** (es lo que asumen las 4 PoC).
- No usar USB y RS-232 a la vez.
- Para la **Cuora MAX en red**: configurar su subsistema de comunicaciones (Anexos VI/VII del manual),
  asignarle **IP fija** o reserva DHCP, y averiguar el **puerto TCP** que expone.

### 0.3 Verificar el COM antes de codear (opcional pero recomendado)
Listar los puertos que ve Node:
```bash
cd 01-bridge-local
node -e "require('serialport').SerialPort.list().then(p=>p.forEach(x=>console.log(x.path,x.friendlyName)))"
```
Debe figurar el `COMx` de la balanza con nombre tipo "USB Serial Port".

### ✅ Qué confirma una prueba exitosa (en cualquier opción)
- El peso en kg cambia al poner/sacar peso de la balanza.
- Semáforo **verde "Estable"** cuando el peso se asienta, **amarillo "Inestable"** mientras se mueve.
- La **tara** y el **neto** se muestran.
- **`XOR ✓`** en cada trama (si saliera `XOR ✗` hay ruido/baudios mal).
- En el log aparecen tramas tipo `01 01 30 30 30 34 38 35 65 ...` (Función 1).

---

## Opción A — Bridge local (recomendada) · http://localhost:3001

Transporte: COM serial → REST + WebSocket. Sirve para DrSystel web.

```bash
cd 01-bridge-local
npm install                       # si no se hizo antes
npm start                         # detecta solo el COM del FTDI de la balanza
# para forzar un COM — PowerShell: $env:COM_PORT="COM5"; npm start   (Git Bash: COM_PORT=COM5 npm start)
```
1. Abrir **http://localhost:3001** en cualquier navegador.
2. En la consola debe verse `[serial] abierto COMx (detectado FTDI)` (sin "no se pudo abrir" ni "no se encontró la balanza").
3. Poner peso → la UI muestra kg en vivo y semáforo verde al estabilizar.
4. Click **"Capturar peso (REST /peso)"** → devuelve el último valor estable (esto es lo que usaría el ERP al confirmar una venta).

Probar los endpoints directo (otra terminal):
```bash
curl http://localhost:3001/estado     # {"connected":true,"comPort":"COM5",...}
curl http://localhost:3001/peso        # {"pesoKg":0.485,"estable":true,...}
```

---

## Opción B — Cuora MAX por TCP/IP · http://localhost:3002

Transporte: socket TCP a la IP de la balanza. **Solo Cuora MAX** (la Cuora 2 no tiene red).

```bash
cd 02-cuora-max-tcp
npm install
# PowerShell:
npm start 192.168.1.50 4000       # <IP de la balanza> <puerto TCP real>
```
1. Reemplazar `192.168.1.50` por la IP real y `4000` por el **puerto TCP real** de la Cuora MAX
   (el `4000` es un placeholder — confirmar en el manual).
2. En consola: `[tcp] conectado a 192.168.1.50:4000` (sin `ECONNREFUSED`).
3. Abrir **http://localhost:3002** → mismo comportamiento que la opción A (peso en vivo + botón captura).

> Si da `ECONNREFUSED` o "Desconectado": IP/puerto mal, balanza no está en la red, o firewall. Probar primero
> `ping <ip>` y `Test-NetConnection <ip> -Port <puerto>` en PowerShell.

---

## Opción C — Electron desktop (sin navegador)

Transporte: COM serial directo en proceso (IPC). Para un ERP de escritorio en la misma PC que la balanza.

```bash
cd 03-desktop-com
npm install
# PowerShell:
$env:COM_PORT="COM5"; npm start
```
1. Se abre una **ventana de escritorio** (no navegador).
2. Poner peso → kg en vivo, tara, neto, `XOR ✓`. No hay endpoints REST (todo por IPC interno).

---

## Opción D — Web Serial API · http://localhost:5004 (solo Chrome/Edge)

Transporte: el navegador abre el COM directo. Prototipo rápido, sin backend.

```bash
cd 04-web-serial
npm start                          # sirve en http://localhost:5004
```
1. Abrir **http://localhost:5004 en Chrome o Edge** (no Firefox/Safari, no `file://`).
2. Click **"Conectar balanza"** → el navegador abre un diálogo para **elegir el puerto COM** → seleccionar el de la balanza.
3. Poner peso → kg en vivo, tara, neto, `XOR ✓`.
4. Click **"Desconectar"** para liberar el puerto (importante: si queda tomado, las otras opciones no podrán abrir el mismo COM).

---

## Importante: un solo proceso por COM a la vez

El puerto COM lo toma **un solo programa**. No corras A, C y D apuntando al mismo `COMx` simultáneamente —
cerrá una antes de abrir la otra (síntoma de conflicto: "Access denied" / "File not found" / no abre).
La opción B (TCP) no compite por el COM.

---

## Diagnóstico rápido

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "no se pudo abrir COMx" | COM equivocado o tomado por otra app | Revisar Administrador de dispositivos; cerrar otras apps que usen el puerto |
| Conecta pero no llega peso | Balanza no responde a Función 1, o baudios mal | Probar otros baudios (9600), revisar que la balanza esté en modo protocolo correcto |
| `XOR ✗` en las tramas | Ruido en la línea / baudios incorrectos | Confirmar 115200/8N1, cable, longitud |
| Peso siempre "Inestable" | Balanza sin asentar o vibración | Esperar a que se estabilice; es normal mientras se mueve |
| Opción B `ECONNREFUSED` | IP/puerto mal o balanza fuera de red | `Test-NetConnection <ip> -Port <puerto>` |

> Si **ninguna** opción recibe datos pero el puerto abre bien, el primer sospechoso es el **baudrate** o el
> **modo de protocolo de la balanza**. El 115200 viene del ejemplo VB oficial de Systel; si no responde,
> probar 9600 es el primer paso. Ver [`00-conexion-balanza.md`](./00-conexion-balanza.md) (sección "Plan de validación").
