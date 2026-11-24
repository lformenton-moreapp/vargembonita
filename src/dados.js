// Funções compartilhadas entre o app do missionário e o painel.
import L from 'leaflet';
import { CENTRO_MAPA, COR_NAO_VISITADA, STATUS } from './config.js';
import { listarAtribuicoes, listarCasasNovas, listarVisitas } from './store.js';

export const ESPECIE_CASA_NOVA = 0;

// Junta os pontos do CNEFE com as casas adicionadas pelo GPS e calcula o
// status atual (última visita) de cada ponto.
export async function montarEstado(base) {
  const [visitas, novas, atribuicoes] = await Promise.all([listarVisitas(), listarCasasNovas(), listarAtribuicoes()]);
  const casas = base.casas.concat(novas.map((n) => ({
    id: n.id,
    logradouro: n.descricao || 'Ponto marcado no mapa',
    numero: '',
    complemento: '',
    localidade: n.localidade || '',
    estabelecimento: '',
    lat: n.lat,
    lng: n.lng,
    especie: ESPECIE_CASA_NOVA,
    nova: n,
  })));
  const porCasa = new Map();
  for (const v of visitas.sort((a, b) => a.criado_em.localeCompare(b.criado_em))) {
    if (!porCasa.has(v.casa_id)) porCasa.set(v.casa_id, []);
    porCasa.get(v.casa_id).push(v);
  }
  for (const c of casas) {
    c.visitas = porCasa.get(c.id) || [];
    c.ultima = c.visitas[c.visitas.length - 1] || null;
  }
  const grupos = agrupar(casas);
  const grupoDe = new Map();
  for (const g of grupos) for (const c of g.casas) grupoDe.set(c.id, g);
  const porId = new Map(casas.map((c) => [c.id, c]));
  // Área (quarteirão/comunidade) de cada ponto; pontos marcados herdam a do endereço mais próximo.
  for (const c of casas) c.area = c.a || porId.get(c.nova?.cnefe_id)?.a || null;
  const areaDe = new Map(atribuicoes.map((a) => [a.quarteirao_id, a.equipe]));
  return { casas, visitas, grupos, grupoDe, porId, areaDe };
}

// O IBGE cadastra cada moradia separadamente, mesmo no mesmo terreno
// (ex.: "Casa A" e "Fundos"). Pontos a menos de ~4 m viram um só grupo.
const RAIO_GRUPO_M = 4;
function agrupar(casas) {
  const passo = RAIO_GRUPO_M / 111000;
  const grade = new Map();
  const grupos = [];
  const chave = (i, j) => `${i}:${j}`;
  for (const c of casas) {
    // Pontos marcados no mapa pelas equipes não se juntam com os do IBGE.
    if (c.especie === ESPECIE_CASA_NOVA) { grupos.push({ id: c.id, lat: c.lat, lng: c.lng, casas: [c] }); continue; }
    const i = Math.floor(c.lat / passo), j = Math.floor(c.lng / passo);
    let achou = null;
    for (let di = -1; di <= 1 && !achou; di++) {
      for (let dj = -1; dj <= 1 && !achou; dj++) {
        for (const g of grade.get(chave(i + di, j + dj)) || []) {
          const dy = (g.lat - c.lat) * 111000, dx = (g.lng - c.lng) * 104000;
          if (dx * dx + dy * dy <= RAIO_GRUPO_M ** 2) { achou = g; break; }
        }
      }
    }
    if (achou) achou.casas.push(c);
    else {
      const g = { id: c.id, lat: c.lat, lng: c.lng, casas: [c] };
      grupos.push(g);
      const k = chave(i, j);
      if (!grade.has(k)) grade.set(k, []);
      grade.get(k).push(g);
    }
  }
  return grupos;
}

// Ordem de prioridade para colorir um grupo: o que ainda falta fazer aparece primeiro.
const PRIORIDADE = [null, 'amarelo', 'laranja', 'verde', 'azul', 'cinza', 'vermelho'];
function resumoGrupo(g) {
  const status = g.casas.map((c) => c.ultima?.status || null);
  return {
    principal: PRIORIDADE.find((s) => status.includes(s)),
    parcial: status.includes(null) && status.some(Boolean),
    visitadoQualquer: status.find(Boolean),
  };
}

