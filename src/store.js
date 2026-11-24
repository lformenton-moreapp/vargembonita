// Armazenamento local (IndexedDB) + sincronização opcional com o Supabase.
//
// Toda visita e toda casa nova é gravada primeiro no aparelho com
// `pendente: 1`. Quando há internet (e o Supabase está configurado) os
// registros pendentes são enviados e marcados como `pendente: 0`; em
// seguida o app baixa os registros das outras equipes.
import { MODO_DEMO, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const NOME_DB = 'missao-vargem-bonita';
const TABELAS = { visitas: 'visitas', casasNovas: 'casas_novas', contatos: 'contatos' };

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((ok, erro) => {
      const req = indexedDB.open(NOME_DB, 3);
      req.onupgradeneeded = (ev) => {
        const d = req.result;
        if (ev.oldVersion < 1) {
          d.createObjectStore('visitas', { keyPath: 'id' }).createIndex('casa_id', 'casa_id');
          d.createObjectStore('casasNovas', { keyPath: 'id' });
        }
        if (ev.oldVersion < 2) d.createObjectStore('contatos', { keyPath: 'id' });
        if (ev.oldVersion < 3) d.createObjectStore('atribuicoes', { keyPath: 'quarteirao_id' });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((ok, erro) => {
    const t = d.transaction(store, modo);
    const s = t.objectStore(store);
    const res = fn(s);
    t.oncomplete = () => ok(res && 'result' in res ? res.result : res);
    t.onerror = () => erro(t.error);
  });
}

const todos = (store) => tx(store, 'readonly', (s) => s.getAll());

export const listarVisitas = () => todos('visitas');
export const listarCasasNovas = () => todos('casasNovas');
export const listarContatosLocais = () => todos('contatos');
export const listarAtribuicoes = () => todos('atribuicoes');

// Coordenação: entrega um quarteirão a uma equipe (ou tira, com equipe = null).
export async function atribuirQuarteiroes(ids, equipe, codigo) {
  if (!MODO_DEMO) {
    const sb = await cliente();
    for (const id of ids) {
      const { error } = await sb.rpc('atribuir_quarteirao', { codigo, quarteirao: id, equipe });
      if (error) throw error;
    }
  }
  await tx('atribuicoes', 'readwrite', (s) => ids.forEach((id) => (equipe
    ? s.put({ quarteirao_id: id, equipe, atualizado_em: new Date().toISOString() })
    : s.delete(id))));
  avisarMudanca();
}

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent('dados-mudaram'));
}

export function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Navegadores antigos: UUID v4 manual.
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

export async function salvarVisita(v) {
  const registro = { ...v, id: v.id || novoId(), criado_em: v.criado_em || new Date().toISOString(), pendente: 1 };
  await tx('visitas', 'readwrite', (s) => s.put(registro));
  avisarMudanca();
  sincronizar();
  return registro;
}

export async function salvarCasaNova(c) {
  const registro = { ...c, id: c.id || novoId(), criado_em: c.criado_em || new Date().toISOString(), pendente: 1 };
  await tx('casasNovas', 'readwrite', (s) => s.put(registro));
  avisarMudanca();
  sincronizar();
  return registro;
}

// Nome e telefone (pin laranja). Ficam no celular só até serem enviados.
export async function salvarContato(c) {
  const registro = { ...c, id: c.id || novoId(), criado_em: c.criado_em || new Date().toISOString(), pendente: 1 };
  await tx('contatos', 'readwrite', (s) => s.put(registro));
  sincronizar();
  return registro;
}

export async function contarPendentes() {
  if (MODO_DEMO) return 0;
  const [v, c] = await Promise.all([listarVisitas(), listarCasasNovas()]);
  const k = await listarContatosLocais();
  return v.filter((x) => x.pendente).length + c.filter((x) => x.pendente).length + k.length;
}

// Apaga tudo o que está guardado neste aparelho (usado no modo demonstração).
export async function limparTudo() {
  await tx('visitas', 'readwrite', (s) => s.clear());
  await tx('casasNovas', 'readwrite', (s) => s.clear());
  await tx('contatos', 'readwrite', (s) => s.clear());
  await tx('atribuicoes', 'readwrite', (s) => s.clear());
  avisarMudanca();
}

export async function gravarEmLote(store, registros) {
  await tx(store, 'readwrite', (s) => registros.forEach((r) => s.put(r)));
  avisarMudanca();
}

// ---------- Supabase ----------

let clientePromise;
function cliente() {
  if (MODO_DEMO) return null;
  if (!clientePromise) {
    clientePromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } }));
  }
  return clientePromise;
}

