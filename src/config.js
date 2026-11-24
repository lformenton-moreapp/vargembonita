// Configuração geral do app.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Sem as variáveis do Supabase o app roda em "modo demonstração":
// tudo fica guardado só no navegador deste aparelho.
export const MODO_DEMO = !(SUPABASE_URL && SUPABASE_ANON_KEY);

export const META_BIBLIAS = 1500;

// Centro aproximado da sede de Vargem Bonita (MG).
export const CENTRO_MAPA = [-20.3275, -46.3665];

export const STATUS = {
  verde: { nome: 'Recebidos, bíblia entregue', curto: 'Recebidos', cor: '#15803d' },
  amarelo: { nome: 'Ninguém em casa / voltar depois', curto: 'Voltar depois', cor: '#eab308' },
  vermelho: { nome: 'Não quiseram receber', curto: 'Recusaram', cor: '#dc2626' },
};
export const COR_NAO_VISITADA = '#9ca3af';

export async function carregarEquipes() {
  const r = await fetch(`${import.meta.env.BASE_URL}equipes.json`, { cache: 'no-cache' });
  return r.json();
}

export async function carregarCasas() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/casas.json`);
  return r.json();
}
