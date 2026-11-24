import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import { registerSW } from 'virtual:pwa-register';
import { carregarCasas, carregarEquipes, MODO_DEMO, STATUS } from './config.js';
import {
  contarPendentes, iniciarSincronizacaoAutomatica, salvarCasaNova, salvarVisita, sincronizar, ultimoErro,
} from './store.js';
import {
  criarMapa, dataHora, endereco, esc, estiloMarcador, linkRota, montarEstado, nomeEspecie,
} from './dados.js';

registerSW({ immediate: true });

const $ = (s) => document.querySelector(s);
const CHAVE_EQUIPE = 'mvb-equipe';
const FILTROS = [
  { nome: 'todos os pontos', ok: () => true },
  { nome: 'só casas', ok: (c) => c.especie <= 2 },
  { nome: 'a visitar (cinza e amarelo)', ok: (c) => !c.ultima || c.ultima.status === 'amarelo' },
];

let base, estado, mapa, camada, equipe, marcadorEu;
let selecionada = null;
let filtro = 0;

async function iniciar() {
  const [equipes, casas] = await Promise.all([carregarEquipes(), carregarCasas()]);
  base = casas;
  const salva = localStorage.getItem(CHAVE_EQUIPE);
  equipe = equipes.equipes.find((e) => e.nome === salva)?.nome;
  if (equipe) abrirMapa();
  else mostrarEntrada(equipes);
}

function mostrarEntrada(equipes) {
  $('#tela-entrada').hidden = false;
  $('#tela-mapa').hidden = true;
  $('#sel-equipe').innerHTML = '<option value="">Selecione…</option>' +
    equipes.equipes.map((e) => `<option>${esc(e.nome)}</option>`).join('');
  $('#form-entrada').onsubmit = (ev) => {
    ev.preventDefault();
    const e = equipes.equipes.find((x) => x.nome === $('#sel-equipe').value);
    if (!e || e.codigo.trim().toLowerCase() !== $('#inp-codigo').value.trim().toLowerCase()) {
      $('#erro-entrada').hidden = false;
      return;
    }
    localStorage.setItem(CHAVE_EQUIPE, e.nome);
    equipe = e.nome;
    abrirMapa();
  };
}

