'use strict';
// Sondeo crudo F72 sobre COM5: confirma F1, luego prueba F72 con varias tramas y vuelca TODO lo que llega.
const { SerialPort } = require('serialport');
const P = require('./protocol');

const PORT = process.env.COM_PORT || 'COM5';
const hex = (b) => Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(' ');
const asc = (b) => Array.from(b).map(x=> (x>=32&&x<127)?String.fromCharCode(x):'.').join('');

let rx = [];
function dumpRx(tag){
  const b = Buffer.from(rx);
  console.log(`  [${tag}] ${b.length} bytes`);
  if (b.length){ console.log('    hex: '+hex(b)); console.log('    asc: '+asc(b)); }
  rx = [];
}

const port = new SerialPort({ path: PORT, baudRate: 115200, dataBits:8, parity:'none', stopBits:1, autoOpen:false });
port.on('data', (c)=>{ for (const x of c) rx.push(x); });
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));

(async ()=>{
  await new Promise((res,rej)=>port.open(e=>e?rej(e):res()));
  console.log('abierto', PORT, '@115200');

  rx=[]; port.write(P.buildFrame(0,1)); await wait(500); dumpRx('F1 peso');

  rx=[]; let f = P.buildFrame(0,72,'250626250626');
  console.log('F72 hoy ->', hex(f)); port.write(f); await wait(2500); dumpRx('F72 hoy');

  rx=[]; f = P.buildFrame(0,72,'010100311299');
  console.log('F72 amplio ->', hex(f)); port.write(f); await wait(2500); dumpRx('F72 amplio');

  rx=[]; f = P.buildFrame(0,72,'');
  console.log('F72 sin rango ->', hex(f)); port.write(f); await wait(2500); dumpRx('F72 sin rango');

  port.close(()=>process.exit(0));
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
