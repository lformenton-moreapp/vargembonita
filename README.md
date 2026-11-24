# Missão Vargem Bonita – App de Mapeamento

Web app (PWA, para celular) que mapeia a entrega de bíblias casa a casa em Vargem Bonita (MG), como uma gincana entre equipes.

- **App das equipes** (`/`): mapa de satélite; a equipe **toca no telhado** e o app mostra os endereços do IBGE mais próximos para confirmar qual é (ou registra só pelo local). Só as casas já visitadas aparecem marcadas. Também tem "Ir até aqui" pelo Google Maps, "Casa onde estou (GPS)" e funcionamento sem sinal.
- **Painel da coordenação** (`/painel/`): contadores, mapa geral, placar por equipe, lista de casas amarelas para a rodada de retorno, resumo por localidade e exportação em CSV.

Pins: 🟢 verde = aceitou a bíblia · 🟠 laranja = querem dar continuidade (pede nome e telefone, com autorização) · 🟡 amarelo = tentar novamente · 🔵 azul = comércio/escola (observação) · ⚫ cinza = abandonada/em construção · 🔴 vermelho = não quiseram receber.
O botão "Mostrando: …" alterna entre só as visitadas e todos os endereços do IBGE (cinza = não visitada; anel = comércio, fazenda, igreja, escola…). Endereços no mesmo terreno aparecem como um ponto com número. O fundo começa em satélite (imagens Esri); o botão "Mapa" troca para o mapa de ruas.

## Divisão das áreas entre as equipes

No painel, em **Divisão das áreas**: escolha a equipe e toque nas ruas (cidade) ou comunidades (zona rural) para entregá-las a ela; tocar de novo tira. Com "Selecionar a rua inteira" marcado, um toque pega todos os trechos da rua; desmarcado, vai trecho por trecho (de esquina a esquina). A equipe vê suas ruas destacadas na cor dela ao abrir o app e tem o botão **🎯 Minha área**. As ruas das outras equipes aparecem tracejadas. Ninguém fica bloqueado de registrar fora da própria área.

As áreas são geradas por `npm run dados` (`scripts/gerar-areas.mjs` → `public/data/areas.json`):
- **Ruas**: traçado do OpenStreetMap em `dados-fonte/ruas-osm.geojson` (© colaboradores do OpenStreetMap, licença ODbL), dividido nas esquinas. Cada endereço do IBGE vai para o trecho de rua mais próximo; o trecho é cortado para cobrir só a parte com casas. Hoje: 193 trechos, 1.137 endereços.
- **Comunidades rurais**: endereços longe de qualquer rua, agrupados pela localidade do IBGE. Hoje: 40 comunidades, 745 endereços.

Para atualizar o traçado das ruas, exporte de novo em overpass-turbo.eu (GeoJSON) com a consulta abaixo, substitua `dados-fonte/ruas-osm.geojson` e rode `npm run dados`:

```
[out:json][timeout:60];
(
  way["highway"](-20.3350,-46.3785,-20.3225,-46.3615);
  way["highway"](-20.3755,-46.2850,-20.3650,-46.2725);
);
out geom;
```

## Dados das casas

Os pontos vêm do **CNEFE 2022 do IBGE** (`3170602_VARGEM_BONITA.csv`, na raiz). O script `scripts/gerar-casas.mjs` converte o CSV em `public/data/casas.json` e mostra quantos pontos há por espécie e por localidade:

```bash
npm run dados
```

Resultado atual: **1.882 pontos**, sendo 1.390 domicílios particulares, 266 estabelecimentos agropecuários, 161 de outras finalidades, 31 edificações em construção, 13 domicílios coletivos, 10 religiosos, 6 de ensino e 5 de saúde. Os 1.390 domicílios incluem casas vagas e de uso ocasional; o Censo contou 876 ocupadas. A sede (Centro) concentra 849 pontos.

## Como rodar

Requer Node 20 ou mais novo.

```bash
npm install
```

```bash
npm run dev
```

Abra o endereço mostrado (ex.: `http://localhost:5173`). Com `--host`, o app também abre pelo IP do computador em celulares na mesma rede Wi-Fi.

Para testar a versão final (com modo offline):

```bash
npm run build && npm run preview
```

### Modo demonstração

