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
  for (const c of casas) c.area = c.q || porId.get(c.nova?.cnefe_id)?.q || null;
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

export function estiloGrupo(g, selecionado, zoom) {
  const r = raioPorZoom(zoom) + (g.casas.length > 1 ? 1 : 0);
  const s = resumoGrupo(g);
  if (selecionado) {
    return { radius: r + 5, color: '#111827', weight: 4, fillColor: s.principal ? STATUS[s.principal].cor : '#ffffff', fillOpacity: 1 };
  }
  // Endereço do IBGE ainda não visitado (só aparece no modo "todos os endereços"): anel vazio.
  if (!s.principal) return { radius: r, color: '#334155', weight: Math.max(1.5, r / 3), fillColor: '#ffffff', fillOpacity: 0.7 };
  // Parte das moradias do ponto visitada: anel na cor da visita.
  if (s.parcial) return { radius: r + 1, color: STATUS[s.visitadoQualquer].cor, weight: Math.max(2.5, r / 2), fillColor: '#ffffff', fillOpacity: 0.9 };
  return { radius: r + 2, color: '#ffffff', weight: 2, fillColor: STATUS[s.principal].cor, fillOpacity: 1 };
}

// Desenha os grupos no mapa. Com zoom de perto, mostra quantas moradias há no ponto.
export function desenharGrupos(camada, grupos, { zoom, selecionada = null, aoTocar, popup }) {
  camada.clearLayers();
  for (const g of grupos) {
    const sel = selecionada && g.casas.some((c) => c.id === selecionada);
    const m = L.circleMarker([g.lat, g.lng], { ...estiloGrupo(g, sel, zoom), bubblingMouseEvents: false }).addTo(camada);
    if (aoTocar) m.on('click', () => aoTocar(g));
    if (popup) m.bindPopup(() => popup(g), { maxHeight: 300 });
    if (g.casas.length > 1 && zoom >= 16) {
      L.marker([g.lat, g.lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'contagem', html: String(g.casas.length), iconSize: [18, 18], iconAnchor: [-2, 20] }),
      }).addTo(camada);
    }
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

// Tamanho do ponto conforme o zoom: pequeno de longe, maior de perto.
export function raioPorZoom(zoom) {
  if (zoom <= 13) return 3;
  if (zoom === 14) return 4;
  if (zoom === 15) return 5;
  if (zoom === 16) return 6;
  if (zoom === 17) return 7;
  return 9;
}

// ---------- Áreas (quarteirões / comunidades) ----------

const tamanho = (q) => {
  let la0 = 90, la1 = -90, ln0 = 180, ln1 = -180;
  for (const [la, ln] of q.contorno) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); ln0 = Math.min(ln0, ln); ln1 = Math.max(ln1, ln); }
  return (la1 - la0) * (ln1 - ln0);
};

// Desenha as áreas. Maiores por baixo, para as pequenas continuarem clicáveis.
// modo 'painel': todas, preenchidas na cor da equipe. modo 'equipe': destaca as da própria equipe.
export function desenharAreas(camada, quarteiroes, areaDe, equipes, { modo, minhaEquipe, aoTocar, rotulo }) {
  camada.clearLayers();
  const cor = (nome) => equipes.find((e) => e.nome === nome)?.cor || '#9ca3af';
  const camadas = new Map();
  for (const q of [...quarteiroes].sort((a, b) => tamanho(b) - tamanho(a))) {
    const dono = areaDe.get(q.id);
    let estilo;
    if (modo === 'painel') {
      estilo = dono
        ? { color: cor(dono), weight: 2.5, fillColor: cor(dono), fillOpacity: 0.4 }
        : { color: '#ffffff', weight: 1.5, dashArray: '4 4', fillColor: '#ffffff', fillOpacity: 0.08 };
    } else if (dono === minhaEquipe) {
      estilo = { color: cor(dono), weight: 4, fillColor: cor(dono), fillOpacity: 0.12, interactive: false };
    } else if (dono) {
      estilo = { color: cor(dono), weight: 1.5, dashArray: '6 6', opacity: 0.7, fill: false, interactive: false };
    } else continue;
    const pol = L.polygon(q.contorno, estilo).addTo(camada);
    if (modo === 'painel') {
      if (aoTocar) pol.on('click', () => aoTocar(q));
      if (rotulo) pol.bindTooltip(() => rotulo(q), { sticky: true });
    }
    camadas.set(q.id, pol);
  }
  return camadas;
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