// Pin (gota) em SVG. Tamanho conforme o zoom; a ponta fica exatamente no local.
function alturaPin(zoom) {
  if (zoom <= 14) return 20;
  if (zoom === 15) return 24;
  if (zoom === 16) return 28;
  return 34;
}

function iconePin(g, selecionado, zoom) {
  const s = resumoGrupo(g);
  const h = alturaPin(zoom) + (selecionado ? 10 : 0);
  const w = Math.round(h * 0.75);
  let fundo, borda, miolo;
  if (!s.principal) { fundo = '#ffffff'; borda = '#334155'; miolo = '#334155'; }          // não visitado
  else if (s.parcial) { fundo = '#ffffff'; borda = STATUS[s.visitadoQualquer].cor; miolo = STATUS[s.visitadoQualquer].cor; }
  else { fundo = STATUS[s.principal].cor; borda = '#ffffff'; miolo = '#ffffff'; }
  if (selecionado) borda = '#111827';
  const n = g.casas.length > 1 ? `<span class="pin-num">${g.casas.length}</span>` : '';
  return L.divIcon({
    className: 'pin',
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    html: `<svg viewBox="0 0 24 32" width="${w}" height="${h}" aria-hidden="true">
      <path d="M12 1C5.9 1 1 5.8 1 11.8c0 7.9 9.4 18 10.2 18.8a1.1 1.1 0 0 0 1.6 0C13.6 29.8 23 19.7 23 11.8 23 5.8 18.1 1 12 1z"
        fill="${fundo}" stroke="${borda}" stroke-width="${selecionado ? 2.6 : 2}"/>
      <circle cx="12" cy="11.8" r="4.2" fill="${miolo}"/>
    </svg>${n}`,
  });
}

export function desenharGrupos(camada, grupos, { zoom, selecionada = null, aoTocar, popup }) {
  camada.clearLayers();
  // De cima para baixo na tela, para os pins mais ao sul ficarem na frente.
  for (const g of [...grupos].sort((a, b) => b.lat - a.lat)) {
    const sel = selecionada && g.casas.some((c) => c.id === selecionada);
    const m = L.marker([g.lat, g.lng], { icon: iconePin(g, sel, zoom), keyboard: false, zIndexOffset: sel ? 1000 : 0 }).addTo(camada);
    if (aoTocar) m.on('click', () => aoTocar(g));
    if (popup) m.bindPopup(() => popup(g), { maxHeight: 300, offset: [0, -alturaPin(zoom)] });
  }
}

export function nomeEspecie(base, c) {
  if (c.especie === ESPECIE_CASA_NOVA) return 'Marcado pela equipe';
  return base.especies[c.especie] || 'Outro';
}

export function endereco(c) {
  const linha = [c.logradouro, c.numero].filter(Boolean).join(', ');
  return [linha, c.complemento].filter(Boolean).join(' – ');
}

export const corDe = (c) => (c.ultima ? STATUS[c.ultima.status]?.cor : COR_NAO_VISITADA) || COR_NAO_VISITADA;