Sem as variáveis do Supabase, o app funciona em **modo demonstração**: tudo fica guardado no navegador do aparelho. No painel aparecem os botões "Preencher com visitas de exemplo" e "Apagar todos os dados", úteis para apresentar aos parceiros. O app e o painel precisam estar abertos no mesmo navegador para enxergar os mesmos dados.

## Equipes e códigos

Edite `public/equipes.json`:

```json
{
  "coordenacao": "painel2026",
  "equipes": [
    { "nome": "Azul", "codigo": "azul123", "cor": "#2563eb" }
  ]
}
```

- `coordenacao`: código de acesso ao painel.
- `equipes`: nome, código e cor de cada equipe (no código, maiúsculas e minúsculas são indiferentes).

Depois de editar, publique de novo. **Troque os códigos de exemplo antes da missão.** Os códigos servem para organizar as equipes, não como senha forte: quem abrir o arquivo `equipes.json` no navegador consegue lê-los. Não use o nome da equipe como chave depois de a missão começar, porque o placar agrupa as visitas pelo nome.

## Configurar o Supabase (sincronizar entre celulares)

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. Abra `supabase/schema.sql`, troque `TROQUE-ESTE-CODIGO` (no fim do arquivo) pelo código da coordenação e, em **SQL Editor**, cole e rode o conteúdo. Ele cria as tabelas `visitas`, `casas_novas` e `contatos`. Visitas e pontos podem ser lidos e inseridos, mas não alterados ou apagados. Os contatos (nome e telefone do pin laranja) só podem ser inseridos pelas equipes; o painel os lê com o código da coordenação, e o celular apaga sua cópia assim que envia.
3. Em **Project Settings › API**, copie a *Project URL* e a chave *anon public*.
4. Crie `.env.local` a partir de `.env.example`:

   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
   ```

5. Rode `npm run build` (ou `npm run dev`). O aviso "Modo demonstração" some e a barra passa a mostrar "✓ Tudo enviado" ou "⏳ N pendentes de envio".

Cada visita é gravada primeiro no celular (IndexedDB) e enviada quando há internet. O app tenta enviar a cada 30 segundos, ao voltar o sinal e ao reabrir. Tocar no indicador força o envio. Para corrigir uma visita registrada errado, apague a linha em **Table Editor** no Supabase.

## Publicar na Vercel

1. Envie o repositório para o GitHub.
2. Em [vercel.com](https://vercel.com) › **Add New › Project**, importe o repositório. A Vercel detecta o Vite sozinha (build `npm run build`, pasta `dist`).
3. Em **Settings › Environment Variables**, cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` e faça um novo deploy.
4. Compartilhe o link com as equipes. No Android (Chrome), use "Adicionar à tela inicial" ou "Instalar app". No iPhone (Safari), use Compartilhar › "Adicionar à Tela de Início".

O Netlify também funciona com as mesmas configurações.

## Uso sem sinal (importante para a zona rural)

- **Abra o app pelo menos uma vez com internet** em cada celular antes de ir a campo. Assim o app e os dados das casas ficam guardados.
- O mapa de fundo (OpenStreetMap) só fica disponível offline nas áreas que já foram vistas com internet. Antes de sair, passeie pelo mapa da região da equipe nos níveis de zoom que vai usar. Os pontos das casas aparecem mesmo sem o mapa de fundo.
- "Ir até aqui" abre o Google Maps, que precisa de sinal ou de mapa baixado no próprio Google Maps ("Mapas off-line").

## Dados pessoais (LGPD)

O app registra o local e o resultado da visita. Nome e telefone só são guardados no pin laranja, quando a pessoa autoriza (caixa de autorização obrigatória), e só a coordenação os vê. O campo de observação avisa para não escrever nomes, telefones ou detalhes pessoais dos moradores. Oriente as equipes no treinamento.

## Estrutura

```
3170602_VARGEM_BONITA.csv   CSV original do CNEFE 2022 (IBGE)
scripts/gerar-casas.mjs     CSV → public/data/casas.json
public/data/casas.json      pontos usados pelo app
public/equipes.json         equipes e códigos
index.html, src/app.js      app das equipes
painel/index.html, src/painel.js   painel da coordenação
src/store.js                IndexedDB + sincronização com Supabase
src/dados.js, src/config.js funções e configurações compartilhadas
supabase/schema.sql         tabelas do banco
```
