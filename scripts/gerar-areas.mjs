// Gera as áreas de trabalho que a coordenação distribui entre as equipes:
//  - na cidade: trechos de rua (de esquina a esquina), a partir do traçado do
//    OpenStreetMap em dados-fonte/ruas-osm.geojson;
//  - na zona rural: comunidades (localidades do IBGE).
// Cada endereço do IBGE é ligado ao trecho de rua mais próximo; quem fica
// longe de qualquer rua vai para a comunidade dele.
// Uso: npm run dados   (roda depois de gerar-casas.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arqCasas = resolve(raiz, 'public/data/casas.json');
const arqRuas = resolve(raiz, 'dados-fonte/ruas-osm.geojson');
const arqAreas = resolve(raiz, 'public/data/areas.json');

const TIPOS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian']);
const DIST_RUA_M = 60;          // endereço a até 60 m de uma rua pertence a ela
const DIST_RUA_URBANO_M = 150;  // na cidade, aceita até 150 m
const FOLGA_PONTA_M = 25;       // quanto o trecho passa do primeiro/último endereço
const FOLGA_RURAL_M = 40;

const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((-20.33 * Math.PI) / 180);
const xy = ([lat, lng]) => [lng * M_LNG, lat * M_LAT];
const ll = ([x, y]) => [+(y / M_LAT).toFixed(6), +(x / M_LNG).toFixed(6)];

const base = JSON.parse(readFileSync(arqCasas, 'utf8'));
const casas = base.casas;
const osm = JSON.parse(readFileSync(arqRuas, 'utf8'));

// ---------- 1. Ruas → trechos entre esquinas ----------
const vias = osm.features
  .filter((f) => f.geometry?.type === 'LineString' && TIPOS.has(f.properties.highway))
  .map((f) => ({
    id: String(f.properties['@id'] || f.id).replace('way/', ''),
    nome: f.properties.name || f.properties.ref || '',
    pts: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  }));

const chave = ([lat, lng]) => `${lat.toFixed(7)},${lng.toFixed(7)}`;
const usoNo = new Map();   // nó → nomes das vias que passam por ele
for (const v of vias) {
  for (const p of v.pts) {
    const k = chave(p);
    if (!usoNo.has(k)) usoNo.set(k, []);
    usoNo.get(k).push(v);
  }
}
const ehEsquina = (p) => (usoNo.get(chave(p)) || []).length >= 2;
const ruaCruzada = (p, v) => {
  const outras = (usoNo.get(chave(p)) || []).filter((o) => o !== v && o.nome && o.nome !== v.nome);
  return outras[0]?.nome || '';
};

let trechos = [];
for (const v of vias) {
  let atual = [v.pts[0]];
  let k = 0;
  for (let i = 1; i < v.pts.length; i++) {
    atual.push(v.pts[i]);
    if ((ehEsquina(v.pts[i]) && i < v.pts.length - 1) || i === v.pts.length - 1) {
      trechos.push({ id: `r${v.id}-${k++}`, via: v, nomeOsm: v.nome, pts: atual,
        de: ruaCruzada(atual[0], v), ate: ruaCruzada(atual.at(-1), v) });
      atual = [v.pts[i]];
    }
  }
}
for (const t of trechos) {
  t.xy = t.pts.map(xy);
  t.acum = [0];
  for (let i = 1; i < t.xy.length; i++) t.acum.push(t.acum[i - 1] + Math.hypot(t.xy[i][0] - t.xy[i - 1][0], t.xy[i][1] - t.xy[i - 1][1]));
  t.enderecos = [];
}

// Distância de um ponto ao trecho e posição (em metros ao longo do trecho).
function projeta(t, p) {
  let melhor = { d: Infinity, s: 0 };
  for (let i = 1; i < t.xy.length; i++) {
    const [ax, ay] = t.xy[i - 1], [bx, by] = t.xy[i];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2));
    const d = Math.hypot(ax + u * dx - p[0], ay + u * dy - p[1]);
    if (d < melhor.d) melhor = { d, s: t.acum[i - 1] + u * Math.sqrt(L2) };
  }
  return melhor;
}

// ---------- 2. Endereço → trecho mais próximo ----------
const semRua = [];
for (const c of casas) {
  const p = xy([c.lat, c.lng]);
  let melhor = null;
  for (const t of trechos) {
    const r = projeta(t, p);
    if (!melhor || r.d < melhor.d) melhor = { ...r, t };
  }
  const rural = c.q.startsWith('rural-');
  const limite = rural ? DIST_RUA_M : DIST_RUA_URBANO_M;
  if (melhor && melhor.d <= limite) {
    melhor.t.enderecos.push({ c, s: melhor.s });
    c.a = melhor.t.id;
  } else {
    semRua.push(c);
  }
}
trechos = trechos.filter((t) => t.enderecos.length);

