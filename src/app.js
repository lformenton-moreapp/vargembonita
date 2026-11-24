import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import { registerSW } from 'virtual:pwa-register';
import { carregarCasas, carregarEquipes, MODO_DEMO, STATUS } from './config.js';
import {
  contarPendentes, iniciarSincronizacaoAutomatica, salvarCasaNova, salvarContato, salvarVisita, sincronizar, ultimoErro,
} from './store.js';
import {
  criarMapa, dataHora, endereco, esc, desenharGrupos, linkRota, montarEstado, nomeEspecie,
} from './dados.js';

registerSW({ immediate: true });

const $ = (s) => document.querySelector(s);
const CHAVE_EQUIPE = 'mvb-equipe';
const FILTROS = [
  { nome: 'só visitadas', ok: (c) => !!c.ultima },
  { nome: 'todos os endereços do IBGE', ok: () => true },
];

let base, estado, mapa, camada, camadaToque, equipe, corEquipe, marcadorEu;
let selecionada = null;
let filtro = 0;

async function iniciar() {
  const [equipes, casas] = await Promise.all([carregarEquipes(), carregarCasas()]);
  base = casas;
  const salva = localStorage.getItem(CHAVE_EQUIPE);
  const eq = equipes.equipes.find((e) => e.nome === salva);
  equipe = eq?.nome;
  corEquipe = eq?.cor;
  if (equipe) abrirMapa();
  else mostrarEntrada(equipes);
}

function mostrarEntrada(equipes) {
  $('#tela-entrada').hidden = false;
  $('#tela-mapa').hidden = true;
  $('#sel-equipe').innerHTML = '<option value="">Selecione…</option>' +
    equipes.equipes.map((e) => `<option value="${esc(e.nome)}">Equipe ${esc(e.nome)}</option>`).join('');
  $('#form-entrada').onsubmit = (ev) => {
    ev.preventDefault();
    const e = equipes.equipes.find((x) => x.nome === $('#sel-equipe').value);
    if (!e || e.codigo.trim().toLowerCase() !== $('#inp-codigo').value.trim().toLowerCase()) {
      $('#erro-entrada').hidden = false;
      return;
    }
    localStorage.setItem(CHAVE_EQUIPE, e.nome);
    equipe = e.nome;
    corEquipe = e.cor;
    abrirMapa();
  };
}

async function abrirMapa() {
  $('#tela-entrada').hidden = true;
  $('#tela-mapa').hidden = false;
  $('#nome-equipe').innerHTML = `${corEquipe ? `<span class="cor-equipe" style="background:${esc(corEquipe)}"></span>` : ''}Equipe ${esc(equipe)}`;
  if (!mapa) {
    mapa = criarMapa('mapa');
    camada = L.layerGroup().addTo(mapa);
    camadaToque = L.layerGroup().addTo(mapa);
    mapa.on('zoomend', desenhar);
    mapa.on('click', (ev) => tocarNoMapa(ev.latlng));
    window.addEventListener('dados-mudaram', atualizar);
    window.addEventListener('online', atualizarIndicador);
    window.addEventListener('offline', atualizarIndicador);
    iniciarSincronizacaoAutomatica();
  }
  setTimeout(() => mapa.invalidateSize(), 0);
  await atualizar();
}

$('#btn-sair').onclick = () => {
  if (!confirm('Sair desta equipe? As visitas já registradas continuam salvas.')) return;
  localStorage.removeItem(CHAVE_EQUIPE);
  location.reload();
};

$('#btn-filtro').onclick = () => {
  filtro = (filtro + 1) % FILTROS.length;
  $('#btn-filtro').textContent = `Mostrando: ${FILTROS[filtro].nome}`;
  desenhar();
};

async function atualizar() {
  estado = await montarEstado(base);
  desenhar();
  atualizarIndicador();
  // Se a folha de uma casa está aberta, atualiza o histórico dela.
  if (selecionada && !$('#folha').hidden && $('#historico')) {
    $('#historico').innerHTML = historicoHtml(estado.porId.get(selecionada));
  }
}

function desenhar() {
  const visiveis = estado.grupos.filter((g) => g.casas.some((c) => FILTROS[filtro].ok(c) || c.id === selecionada));
  desenharGrupos(camada, visiveis, {
    zoom: mapa.getZoom(),
    selecionada,
    aoTocar: (g) => (g.casas.length === 1 ? abrirCasa(g.casas[0].id) : abrirGrupo(g)),
  });
}

