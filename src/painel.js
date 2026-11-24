import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import { registerSW } from 'virtual:pwa-register';
import { carregarCasas, carregarEquipes, META_BIBLIAS, MODO_DEMO, STATUS } from './config.js';
import {
  buscarContatosCoordenacao, gravarEmLote, iniciarSincronizacaoAutomatica, limparTudo, novoId, sincronizar, ultimaSync, ultimoErro,
} from './store.js';
import { criarMapa, dataHora, endereco, esc, desenharGrupos, linkRota, montarEstado, nomeEspecie } from './dados.js';

registerSW({ immediate: true });

const $ = (s) => document.querySelector(s);
const CHAVE = 'mvb-painel';
const CASAS_OCUPADAS_CENSO = 876;
let base, equipes, estado, mapa, camada;

async function iniciar() {
  [equipes, base] = await Promise.all([carregarEquipes(), carregarCasas()]);
  if (sessionStorage.getItem(CHAVE) === '1') return abrirPainel();
  $('#tela-entrada').hidden = false;
  $('#form-entrada').onsubmit = (ev) => {
    ev.preventDefault();
    if ($('#inp-codigo').value.trim().toLowerCase() !== String(equipes.coordenacao).trim().toLowerCase()) {
      $('#erro-entrada').hidden = false;
      return;
    }
    sessionStorage.setItem(CHAVE, '1');
    sessionStorage.setItem('mvb-painel-codigo', $('#inp-codigo').value.trim());
    abrirPainel();
  };
}

async function abrirPainel() {
  $('#tela-entrada').hidden = true;
  $('#tela-painel').hidden = false;
  $('#demo-box').hidden = !MODO_DEMO;
  mapa = criarMapa('mapa');
  camada = L.layerGroup().addTo(mapa);
  mapa.on('zoomend', desenharMapa);
  window.addEventListener('dados-mudaram', atualizar);
  iniciarSincronizacaoAutomatica(20000);
  await atualizar();
  const todos = L.latLngBounds(base.casas.map((c) => [c.lat, c.lng]));
  mapa.fitBounds(todos, { padding: [10, 10] });
}

$('#btn-sync').onclick = () => (MODO_DEMO ? atualizar() : sincronizar());

async function atualizar() {
  estado = await montarEstado(base);
  indicador();
  contadores();
  desenharMapa();
  placar();
  amarelas();
  localidades();
  contatos();
}