// Corta o trecho para cobrir só a parte com casas (rodovias longas, por exemplo).
function corta(t, s0, s1) {
  const out = [];
  const ponto = (s) => {
    let i = 1;
    while (i < t.acum.length - 1 && t.acum[i] < s) i++;
    const seg = t.acum[i] - t.acum[i - 1] || 1e-9;
    const u = Math.max(0, Math.min(1, (s - t.acum[i - 1]) / seg));
    return [t.xy[i - 1][0] + u * (t.xy[i][0] - t.xy[i - 1][0]), t.xy[i - 1][1] + u * (t.xy[i][1] - t.xy[i - 1][1])];
  };
  out.push(ponto(s0));
  for (let i = 0; i < t.xy.length; i++) if (t.acum[i] > s0 && t.acum[i] < s1) out.push(t.xy[i]);
  out.push(ponto(s1));
  return out.map(ll);
}

const maisComum = (lista) => Object.entries(lista.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {}))
  .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

const ruas = trechos.map((t) => {
  const ss = t.enderecos.map((e) => e.s);
  const total = t.acum.at(-1);
  const s0 = Math.max(0, Math.min(...ss) - FOLGA_PONTA_M);
  const s1 = Math.min(total, Math.max(...ss) + FOLGA_PONTA_M);
  const cortado = s0 > 1 || s1 < total - 1;
  const doIbge = maisComum(t.enderecos.map((e) => e.c.logradouro));
  return {
    id: t.id,
    tipo: 'rua',
    nome: t.nomeOsm || doIbge || 'Rua sem nome',
    de: cortado ? '' : t.de,
    ate: cortado ? '' : t.ate,
    localidade: maisComum(t.enderecos.map((e) => e.c.localidade)),
    enderecos: t.enderecos.length,
    casas: t.enderecos.filter((e) => e.c.especie === 1 || e.c.especie === 2).length,
    linha: cortado ? corta(t, s0, s1) : t.pts.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]),
  };
});

// ---------- 3. Zona rural: comunidades ----------
function envoltoria(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inf = [], sup = [];
  for (const x of p) { while (inf.length >= 2 && cruz(inf.at(-2), inf.at(-1), x) <= 0) inf.pop(); inf.push(x); }
  for (const x of p.reverse()) { while (sup.length >= 2 && cruz(sup.at(-2), sup.at(-1), x) <= 0) sup.pop(); sup.push(x); }
  return inf.slice(0, -1).concat(sup.slice(0, -1));
}
const porLocal = new Map();
for (const c of semRua) {
  const k = c.localidade || 'Sem localidade';
  if (!porLocal.has(k)) porLocal.set(k, []);
  porLocal.get(k).push(c);
}
const rurais = [];
for (const [nome, cs] of porLocal) {
  const id = `c-${nome}`;
  const pts = [];
  for (const c of cs) {
    c.a = id;
    const [x, y] = xy([c.lat, c.lng]);
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * 2 * Math.PI;
      pts.push([x + Math.cos(ang) * FOLGA_RURAL_M, y + Math.sin(ang) * FOLGA_RURAL_M]);
    }
  }
  rurais.push({
    id, tipo: 'comunidade', nome, localidade: nome,
    enderecos: cs.length,
    casas: cs.filter((c) => c.especie === 1 || c.especie === 2).length,
    contorno: envoltoria(pts).map(ll),
  });
}

writeFileSync(arqAreas, JSON.stringify({
  fonte: 'Ruas: © colaboradores do OpenStreetMap (ODbL). Endereços: IBGE, CNEFE 2022.',
  areas: [...ruas, ...rurais],
}));
writeFileSync(arqCasas, JSON.stringify(base));

console.log(`\n${ruas.length} trechos de rua e ${rurais.length} comunidades rurais gravados em ${arqAreas}`);
console.log(`Endereços em trechos de rua: ${casas.length - semRua.length}; em comunidades: ${semRua.length}`);
const porNome = new Map();
for (const r of ruas) porNome.set(r.nome, (porNome.get(r.nome) || 0) + 1);
console.log(`${porNome.size} ruas diferentes. Maiores trechos:`);
for (const r of [...ruas].sort((a, b) => b.enderecos - a.enderecos).slice(0, 8)) {
  console.log(`  ${String(r.enderecos).padStart(4)}  ${r.nome}${r.de ? ` (entre ${r.de} e ${r.ate})` : ''} · ${r.localidade}`);
}
