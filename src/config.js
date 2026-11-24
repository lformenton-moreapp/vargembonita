// Configuração geral do app.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Sem as variáveis do Supabase o app roda em "modo demonstração":
// tudo fica guardado só no navegador deste aparelho.
export const MODO_DEMO = !(SUPABASE_URL && SUPABASE_ANON_KEY);

export const META_BIBLIAS = 1500;

// Centro aproximado da sede de Vargem Bonita (MG).
export const CENTRO_MAPA = [-20.3275, -46.3665];

// Tipos de pin. `biblia`: pergunta da bíblia aparece e já vem marcada (true),
// aparece desmarcada (false) ou não aparece (null).
export const STATUS = {
  verde: { nome: 'Aceitou a bíblia', curto: 'Aceitou a bíblia', cor: '#16a34a', biblia: true },
  laranja: { nome: 'Querem dar continuidade', curto: 'Continuidade', cor: '#f97316', biblia: true, contato: true },
  amarelo: { nome: 'Tentar novamente', curto: 'Tentar novamente', cor: '#eab308', biblia: null },
  azul: { nome: 'Comércio / escola', curto: 'Comércio/escola', cor: '#2563eb', biblia: false },
  cinza: { nome: 'Abandonada / em construção', curto: 'Abandonada/obra', cor: '#6b7280', biblia: null },
  vermelho: { nome: 'Não quiseram receber', curto: 'Não quiseram', cor: '#dc2626', biblia: null },
};
export const COR_NAO_VISITADA = '#9ca3af';

export async function carregarEquipes() {
  const r = await fetch(`${import.meta.env.BASE_URL}equipes.json`, { cache: 'no-cache' });
  return r.json();
}

// Áreas de trabalho: trechos de rua (cidade) e comunidades (zona rural).
export async function carregarAreas() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/areas.json`);
  return (await r.json()).areas;
}

export async function carregarCasas() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/casas.json`);
  return r.json();
}