async function abrirMapa() {
  $('#tela-entrada').hidden = true;
  $('#tela-mapa').hidden = false;
  $('#nome-equipe').textContent = equipe;
  if (!mapa) {
    mapa = criarMapa('mapa');
    camada = L.layerGroup().addTo(mapa);
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
  camada.clearLayers();
  for (const c of estado.casas) {
    if (!FILTROS[filtro].ok(c) && c.id !== selecionada) continue;
    L.circleMarker([c.lat, c.lng], estiloMarcador(c, c.id === selecionada))
      .on('click', () => abrirCasa(c.id))
      .addTo(camada);
  }
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
  selecionada = null;
  desenhar();
}
$('#folha').addEventListener('click', (ev) => { if (ev.target.id === 'folha') fecharFolha(); });

function historicoHtml(c) {
  if (!c.visitas.length) return '<p class="vazio">Nenhuma visita registrada ainda.</p>';
  return '<ul class="historico">' + [...c.visitas].reverse().map((v) => `
    <li>
      <span class="ponto" style="background:${STATUS[v.status].cor}"></span>
      <div>
        <strong>${esc(STATUS[v.status].curto)}</strong>
        ${v.biblia ? ` · ${v.qtd_biblias} bíblia${v.qtd_biblias > 1 ? 's' : ''}` : ''}
        <div class="meta">${dataHora(v.criado_em)} · ${esc(v.equipe)}${v.pendente && !MODO_DEMO ? ' · <em>pendente</em>' : ''}</div>
        ${v.observacao ? `<div class="obs">${esc(v.observacao)}</div>` : ''}
      </div>
    </li>`).join('') + '</ul>';
}

function abrirCasa(id) {
  const c = estado.porId.get(id);
  if (!c) return;
  selecionada = id;
  desenhar();

  abrirFolha(`
    <button class="fechar" aria-label="Fechar">✕</button>
    <h2>${esc(endereco(c))}</h2>
    <p class="meta">${esc([c.localidade, nomeEspecie(base, c), c.estabelecimento].filter(Boolean).join(' · '))}</p>
    <a class="btn btn-leve btn-bloco" href="${linkRota(c)}" target="_blank" rel="noopener">🧭 Ir até aqui (Google Maps)</a>

    <h3>Como foi a visita?</h3>
    <div class="status-botoes">
      ${Object.entries(STATUS).map(([k, s]) => `
        <button type="button" class="btn-status" data-status="${k}" style="--cor:${s.cor}">
          <span class="ponto" style="background:${s.cor}"></span>${esc(s.nome)}
        </button>`).join('')}
    </div>

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

    <h3>Observação <small>(opcional)</small></h3>
    <textarea id="obs" maxlength="200" rows="2"
      placeholder="Ex.: pediram para voltar à tarde"></textarea>
    <p class="dica">⚠️ Não escreva nomes, telefones ou dados pessoais dos moradores.</p>

    <button id="btn-salvar" class="btn btn-primario btn-grande" disabled>Escolha como foi a visita</button>

    <h3>Histórico desta casa</h3>
    <div id="historico">${historicoHtml(c)}</div>
  `);

  const f = { status: null, biblia: false, qtd: 1 };
  const corpo = $('#folha-corpo');
  const render = () => {
    corpo.querySelectorAll('.btn-status').forEach((b) => b.classList.toggle('ativo', b.dataset.status === f.status));
    corpo.querySelectorAll('[data-biblia]').forEach((b) => b.classList.toggle('ativo', (b.dataset.biblia === '1') === f.biblia));
    $('#contador').classList.toggle('desligado', !f.biblia);
    $('#qtd').textContent = f.qtd;
    const s = $('#btn-salvar');
    s.disabled = !f.status;
    s.textContent = f.status ? 'Salvar visita' : 'Escolha como foi a visita';
  };
  corpo.querySelector('.fechar').onclick = fecharFolha;
  corpo.querySelectorAll('.btn-status').forEach((b) => (b.onclick = () => {
    f.status = b.dataset.status;
    f.biblia = f.status === 'verde';
    render();
  }));
  corpo.querySelectorAll('[data-biblia]').forEach((b) => (b.onclick = () => { f.biblia = b.dataset.biblia === '1'; render(); }));
  corpo.querySelectorAll('[data-qtd]').forEach((b) => (b.onclick = () => {
    if (!f.biblia) return;
    f.qtd = Math.min(20, Math.max(1, f.qtd + Number(b.dataset.qtd)));
    render();
  }));
  $('#btn-salvar').onclick = async () => {
    await salvarVisita({
      casa_id: c.id,
      equipe,
      status: f.status,
      biblia: f.biblia,
      qtd_biblias: f.biblia ? f.qtd : 0,
      observacao: $('#obs').value.trim(),
    });
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
    marcadorEu = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(mapa);
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
  const prox = maisProxima(ll);
  abrirFolha(`
    <button class="fechar" aria-label="Fechar">✕</button>
    <h2>Adicionar casa aqui</h2>
    <p class="meta">Precisão do GPS: ~${Math.round(pos.coords.accuracy)} m${prox ? ` · perto de ${esc(prox.localidade)}` : ''}</p>
    <label>Rua e número ou ponto de referência <small>(opcional)</small>
      <input id="desc-casa" maxlength="120" placeholder="Ex.: Rua das Flores, 120 / casa azul após a ponte" />
    </label>
    <p class="dica">⚠️ Não escreva nomes ou dados pessoais dos moradores.</p>
    <button id="btn-criar" class="btn btn-primario btn-grande">Salvar casa e registrar visita</button>
  `);
  $('#folha-corpo .fechar').onclick = fecharFolha;
  $('#btn-criar').onclick = async () => {
    const nova = await salvarCasaNova({
      lat: +ll[0].toFixed(6),
      lng: +ll[1].toFixed(6),
      precisao_m: Math.round(pos.coords.accuracy),
      descricao: $('#desc-casa').value.trim(),
      localidade: prox?.localidade || '',
      equipe,
    });
    estado = await montarEstado(base);
    abrirCasa(nova.id);
  };
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
