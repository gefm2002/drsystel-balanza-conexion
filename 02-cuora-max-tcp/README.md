# Opción B — Cuora MAX por TCP/IP

La Cuora MAX tiene **red nativa**. El backend abre un **socket TCP a la IP de la balanza**, hace polling de
la **Función 1** y re-expone el dato por REST + WebSocket. No requiere instalar nada en la caja ni driver FTDI.
Solo aplica a **Cuora MAX** (la Cuora 2 no tiene red → usar Opción A).

## Correr

```bash
npm install
npm start 192.168.1.50 4000      # IP y puerto de la balanza
# o por entorno:
SCALE_IP=192.168.1.50 SCALE_PORT=4000 npm start
```

Abrir **http://localhost:3002**

## Qué vas a ver

- **Sin balanza / IP equivocada:** semáforo rojo "Desconectado" con reintento cada 2s (el server web igual levanta).
- **Con balanza MAX en red:** peso en vivo, tara, neto, trama hex y `XOR ✓`; botón "Capturar peso" = `GET /peso`.

## Pendiente de confirmar con el equipo real

- **Puerto TCP** que expone la Cuora MAX (el `4000` es un placeholder — verificar en el manual / Anexos VI-VII).
- IP fija o reserva DHCP para la balanza.

## Endpoints

- `GET /peso` · `GET /estado` · `ws://localhost:3002` (igual forma de JSON que la Opción A).
