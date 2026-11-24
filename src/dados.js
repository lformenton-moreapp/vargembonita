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

// Domicílios aparecem com borda branca; demais pontos (comércio, fazenda,
// igreja...) com borda preta; casas novas com borda azul.
export function estiloMarcador(c, selecionada = false) {
  const borda = c.especie === ESPECIE_CASA_NOVA ? '#1d4ed8' : (c.especie === 1 || c.especie === 2) ? '#ffffff' : '#111827';
  return {
    radius: selecionada ? 11 : 7,
    color: selecionada ? '#111827' : borda,
    weight: selecionada ? 4 : 2,
    fillColor: corDe(c),
    fillOpacity: 0.95,
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
