# Pruebas de conexión a balanza Systel (Cuora / Cuora MAX)

4 pruebas de concepto independientes, una por carpeta, cada una con una **interfaz web simple** para verificar
que el peso de la balanza llega correctamente a la PC. Todas usan el mismo protocolo **maestro-esclavo @115200**
(trama `[Dir][Func][Datos][XOR]`, polling de **Función 1**). Ver fundamentos en `../00-conexion-balanza.md`.

Cada UI muestra: peso en kg · semáforo (verde estable / amarillo inestable / rojo desconectado) · tara · neto ·
**trama cruda en hex** · validación de **XOR**.

## Las alternativas

| Carpeta | Opción | Transporte balanza → SW | Al navegador | Correr | URL |
|---|---|---|---|---|---|
| `01-bridge-local/`  | **A** Bridge local *(recomendada, funcionó 2026-06-23)* | COM serial (FTDI) | REST + WebSocket | `npm install && npm start` | http://localhost:3001 · `/venta.html` |
| `01.1-bridge-reportes/` | **A.1** Bridge + reportes de venta (F1 peso + F72 ventas + F32 cierre) | COM serial (FTDI) | REST + WebSocket | `npm install && npm start` | http://localhost:3001 · `/reportes.html` |
| `02-cuora-max-tcp/` | **B** Cuora MAX TCP | Socket TCP a IP balanza | REST + WebSocket | `npm install && npm start <ip> <port>` | http://localhost:3002 |
| `03-desktop-com/`   | **C** Electron desktop | COM serial (FTDI) | IPC (app nativa) | `npm install && npm start` | ventana Electron |
| `04-web-serial/`    | **D** Web Serial *(prototipo)* | COM desde el navegador | directo | `npm start` | http://localhost:5004 (Chrome/Edge) |

## Estado actual (sin hardware)

Cada PoC **levanta igual sin balanza** y muestra "Desconectado" — eso confirma que el plumbing (server, WebSocket,
REST, IPC, página) funciona. La verificación **funcional** (ver peso real llegar) se hace cuando esté la balanza.
No hay modo simulador (decisión tomada): el código apunta solo a hardware real.

## Cómo conectar

👉 **Guía de conexión (autocontenida):** [`CONEXION.md`](./CONEXION.md) — cómo conectar la balanza,
variantes de conexión, puertos usados y diagnóstico. **Empezá por acá.**

👉 **Guía paso a paso extendida:** [`COMO-PROBAR-CON-BALANZA.md`](./COMO-PROBAR-CON-BALANZA.md) — preparación del driver,
cómo identificar el COM, comandos por opción, qué confirma una prueba exitosa y diagnóstico.

> ⚠️ El driver FTDI (`CDM21228_Setup.exe`) **no está en este repo** (binario del fabricante). Está en la
> carpeta hermana `Drivers_Cuora-...` del proyecto o se baja de FTDI (VCP driver).

Resumen:
1. Instalar driver FTDI `../Drivers_Cuora-Cuora_Max-Cuora_Max_ST_CDM21228_Setup/CDM21228_Setup.exe`.
2. Confirmar el `COMx` en Administrador de dispositivos (opciones A, C, D) o la IP de la Cuora MAX (opción B).
3. Setear el COM/IP, arrancar la PoC, colocar peso → debe verse kg en vivo, semáforo verde al estabilizar y `XOR ✓`.

## Notas

- **115200 / 8 / N / 1** confirmado por el ejemplo VB oficial de Systel. Si no responde, probar otros baudios es el 1er diagnóstico.
- Cuora habla por polling (no streaming): se pide Función 1 cada 400 ms.
- La lógica de protocolo (`buildFrame`, `verifyXOR`, `parseWeightFn1`) está copiada en cada carpeta para que sean independientes.