async function atualizarIndicador() {
  const el = $('#indicador-sync');
  if (MODO_DEMO) {
    el.className = 'sync demo';
    el.textContent = 'Modo demonstração – dados só neste aparelho';
    return;
  }
  const n = await contarPendentes();
  if (n === 0) {
    el.className = 'sync ok';
    el.textContent = '✓ Tudo enviado';
  } else {
    el.className = 'sync pendente';
    el.textContent = `⏳ ${n} pendente${n > 1 ? 's' : ''} de envio` +
      (!navigator.onLine ? ' (sem sinal)' : ultimoErro ? ' (erro, tentando de novo)' : '');
  }
}
$('#indicador-sync').onclick = () => sincronizar();

// ---------- Folha (painel inferior) ----------

function abrirFolha(html) {
  $('#folha-corpo').innerHTML = html;
  $('#folha').hidden = false;
  $('#folha-corpo').scrollTop = 0;
}

function fecharFolha() {
  $('#folha').hidden = true;
  camadaToque.clearLayers();
  selecionada = null;
  desenhar();
}
$('#folha').addEventListener('click', (ev) => { if (ev.target.id === 'folha') fecharFolha(); });

function historicoHtml(c) {
  if (!c || !c.visitas.length) return '<p class="vazio">Nenhuma visita registrada ainda.</p>';
  return '<ul class="historico">' + [...c.visitas].reverse().map((v) => {
    const st = STATUS[v.status] || { cor: '#9ca3af', curto: v.status };
    return `
    <li>
      <span class="ponto" style="background:${st.cor}"></span>
      <div>
        <strong>${esc(st.curto)}</strong>
        ${v.biblia ? ` · ${v.qtd_biblias} bíblia${v.qtd_biblias > 1 ? 's' : ''}` : ''}
        ${v.tem_contato ? ' · 📇 contato registrado' : ''}
        <div class="meta">${dataHora(v.criado_em)} · ${esc(v.equipe)}${v.pendente && !MODO_DEMO ? ' · <em>pendente</em>' : ''}</div>
        ${v.observacao ? `<div class="obs">${esc(v.observacao)}</div>` : ''}
      </div>
    </li>`;
  }).join('') + '</ul>';
}

// Vários cadastros do IBGE no mesmo ponto (só no modo "todos os endereços").
function abrirGrupo(g) {
  selecionada = g.casas[0].id;
  desenhar();
  abrirFolha(`
    <button class="fechar" aria-label="Fechar">✕</button>
    <h2>${g.casas.length} endereços neste ponto</h2>
    <p class="meta">O IBGE cadastrou cada moradia separadamente. Toque na que vocês visitaram.</p>
    <div class="lista-grupo">
      ${g.casas.map((c) => `
        <button class="item-grupo" data-id="${esc(c.id)}">
          <span class="ponto" style="background:${c.ultima ? STATUS[c.ultima.status]?.cor : '#fff'}"></span>
          <span><strong>${esc(endereco(c))}</strong>
          <small>${esc([nomeEspecie(base, c), c.estabelecimento, c.ultima ? STATUS[c.ultima.status]?.curto : 'Não visitada'].filter(Boolean).join(' · '))}</small></span>
        </button>`).join('')}
    </div>
  `);
  $('#folha-corpo .fechar').onclick = fecharFolha;
  $('#folha-corpo').querySelectorAll('.item-grupo').forEach((b) => (b.onclick = () => abrirCasa(b.dataset.id)));
}

const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 104000);

// Toque no telhado: abre direto o formulário para um ponto novo naquele lugar.
function tocarNoMapa(ll) {
  camadaToque.clearLayers();
  L.circleMarker(ll, { radius: 12, color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 0.45, interactive: false })
    .addTo(camadaToque);
  abrirFormulario({ ponto: { lat: ll.lat, lng: ll.lng } });
}

function abrirCasa(id) {
  const c = estado.porId.get(id);
  if (!c) return;
  selecionada = id;
  camadaToque.clearLayers();
  desenhar();
  abrirFormulario({ casa: c });
}

