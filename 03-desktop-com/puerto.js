'use strict';
// Detección automática del COM de la balanza: busca el adaptador FTDI de la Cuora (VID 0403 / PID 6001).
// El número de COM lo asigna Windows en cada PC (COM3, COM5, COM6...), por eso no se fija en el código.
// Si se define COM_PORT (env o argumento) el bridge lo usa tal cual y no llama a esta detección.

const { SerialPort } = require('serialport');

const FTDI_VID = '0403';
const FTDI_PID = '6001';

function esFtdi(p) {
  const vid = (p.vendorId || '').toLowerCase();
  const pid = (p.productId || '').toLowerCase();
  if (vid === FTDI_VID && pid === FTDI_PID) return true;
  // En Windows el pnpId del FTDI viene como FTDIBUS\VID_0403+PID_6001+...
  return new RegExp(`VID_${FTDI_VID}.PID_${FTDI_PID}`, 'i').test(p.pnpId || '');
}

// Devuelve el path del COM (ej. 'COM3') o lanza un error listando los puertos vistos.
async function detectarPuertoFtdi() {
  const puertos = await SerialPort.list();
  const ftdi = puertos.filter(esFtdi);
  if (ftdi.length > 1) {
    console.warn(`[serial] hay ${ftdi.length} adaptadores FTDI (${ftdi.map((p) => p.path).join(', ')}); uso ${ftdi[0].path}. Si no es la balanza, forzar con COM_PORT.`);
  }
  if (ftdi.length) return ftdi[0].path;
  const vistos = puertos.map((p) => `${p.path} (${p.friendlyName || p.manufacturer || '?'})`).join(', ') || 'ninguno';
  throw new Error(`no se encontró la balanza (FTDI ${FTDI_VID}:${FTDI_PID}). Puertos vistos: ${vistos}`);
}

module.exports = { detectarPuertoFtdi, esFtdi };
