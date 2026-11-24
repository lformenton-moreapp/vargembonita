// Converte o CSV do CNEFE 2022 (IBGE) em public/data/casas.json.
// Uso: npm run dados [caminho-do-csv]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entrada = resolve(raiz, process.argv[2] || '3170602_VARGEM_BONITA.csv');
const saida = resolve(raiz, 'public/data/casas.json');
const saidaQuarteiroes = resolve(raiz, 'public/data/quarteiroes.json');

// Códigos de COD_ESPECIE segundo o dicionário do CNEFE 2022.
const ESPECIES = {
  1: 'Domicílio particular',
  2: 'Domicílio coletivo',
  3: 'Estabelecimento agropecuário',
  4: 'Estabelecimento de ensino',
  5: 'Estabelecimento de saúde',
  6: 'Estabelecimento de outras finalidades',
  7: 'Edificação em construção',
  8: 'Estabelecimento religioso',
};

// O arquivo do IBGE costuma vir em UTF-8; se aparecer o caractere de
// substituição, relê como Latin-1.
const bruto = readFileSync(entrada);
let texto = bruto.toString('utf8');
if (texto.includes('�')) texto = bruto.toString('latin1');
texto = texto.replace(/^﻿/, '');

const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
const cab = linhas[0].split(';');
const col = Object.fromEntries(cab.map((n, i) => [n, i]));
for (const n of ['COD_UNICO_ENDERECO', 'LATITUDE', 'LONGITUDE', 'COD_ESPECIE', 'DSC_LOCALIDADE']) {
  if (!(n in col)) throw new Error(`Coluna ${n} não encontrada no CSV`);
}

const junta = (...p) => p.map((s) => (s || '').trim()).filter(Boolean).join(' ');
const titulo = (s) =>
  s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

// Área de trabalho de cada endereço: o quarteirão do IBGE. Na zona rural o
// IBGE usa a "quadra 0" para o setor inteiro (milhares de hectares); ali a
// área passa a ser a comunidade (localidade).
function idArea(setor, quadra, localidade) {
  if (quadra === '0' || quadra === '') return `rural-${localidade}`;
  return `${setor.slice(-6, -1)}-${quadra}`;
}

const casas = [];
let semCoord = 0;
for (const linha of linhas.slice(1)) {
  const c = linha.split(';');
  const g = (n) => (c[col[n]] || '').trim();
  const lat = parseFloat(g('LATITUDE'));
  const lng = parseFloat(g('LONGITUDE'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { semCoord++; continue; }

  const complemento = [1, 2, 3, 4, 5]
    .map((i) => junta(g(`NOM_COMP_ELEM${i}`), g(`VAL_COMP_ELEM${i}`)))
    .filter(Boolean).join(', ');
  const numero = g('NUM_ENDERECO');

  casas.push({
    id: g('COD_UNICO_ENDERECO'),
    logradouro: titulo(junta(g('NOM_TIPO_SEGLOGR'), g('NOM_TITULO_SEGLOGR'), g('NOM_SEGLOGR'))),
    numero: numero && numero !== '0' ? junta(numero, g('DSC_MODIFICADOR')) : 'S/N',
    complemento: titulo(complemento),
    localidade: titulo(g('DSC_LOCALIDADE')),
    estabelecimento: titulo(g('DSC_ESTABELECIMENTO')),
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    especie: Number(g('COD_ESPECIE')) || 0,
    q: idArea(g('COD_SETOR'), g('NUM_QUADRA'), titulo(g('DSC_LOCALIDADE'))),
  });
}

mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, JSON.stringify({ especies: ESPECIES, casas }));

// ---------- Quarteirões ----------
// O IBGE numera as quadras dentro de cada setor censitário. O contorno de
// cada quarteirão é o "envelope" dos seus endereços, com uma folga de 7 m.
const FOLGA_M = 7;
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((-20.33 * Math.PI) / 180);

function envoltoria(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inf = [], sup = [];
  for (const x of p) { while (inf.length >= 2 && cruz(inf.at(-2), inf.at(-1), x) <= 0) inf.pop(); inf.push(x); }
  for (const x of p.reverse()) { while (sup.length >= 2 && cruz(sup.at(-2), sup.at(-1), x) <= 0) sup.pop(); sup.push(x); }
  return inf.slice(0, -1).concat(sup.slice(0, -1));
}

const porQuadra = new Map();
for (const c of casas) {
  if (!porQuadra.has(c.q)) porQuadra.set(c.q, []);
  porQuadra.get(c.q).push(c);
}
const quarteiroes = [];
for (const [id, cs] of porQuadra) {
  const pts = [];
  for (const c of cs) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI;
      pts.push([c.lng + (Math.cos(a) * FOLGA_M) / M_LNG, c.lat + (Math.sin(a) * FOLGA_M) / M_LAT]);
    }
  }
  const loc = Object.entries(cs.reduce((a, c) => ((a[c.localidade] = (a[c.localidade] || 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1])[0][0];
  quarteiroes.push({
    id,
    rural: id.startsWith('rural-'),
    nome: id.startsWith('rural-') ? loc : `Quarteirão ${id}`,
    localidade: loc,
    enderecos: cs.length,
    casas: cs.filter((c) => c.especie === 1 || c.especie === 2).length,
    contorno: envoltoria(pts).map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)]),
  });
}
writeFileSync(saidaQuarteiroes, JSON.stringify(quarteiroes));
console.log(`\n${quarteiroes.length} quarteirões gravados em ${saidaQuarteiroes}`);

const conta = (f) => Object.entries(casas.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {}))
  .sort((a, b) => b[1] - a[1]);

console.log(`\n${casas.length} pontos gravados em ${saida}`);
if (semCoord) console.log(`${semCoord} linhas descartadas por não terem coordenada`);
console.log('\nPor espécie:');
for (const [k, n] of conta((x) => x.especie)) console.log(`  ${String(n).padStart(5)}  ${k} - ${ESPECIES[k] || '?'}`);
console.log('\nPor localidade:');
for (const [k, n] of conta((x) => x.localidade)) console.log(`  ${String(n).padStart(5)}  ${k}`);
