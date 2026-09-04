# Opción D — Web Serial API (navegador puro, sin backend)

El navegador (solo **Chrome / Edge**) abre el COM directamente con `navigator.serial` y hace polling de la
**Función 1**. Sin servidor intermedio. Útil como **prototipo** rápido; frágil para producción (requiere
contexto seguro, permiso manual del usuario y sigue necesitando el driver FTDI).

## Correr

```bash
npm start            # sirve en http://localhost:5004  (no abras el .html con file://)
# alternativa sin este server:  npx http-server -p 5004
```

Abrir **http://localhost:5004** en Chrome/Edge → botón **"Conectar balanza"** → elegir el puerto COM en el diálogo.

## Qué vas a ver

- **Sin balanza:** la página carga en "Desconectado"; al apretar "Conectar" se abre el selector de puertos del navegador.
- **Con balanza:** tras elegir el COM, peso en vivo, tara, neto, trama hex y `XOR ✓`.

## Requisitos

- Chrome o Edge (Firefox/Safari no soportan Web Serial).
- Servir por `http://localhost` o HTTPS (no `file://`).
- Driver FTDI `CDM21228_Setup.exe` instalado.