function indicador() {
  const el = $('#indicador-sync');
  if (MODO_DEMO) { el.className = 'sync demo'; el.textContent = 'Modo demonstração'; return; }
  if (ultimoErro) { el.className = 'sync pendente'; el.textContent = 'Erro ao buscar dados – tentando de novo'; return; }
  el.className = 'sync ok';
  el.textContent = ultimaSync ? `Atualizado às ${ultimaSync.toLocaleTimeString('pt-BR')}` : 'Carregando…';
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const fmt = (n) => n.toLocaleString('pt-BR');

function contadores() {
  const visitadas = estado.casas.filter((c) => c.ultima);
  const casas = visitadas.filter((c) => !['azul'].includes(c.ultima.status));
  const biblias = estado.visitas.reduce((s, v) => s + (v.biblia ? v.qtd_biblias : 0), 0);
  const porCor = Object.fromEntries(Object.keys(STATUS).map((k) => [k, visitadas.filter((c) => c.ultima.status === k).length]));

  $('#contadores').innerHTML = `
    <div class="cont destaque">
      <div class="rotulo">Bíblias entregues</div>
      <div class="valor">${fmt(biblias)} <small>/ ${fmt(META_BIBLIAS)}</small></div>
      <div class="barra-prog"><span style="width:${Math.min(100, pct(biblias, META_BIBLIAS))}%"></span></div>
    </div>
    <div class="cont">
      <div class="rotulo">Casas visitadas</div>
      <div class="valor">${fmt(casas.length)} <small>/ ~${fmt(CASAS_OCUPADAS_CENSO)}</small></div>
      <div class="barra-prog"><span style="width:${Math.min(100, pct(casas.length, CASAS_OCUPADAS_CENSO))}%"></span></div>
      <div class="nota">Referência: casas ocupadas no Censo 2022. Sem contar comércios/escolas.</div>
    </div>
    ${Object.entries(STATUS).map(([k, st]) => `
      <div class="cont" style="--cor:${st.cor}">
        <div class="rotulo"><span class="ponto" style="background:${st.cor}"></span>${st.curto}</div>
        <div class="valor">${fmt(porCor[k])}</div>
      </div>`).join('')}`;
}

function desenharMapa() {
  // Sobre o satélite, mostra só o que já foi visitado.
  const visitados = estado.grupos.filter((g) => g.casas.some((c) => c.ultima));
  desenharGrupos(camada, visitados, {
    zoom: mapa.getZoom(),
    popup: (g) => g.casas.map(popup).join('<hr>'),
  });
}

function popup(c) {
  const u = c.ultima;
  return `<strong>${esc(endereco(c))}</strong><br>
    ${esc(c.localidade)} · ${esc(nomeEspecie(base, c))}<br>
    ${u ? `<b style="color:${STATUS[u.status]?.cor}">${STATUS[u.status]?.curto || u.status}</b> – ${dataHora(u.criado_em)} · ${esc(u.equipe)}
      ${u.observacao ? `<br><i>${esc(u.observacao)}</i>` : ''}<br>${c.visitas.length} visita(s)` : 'Não visitada'}
    <br><a href="${linkRota(c)}" target="_blank" rel="noopener">Abrir rota</a>`;
}

function placar() {
  const novo = () => ({ casas: new Set(), continuidade: 0, biblias: 0, visitas: 0 });
  const t = new Map(equipes.equipes.map((e) => [e.nome, novo()]));
  for (const v of estado.visitas) {
    if (!t.has(v.equipe)) t.set(v.equipe, novo());
    const x = t.get(v.equipe);
    x.casas.add(v.casa_id);
    x.visitas++;
    if (v.status === 'laranja') x.continuidade++;
    if (v.biblia) x.biblias += v.qtd_biblias;
  }
  const linhas = [...t.entries()].sort((a, b) => b[1].biblias - a[1].biblias || b[1].casas.size - a[1].casas.size);
  const medalha = ['🥇', '🥈', '🥉'];
  $('#placar').innerHTML = `
    <thead><tr><th></th><th>Equipe</th><th>Casas</th><th>Continuidade</th><th>Bíblias</th></tr></thead>
    <tbody>${linhas.map(([nome, x], i) => `
      <tr><td>${x.visitas ? medalha[i] || i + 1 : ''}</td><td><span class="ponto" style="width:14px;height:14px;background:${esc(equipes.equipes.find((e) => e.nome === nome)?.cor || '#ccc')}"></span> ${esc(nome)}</td>
      <td>${x.casas.size}</td><td>${x.continuidade}</td><td><b>${x.biblias}</b></td></tr>`).join('')}
    </tbody>`;
}

function amarelas() {
  const lista = estado.casas.filter((c) => c.ultima?.status === 'amarelo')
    .sort((a, b) => a.localidade.localeCompare(b.localidade) || a.logradouro.localeCompare(b.logradouro));
  $('#n-amarelas').textContent = lista.length;
  $('#amarelas').innerHTML = lista.length ? lista.map((c) => `
    <button class="item-amarela" data-id="${esc(c.id)}">
      <strong>${esc(endereco(c))}</strong>
      <span>${esc(c.localidade)} · ${dataHora(c.ultima.criado_em)} · ${esc(c.ultima.equipe)} · ${c.visitas.length}ª tentativa</span>
      ${c.ultima.observacao ? `<em>${esc(c.ultima.observacao)}</em>` : ''}
    </button>`).join('') : '<p class="vazio">Nenhuma casa para tentar novamente no momento.</p>';
  $('#amarelas').querySelectorAll('.item-amarela').forEach((b) => (b.onclick = () => {
    const c = estado.porId.get(b.dataset.id);
    mapa.setView([c.lat, c.lng], 18);
    L.popup().setLatLng([c.lat, c.lng]).setContent(popup(c)).openOn(mapa);
    $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

function localidades() {
  const m = new Map();
  const linha = (k) => { if (!m.has(k)) m.set(k, { ibge: 0, visit: 0, biblias: 0 }); return m.get(k); };
  for (const c of base.casas) linha(c.localidade || '(sem localidade)').ibge++;
  for (const c of estado.casas) {
    if (!c.ultima) continue;
    const x = linha(c.localidade || '(sem localidade)');
    x.visit++;
    x.biblias += c.visitas.reduce((s, v) => s + (v.biblia ? v.qtd_biblias : 0), 0);
  }
  const linhas = [...m.entries()].sort((a, b) => b[1].ibge - a[1].ibge);
  $('#localidades').innerHTML = `
    <thead><tr><th>Localidade</th><th>Endereços IBGE</th><th>Visitados</th><th>Bíblias</th></tr></thead>
    <tbody>${linhas.map(([k, x]) => `
      <tr><td>${esc(k)}</td><td>${x.ibge}</td><td>${x.visit}</td><td>${x.biblias}</td></tr>`).join('')}
    </tbody>`;
}

// ---------- Contatos (pin laranja) ----------

let listaContatos = [];
async function contatos() {
  const el = $('#contatos');
  try {
    listaContatos = await buscarContatosCoordenacao(sessionStorage.getItem('mvb-painel-codigo') || '');
  } catch (e) {
    el.innerHTML = `<p class="erro">Não foi possível carregar os contatos: ${esc(e.message)}</p>`;
    return;
  }
  listaContatos.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  $('#n-contatos').textContent = listaContatos.length;
  el.innerHTML = listaContatos.length ? `<table class="tabela tabela-contatos">
    <thead><tr><th>Nome</th><th>Telefone</th><th>Local</th><th>Equipe</th><th>Data</th></tr></thead>
    <tbody>${listaContatos.map((k) => {
      const c = estado.porId.get(k.casa_id);
      const tel = (k.telefone || '').replace(/\D/g, '');
      return `<tr><td>${esc(k.nome)}</td>
        <td>${tel ? `<a href="https://wa.me/55${tel.replace(/^55/, '')}" target="_blank" rel="noopener">${esc(k.telefone)}</a>` : ''}</td>
        <td>${esc(c ? endereco(c) : '')}</td><td>${esc(k.equipe)}</td><td>${dataHora(k.criado_em)}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="vazio">Nenhum contato registrado ainda.</p>';
}

// ---------- Exportar CSV ----------

function baixarCsv(nome, cab, linhas) {
  const cel = (v) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM + ';' para o Excel em português abrir com acentos e colunas certas.
  const texto = '﻿' + [cab, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const hoje = () => new Date().toISOString().slice(0, 10);

$('#btn-csv-visitas').onclick = () => {
  const linhas = [...estado.visitas].sort((a, b) => a.criado_em.localeCompare(b.criado_em)).map((v) => {
    const c = estado.porId.get(v.casa_id) || {};
    return [new Date(v.criado_em).toLocaleString('pt-BR'), v.equipe, v.casa_id, endereco(c), c.nova?.cnefe_id || '', c.localidade,
      c.especie != null ? nomeEspecie(base, c) : '', STATUS[v.status]?.curto, v.biblia ? 'sim' : 'não', v.qtd_biblias,
      v.observacao, c.lat, c.lng];
  });
  baixarCsv(`visitas-vargem-bonita-${hoje()}.csv`,
    ['data_hora', 'equipe', 'ponto_id', 'endereco_aproximado', 'cnefe_id_mais_proximo', 'localidade', 'tipo_ponto', 'status', 'biblia_entregue',
      'qtd_biblias', 'observacao', 'lat', 'lng'], linhas);
};

$('#btn-csv-contatos').onclick = () => {
  const linhas = listaContatos.map((k) => {
    const c = estado.porId.get(k.casa_id) || {};
    return [new Date(k.criado_em).toLocaleString('pt-BR'), k.nome, k.telefone, endereco(c), c.localidade, k.equipe, c.lat, c.lng];
  });
  baixarCsv(`contatos-continuidade-${hoje()}.csv`,
    ['data_hora', 'nome', 'telefone', 'local', 'localidade', 'equipe', 'lat', 'lng'], linhas);
};

$('#btn-csv-casas').onclick = () => {
  const linhas = estado.casas.map((c) => [c.id, c.logradouro, c.numero, c.complemento, c.localidade, nomeEspecie(base, c),
    c.estabelecimento, c.lat, c.lng, c.ultima ? STATUS[c.ultima.status]?.curto : 'Não visitada', c.visitas.length,
    c.visitas.reduce((s, v) => s + (v.biblia ? v.qtd_biblias : 0), 0),
    c.ultima ? new Date(c.ultima.criado_em).toLocaleString('pt-BR') : '', c.ultima?.equipe || '']);
  baixarCsv(`casas-vargem-bonita-${hoje()}.csv`,
    ['casa_id', 'logradouro', 'numero', 'complemento', 'localidade', 'especie', 'estabelecimento', 'lat', 'lng',
      'status_atual', 'n_visitas', 'biblias_entregues', 'ultima_visita', 'ultima_equipe'], linhas);
};

// ---------- Modo demonstração ----------

$('#btn-exemplo').onclick = async () => {
  if (!confirm('Gerar cerca de 450 visitas fictícias para demonstração?')) return;
  const nomes = equipes.equipes.map((e) => e.nome);
  const sorteio = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const alvo = base.casas.filter((c) => ['Centro', 'Campinopolis', 'Confusao'].includes(c.localidade) || Math.random() < 0.15);
  const agora = Date.now();
  const visitas = [];
  const contatosEx = [];
  const tipo = (c) => {
    if (c.especie === 7) return 'cinza';
    if (c.especie !== 1 && c.especie !== 2 && c.especie !== 3) return 'azul';
    const r = Math.random();
    return r < 0.55 ? 'verde' : r < 0.7 ? 'laranja' : r < 0.88 ? 'amarelo' : r < 0.93 ? 'cinza' : 'vermelho';
  };
  for (const c of alvo) {
    if (Math.random() > 0.55) continue;
    const status = tipo(c);
    const t = agora - Math.random() * 2 * 864e5;
    const equipe = sorteio(nomes);
    const biblia = status === 'verde' || status === 'laranja' || (status === 'azul' && Math.random() < 0.4);
    const v = { id: novoId(), casa_id: c.id, equipe, status, biblia, qtd_biblias: biblia ? (Math.random() < 0.15 ? 2 : 1) : 0,
      observacao: status === 'amarelo' ? sorteio(['', 'Voltar à tarde', 'Casa fechada', 'Pediram para voltar sábado'])
        : status === 'azul' ? (c.estabelecimento || sorteio(['Mercado', 'Padaria', 'Escola'])) : '',
      tem_contato: status === 'laranja', criado_em: new Date(t).toISOString(), pendente: 0 };
    visitas.push(v);
    if (status === 'laranja') {
      contatosEx.push({ id: novoId(), visita_id: v.id, casa_id: c.id, equipe, nome: 'Contato de exemplo',
        telefone: '(00) 00000-0000', consentimento: true, criado_em: v.criado_em, pendente: 0 });
    }
    // Parte das casas "tentar novamente" já recebeu a segunda visita.
    if (status === 'amarelo' && Math.random() < 0.35) {
      visitas.push({ id: novoId(), casa_id: c.id, equipe: sorteio(nomes), status: 'verde', biblia: true, qtd_biblias: 1,
        observacao: '', criado_em: new Date(Math.min(agora, t + 6 * 36e5)).toISOString(), pendente: 0 });
    }
  }
  await gravarEmLote('contatos', contatosEx);
  await gravarEmLote('visitas', visitas);
};

$('#btn-limpar').onclick = async () => {
  if (confirm('Apagar TODAS as visitas e casas novas guardadas neste navegador?')) await limparTudo();
};

iniciar();