export function criarMapa(elemento) {
  const mapa = L.map(elemento, {
    preferCanvas: true,
    zoomControl: false,
    renderer: L.canvas({ tolerance: 10 }),
  }).setView(CENTRO_MAPA, 17);
  L.control.zoom({ position: 'bottomleft' }).addTo(mapa);
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const satelite = L.layerGroup([
    L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 19, maxNativeZoom: 18,
      attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics',
    }),
    L.tileLayer(`${esri}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18 }),
    L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18 }),
  ]);
  let modo = 'satelite';
  try { modo = localStorage.getItem('mvb-fundo-v2') || 'satelite'; } catch { /* sem armazenamento */ }
  const Botao = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const b = L.DomUtil.create('button', 'btn-fundo');
      b.type = 'button';
      const aplicar = () => {
        mapa.removeLayer(ruas); mapa.removeLayer(satelite);
        (modo === 'satelite' ? satelite : ruas).addTo(mapa);
        b.textContent = modo === 'satelite' ? '🗺️ Mapa' : '🛰️ Satélite';
      };
      L.DomEvent.disableClickPropagation(b);
      b.onclick = () => {
        modo = modo === 'satelite' ? 'ruas' : 'satelite';
        try { localStorage.setItem('mvb-fundo-v2', modo); } catch { /* ok */ }
        aplicar();
      };
      aplicar();
      return b;
    },
  });
  new Botao().addTo(mapa);
  return mapa;
}

// ---------- Áreas (trechos de rua / comunidades rurais) ----------

export function nomeArea(a) {
  if (a.tipo !== 'rua') return `${a.nome} (zona rural)`;
  if (a.de && a.ate) return `${a.nome}, entre ${a.de} e ${a.ate}`;
  if (a.de || a.ate) return `${a.nome}, a partir de ${a.de || a.ate}`;
  return a.nome;
}

export const pontosArea = (a) => a.linha || a.contorno;

const tamanho = (a) => {
  let la0 = 90, la1 = -90, ln0 = 180, ln1 = -180;
  for (const [la, ln] of pontosArea(a)) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); ln0 = Math.min(ln0, ln); ln1 = Math.max(ln1, ln); }
  return (la1 - la0) * (ln1 - ln0);
};

// Desenha as áreas: comunidades (polígonos) por baixo, ruas (linhas) por cima.
// modo 'painel': todas, na cor da equipe ou tracejadas em branco se livres.
// modo 'equipe': destaca as da própria equipe; as das outras equipes ficam finas e tracejadas.
export function desenharAreas(camada, areas, areaDe, equipes, { modo, minhaEquipe, aoTocar, rotulo }) {
  camada.clearLayers();
  const cor = (nome) => equipes.find((e) => e.nome === nome)?.cor || '#9ca3af';
  const comunidades = areas.filter((a) => a.tipo !== 'rua').sort((a, b) => tamanho(b) - tamanho(a));
  const ruas = areas.filter((a) => a.tipo === 'rua');
  for (const a of [...comunidades, ...ruas]) {
    const dono = areaDe.get(a.id);
    const minha = dono && dono === minhaEquipe;
    const interativo = modo === 'painel';
    let camadaPrincipal;
    if (a.tipo === 'rua') {
      if (modo === 'painel') {
        if (dono) L.polyline(a.linha, { color: '#111827', weight: 10, opacity: 0.55, interactive: false }).addTo(camada);
        camadaPrincipal = L.polyline(a.linha, dono
          ? { color: cor(dono), weight: 6, opacity: 1 }
          : { color: '#ffffff', weight: 4, opacity: 0.85, dashArray: '3 7' });
      } else if (minha) {
        L.polyline(a.linha, { color: '#111827', weight: 11, opacity: 0.55, interactive: false }).addTo(camada);
        camadaPrincipal = L.polyline(a.linha, { color: cor(dono), weight: 7, opacity: 1, interactive: false });
      } else if (dono) {
        camadaPrincipal = L.polyline(a.linha, { color: cor(dono), weight: 3, opacity: 0.8, dashArray: '6 6', interactive: false });
      } else continue;
    } else {
      if (modo === 'painel') {
        camadaPrincipal = L.polygon(a.contorno, dono
          ? { color: cor(dono), weight: 2.5, fillColor: cor(dono), fillOpacity: 0.35 }
          : { color: '#ffffff', weight: 1.5, dashArray: '4 4', fillColor: '#ffffff', fillOpacity: 0.06 });
      } else if (minha) {
        camadaPrincipal = L.polygon(a.contorno, { color: cor(dono), weight: 4, fillColor: cor(dono), fillOpacity: 0.12, interactive: false });
      } else if (dono) {
        camadaPrincipal = L.polygon(a.contorno, { color: cor(dono), weight: 1.5, dashArray: '6 6', opacity: 0.7, fill: false, interactive: false });
      } else continue;
    }
    camadaPrincipal.addTo(camada);
    if (interativo) {
      if (aoTocar) camadaPrincipal.on('click', () => aoTocar(a));
      if (rotulo) camadaPrincipal.bindTooltip(() => rotulo(a), { sticky: true });
    }
  }
}

export function linkRota(c) {
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
}

export function dataHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