// Formulário da visita. `alvo` é { casa } (ponto que já existe) ou { ponto: {lat, lng, precisao} } (novo).
function abrirFormulario(alvo) {
  const c = alvo.casa;
  const pos = c || alvo.ponto;
  const prox = maisProxima([pos.lat, pos.lng]);
  const perto = prox && distM(prox, pos) <= 60 ? prox : null;
  const grupo = c && estado.grupoDe.get(c.id);

  let titulo, meta;
  if (c) {
    titulo = endereco(c);
    meta = [c.localidade, nomeEspecie(base, c), c.estabelecimento].filter(Boolean).join(' · ');
  } else {
    titulo = 'Registrar visita aqui';
    meta = [perto ? `Perto de ${endereco(perto)}` : 'Sem endereço do IBGE por perto', prox?.localidade,
      alvo.ponto.precisao ? `GPS ±${alvo.ponto.precisao} m` : ''].filter(Boolean).join(' · ');
  }

  abrirFolha(`
    <button class="fechar" aria-label="Fechar">✕</button>
    ${grupo && grupo.casas.length > 1 ? `<button class="voltar-grupo" type="button">← Outros ${grupo.casas.length - 1} endereço(s) neste ponto</button>` : ''}
    <h2>${esc(titulo)}</h2>
    <p class="meta">${esc(meta)}</p>

    <div class="status-grade">
      ${Object.entries(STATUS).map(([k, st]) => `
        <button type="button" class="btn-status" data-status="${k}" style="--cor:${st.cor}">
          <span class="ponto" style="background:${st.cor}"></span>${esc(st.nome)}
        </button>`).join('')}
    </div>

    <div id="detalhes" hidden>
      <div id="bloco-biblia">
        <h3>Bíblia entregue?</h3>
        <div class="linha">
          <div class="seg">
            <button type="button" data-biblia="1">Sim</button>
            <button type="button" data-biblia="0">Não</button>
          </div>
          <div class="contador" id="contador">
            <button type="button" data-qtd="-1">−</button>
            <output id="qtd">1</output>
            <button type="button" data-qtd="1">+</button>
          </div>
        </div>
      </div>

      <div id="bloco-contato">
        <h3>Contato para continuidade</h3>
        <label>Nome<input id="ct-nome" maxlength="80" autocomplete="off" /></label>
        <label>Telefone / WhatsApp<input id="ct-tel" type="tel" maxlength="20" autocomplete="off" placeholder="(37) 9 9999-9999" /></label>
        <label class="consentimento"><input id="ct-ok" type="checkbox" />
          <span>A pessoa autorizou guardar o nome e o telefone para a igreja entrar em contato.</span></label>
        <p class="dica">Só a coordenação vê esses dados.</p>
      </div>

      <h3 id="obs-titulo">Observação <small>(opcional)</small></h3>
      <textarea id="obs" maxlength="200" rows="2"></textarea>
      <p class="dica" id="obs-dica">⚠️ Não escreva nomes, telefones ou dados pessoais aqui.</p>

      <button id="btn-salvar" class="btn btn-primario btn-grande">Salvar</button>
    </div>

    ${c ? `<a class="btn btn-leve btn-bloco" href="${linkRota(c)}" target="_blank" rel="noopener">🧭 Ir até aqui (Google Maps)</a>
    <h3>Histórico deste ponto</h3>
    <div id="historico">${historicoHtml(c)}</div>` : ''}
  `);

  const f = { status: null, biblia: false, qtd: 1 };
  const corpo = $('#folha-corpo');
  const render = () => {
    const st = STATUS[f.status];
    corpo.querySelectorAll('.btn-status').forEach((b) => b.classList.toggle('ativo', b.dataset.status === f.status));
    $('#detalhes').hidden = !st;
    if (!st) return;
    $('#bloco-biblia').hidden = st.biblia === null;
    $('#bloco-contato').hidden = !st.contato;
    corpo.querySelectorAll('[data-biblia]').forEach((b) => b.classList.toggle('ativo', (b.dataset.biblia === '1') === f.biblia));
    $('#contador').classList.toggle('desligado', !f.biblia);
    $('#qtd').textContent = f.qtd;
    const azul = f.status === 'azul';
    $('#obs-titulo').innerHTML = azul ? 'Qual comércio ou escola? <small>(observação)</small>' : 'Observação <small>(opcional)</small>';
    $('#obs').placeholder = azul ? 'Ex.: Escola Municipal, mercado, padaria…' : f.status === 'amarelo' ? 'Ex.: voltar à tarde' : '';
  };
  corpo.querySelector('.fechar').onclick = fecharFolha;
  const voltar = corpo.querySelector('.voltar-grupo');
  if (voltar) voltar.onclick = () => abrirGrupo(grupo);
  corpo.querySelectorAll('.btn-status').forEach((b) => (b.onclick = () => {
    f.status = b.dataset.status;
    f.biblia = STATUS[f.status].biblia === true;
    render();
    $('#detalhes').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  corpo.querySelectorAll('[data-biblia]').forEach((b) => (b.onclick = () => { f.biblia = b.dataset.biblia === '1'; render(); }));
  corpo.querySelectorAll('[data-qtd]').forEach((b) => (b.onclick = () => {
    if (!f.biblia) return;
    f.qtd = Math.min(20, Math.max(1, f.qtd + Number(b.dataset.qtd)));
    render();
  }));

  $('#btn-salvar').onclick = async () => {
    const st = STATUS[f.status];
    let contato = null;
    if (st.contato) {
      const nome = $('#ct-nome').value.trim();
      const telefone = $('#ct-tel').value.trim();
      if (nome || telefone) {
        if (!$('#ct-ok').checked) {
          avisar('Marque que a pessoa autorizou guardar o contato (ou apague nome e telefone).');
          return;
        }
        contato = { nome, telefone };
      }
    }
    const btn = $('#btn-salvar');
    btn.disabled = true;

    let casaId = c?.id;
    if (!c) {
      const nova = await salvarCasaNova({
        lat: +alvo.ponto.lat.toFixed(6),
        lng: +alvo.ponto.lng.toFixed(6),
        precisao_m: alvo.ponto.precisao || null,
        descricao: perto ? `Perto de ${endereco(perto)}` : '',
        cnefe_id: perto?.id || null,
        localidade: prox?.localidade || '',
        equipe,
      });
      casaId = nova.id;
    }
    const visita = await salvarVisita({
      casa_id: casaId,
      equipe,
      status: f.status,
      biblia: st.biblia !== null && f.biblia,
      qtd_biblias: st.biblia !== null && f.biblia ? f.qtd : 0,
      observacao: $('#obs').value.trim(),
      tem_contato: !!contato,
    });
    if (contato) {
      await salvarContato({ ...contato, consentimento: true, visita_id: visita.id, casa_id: casaId, equipe });
    }
    fecharFolha();
    avisar(MODO_DEMO || !navigator.onLine ? 'Visita salva no aparelho ✓' : 'Visita salva ✓');
  };
  render();
}

// ---------- GPS ----------

function posicaoAtual() {
  return new Promise((ok, erro) => {
    if (!navigator.geolocation) return erro(new Error('Este aparelho não tem GPS disponível.'));
    navigator.geolocation.getCurrentPosition(ok, erro, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

function mostrarEu(pos) {
  const ll = [pos.coords.latitude, pos.coords.longitude];
  if (!marcadorEu) {
    marcadorEu = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#0ea5e9', fillOpacity: 1, interactive: false }).addTo(mapa);
  } else marcadorEu.setLatLng(ll);
  return ll;
}

$('#btn-local').onclick = async () => {
  avisar('Procurando sua localização…');
  try {
    const ll = mostrarEu(await posicaoAtual());
    mapa.setView(ll, Math.max(mapa.getZoom(), 17));
    avisar('');
  } catch (e) {
    avisar(`Não foi possível obter o GPS: ${e.message}`);
  }
};

// Registrar a casa onde a equipe está (útil na zona rural, sem ver o telhado).
$('#btn-adicionar').onclick = async () => {
  avisar('Obtendo GPS…');
  let pos;
  try {
    pos = await posicaoAtual();
  } catch (e) {
    avisar(`Não foi possível obter o GPS: ${e.message}`);
    return;
  }
  avisar('');
  const ll = mostrarEu(pos);
  mapa.setView(ll, Math.max(mapa.getZoom(), 17));
  abrirFormulario({ ponto: { lat: ll[0], lng: ll[1], precisao: Math.round(pos.coords.accuracy) } });
};

function maisProxima([lat, lng]) {
  let melhor = null, dMin = Infinity;
  for (const c of base.casas) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < dMin) { dMin = d; melhor = c; }
  }
  return melhor;
}

let timerAviso;
function avisar(msg) {
  const el = $('#aviso');
  clearTimeout(timerAviso);
  el.hidden = !msg;
  el.textContent = msg;
  if (msg) timerAviso = setTimeout(() => (el.hidden = true), 3500);
}

iniciar();
