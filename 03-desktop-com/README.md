# Opción C — Electron (COM directo en proceso)

App de escritorio: el proceso principal de Electron abre el COM @115200, hace polling de la **Función 1** y
envía el peso al renderer por **IPC** (sin HTTP, sin red). Aplica si el ERP fuera **desktop** en la misma PC
que la balanza. Latencia mínima, una sola pieza.

## Correr

```bash
npm install                      # descarga el binario de Electron (~pesado, 1ra vez)
npm start                        # detecta solo el COM del FTDI de la balanza
# o:  COM_PORT=COM5 npm start    (PowerShell: $env:COM_PORT="COM5"; npm start)
```

Se abre una ventana de escritorio (no navegador).

## Qué vas a ver

- **Sin balanza:** ventana con semáforo rojo "Desconectado" (confirma que Electron + IPC + serial arrancan).
- **Con balanza:** peso en vivo, tara, neto, trama hex y `XOR ✓`.

## Requisitos hardware

- Driver FTDI `CDM21228_Setup.exe`; confirmar `COMx` en Administrador de dispositivos.
- Balanza en 115200 / 8 / N / 1.
