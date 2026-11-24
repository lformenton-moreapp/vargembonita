// Funções compartilhadas entre o app do missionário e o painel.
import L from 'leaflet';
import { CENTRO_MAPA, COR_NAO_VISITADA, STATUS } from './config.js';
import { listarCasasNovas, listarVisitas } from './store.js';

export const ESPECIE_CASA_NOVA = 0;

// Junta os pontos do CNEFE com as casas adicionadas pelo GPS e calcula o
// status atual (última visita) de cada ponto.
export async function montarEstado(base) {
  const [visitas, novas] = await Promise.all([listarVisitas(), listarCasasNovas()]);
  const casas = base.casas.concat(novas.map((n) => ({
    id: n.id,
    logradouro: n.descricao || 'Casa adicionada pelo GPS',
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
  return { casas, visitas, porId: new Map(casas.map((c) => [c.id, c])) };
}

export function nomeEspecie(base, c) {
  if (c.especie === ESPECIE_CASA_NOVA) return 'Casa adicionada pelo GPS';
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
  }).setView(CENTRO_MAPA, 15);
  L.control.zoom({ position: 'bottomleft' }).addTo(mapa);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
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

// Casas: bolinha cheia com borda branca fina.
// Outros pontos (comércio, fazenda, igreja...) ainda não visitados: anel vazio.
// Casas adicionadas pelo GPS: borda azul.
export function estiloMarcador(c, selecionada = false, zoom = 16) {
  const r = raioPorZoom(zoom);
  if (selecionada) {
    return { radius: r + 5, color: '#111827', weight: 4, fillColor: corDe(c), fillOpacity: 1 };
  }
  const casa = c.especie === 1 || c.especie === 2 || c.especie === ESPECIE_CASA_NOVA;
  if (!casa && !c.ultima) {
    return { radius: r, color: '#64748b', weight: Math.max(1.5, r / 3), fillColor: '#ffffff', fillOpacity: 0.9 };
  }
  return {
    radius: c.ultima ? r + 1 : r,
    color: c.especie === ESPECIE_CASA_NOVA ? '#2563eb' : '#ffffff',
    weight: c.especie === ESPECIE_CASA_NOVA ? 2.5 : r >= 6 ? 1.5 : 1,
    fillColor: corDe(c),
    fillOpacity: c.ultima ? 1 : 0.85,
  };
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