const semCamposLocais = ({ pendente, ...resto }) => resto;

async function enviar(sb, store) {
  const pendentes = (await todos(store)).filter((x) => x.pendente);
  if (!pendentes.length) return;
  // ignoreDuplicates = ON CONFLICT DO NOTHING: reenviar é seguro e só
  // exige permissão de INSERT no banco.
  const { error } = await sb.from(TABELAS[store])
    .upsert(pendentes.map(semCamposLocais), { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  await tx(store, 'readwrite', (s) => pendentes.forEach((r) => s.put({ ...r, pendente: 0 })));
}

// Contatos: depois de enviados, são apagados do celular (privacidade).
// Só a coordenação consegue lê-los no banco.
async function enviarContatos(sb) {
  const pendentes = await todos('contatos');
  for (const r of pendentes) {
    // Inserção simples (as equipes não têm permissão de leitura nos contatos).
    // Se já tinha chegado antes (código 23505 = repetido), está tudo certo.
    const { error } = await sb.from('contatos').insert(semCamposLocais(r));
    if (error && error.code !== '23505') throw error;
    await tx('contatos', 'readwrite', (s) => s.delete(r.id));
  }
}

export async function buscarContatosCoordenacao(codigo) {
  if (MODO_DEMO) return listarContatosLocais();
  const sb = await cliente();
  const { data, error } = await sb.rpc('contatos_coordenacao', { codigo });
  if (error) throw error;
  return data;
}

// Divisão das áreas: a versão do banco substitui a do celular.
async function baixarAtribuicoes(sb) {
  const { data, error } = await sb.from('atribuicoes').select('*');
  if (error) throw error;
  await tx('atribuicoes', 'readwrite', (s) => { s.clear(); data.forEach((r) => s.put(r)); });
}

// Para economizar internet (e o limite gratuito do Supabase), a primeira
// sincronização ao abrir o app baixa tudo; as seguintes só o que chegou
// depois (com 2 minutos de folga, para não perder nada que chegou junto).
const marca = { casasNovas: null, visitas: null };
const FOLGA_MS = 2 * 60 * 1000;

async function baixar(sb, store) {
  const linhas = [];
  const desde = marca[store] ? new Date(Date.parse(marca[store]) - FOLGA_MS).toISOString() : null;
  for (let de = 0; ; de += 1000) {
    let q = sb.from(TABELAS[store]).select('*');
    if (desde) q = q.gt('recebido_em', desde);
    const { data, error } = await q.order('recebido_em').order('id').range(de, de + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  for (const r of linhas) if (!marca[store] || r.recebido_em > marca[store]) marca[store] = r.recebido_em;
  if (!linhas.length) return;
  const locais = new Map((await todos(store)).map((x) => [x.id, x]));
  const novos = linhas.filter((r) => !locais.get(r.id)?.pendente).map((r) => ({ ...r, pendente: 0 }));
  await tx(store, 'readwrite', (s) => novos.forEach((r) => s.put(r)));
}

let sincronizando = null;
export let ultimoErro = null;
export let ultimaSync = null;

let ultimaAtribuicao = 0;

export function sincronizar(forcar = false) {
  if (MODO_DEMO || !navigator.onLine) return Promise.resolve(false);
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    try {
      const sb = await cliente();
      await enviar(sb, 'casasNovas');
      await enviar(sb, 'visitas');
      await enviarContatos(sb);
      await baixar(sb, 'casasNovas');
      await baixar(sb, 'visitas');
      // A divisão das áreas muda pouco: baixa ao abrir, a cada 5 minutos ou quando pedido.
      if (forcar || Date.now() - ultimaAtribuicao > 5 * 60 * 1000) {
        await baixarAtribuicoes(sb);
        ultimaAtribuicao = Date.now();
      }
      ultimoErro = null;
      ultimaSync = new Date();
      return true;
    } catch (e) {
      console.warn('Falha ao sincronizar', e);
      ultimoErro = e;
      return false;
    } finally {
      sincronizando = null;
      avisarMudanca();
    }
  })();
  return sincronizando;
}

export function iniciarSincronizacaoAutomatica(intervaloMs = 30000) {
  if (MODO_DEMO) return;
  window.addEventListener('online', () => sincronizar());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  setInterval(sincronizar, intervaloMs);
  sincronizar();
}
