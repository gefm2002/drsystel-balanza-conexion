'use strict';
// Valida el parser nuevo contra (a) la trama REAL capturada y (b) el simulador. Sin balanza.
const fs = require('fs');
const P = require('./protocol');
const sim = require('./simulator');

// ---- (a) trama real capturada ----
const txt = fs.readFileSync('C:/Users/matia/.claude/projects/C--Users-matia-OneDrive-Escritorio-DrSystel/4c1c5452-77b8-4934-a3f7-1c56ff608c2d/tool-results/bra5jau4q.txt','utf8');
const i = txt.indexOf('[F72 amplio]');
const hs = txt.indexOf('hex:', i) + 4, he = txt.indexOf('\n', hs);
const buf = Buffer.from(txt.slice(hs, he).trim().split(/\s+/).map(h=>parseInt(h,16)));
const payload = buf.subarray(2, buf.length-1).toString('ascii');
const tickets = P.parseSalesReport(payload);
console.log('REAL: tickets parseados =', tickets.length);
const t386 = tickets.find(t => t.ticketId === 386);
console.log('Ticket #386 ->', JSON.stringify(t386, null, 0));
console.log('  esperado: plu=1, gramos=100 (0.100kg), tipo=PESO, importe=2800');
console.log('  OK?', t386 && t386.plu===1 && t386.gramos===100 && t386.tipo==='PESO' && t386.importe===2800);
// un par mas para ver importes
console.log('  #384 (unidad 8001):', JSON.stringify(tickets.find(t=>t.ticketId===384)));

// ---- (b) simulador por el mismo parser ----
const frameSim = sim.buildSalesReportFrame();
const r = P.parseSalesReportFrame(frameSim);
console.log('\nSIM: xorOk =', r.xorOk, '| tickets =', r.tickets.length);
r.tickets.forEach(t => console.log(`  #${t.ticketId} plu=${t.plu} ${t.tipo} ${t.gramos?(t.gramos/1000)+'kg':'x'+t.unidades} $${t.importe}`));
console.log('  esperado: 4 tickets, queso $10000, coca $5000, jamon $4050, pan $5400');

// ---- (c) filtro por fecha ----
console.log('\nfechaKey("25/06/26")=', P.fechaKey('25/06/26'), 'fechaKey("250626")=', P.fechaKey('250626'), '(deben coincidir)');
