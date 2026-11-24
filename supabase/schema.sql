-- Missão Vargem Bonita: tabelas para sincronizar as visitas entre celulares.
-- Cole no Supabase: SQL Editor > New query > Run.
-- O código da coordenação (no fim do arquivo) precisa ser o mesmo de
-- public/equipes.json. Se trocar a senha do painel, troque nos dois lugares.

create table if not exists public.visitas (
  id           uuid primary key,
  casa_id      text not null,             -- id do ponto (casas_novas) ou COD_UNICO_ENDERECO do CNEFE
  equipe       text not null,
  status       text not null check (status in ('verde', 'laranja', 'amarelo', 'azul', 'cinza', 'vermelho')),
  biblia       boolean not null default false,
  qtd_biblias  integer not null default 0 check (qtd_biblias between 0 and 20),
  observacao   text check (char_length(observacao) <= 200),
  tem_contato  boolean not null default false,
  criado_em    timestamptz not null,      -- horário no celular (vale offline)
  recebido_em  timestamptz not null default now()
);
create index if not exists visitas_casa_idx on public.visitas (casa_id);
create index if not exists visitas_recebido_idx on public.visitas (recebido_em);

-- Pontos marcados pelas equipes (toque no telhado ou GPS).
create table if not exists public.casas_novas (
  id           uuid primary key,
  lat          double precision not null,
  lng          double precision not null,
  precisao_m   integer,
  descricao    text check (char_length(descricao) <= 160),
  cnefe_id     text,                      -- endereço do IBGE mais próximo (aproximado)
  localidade   text,
  equipe       text not null,
  criado_em    timestamptz not null,
  recebido_em  timestamptz not null default now()
);

create index if not exists casas_novas_recebido_idx on public.casas_novas (recebido_em);

-- Nome e telefone de quem quer continuidade (pin laranja). Dado pessoal:
-- as equipes só conseguem INSERIR; a leitura é só pela função abaixo,
-- que exige o código da coordenação.
create table if not exists public.contatos (
  id             uuid primary key,
  visita_id      uuid,
  casa_id        text,
  equipe         text not null,
  nome           text check (char_length(nome) <= 80),
  telefone       text check (char_length(telefone) <= 20),
  consentimento  boolean not null check (consentimento),
  criado_em      timestamptz not null,
  recebido_em    timestamptz not null default now()
);

-- Divisão das áreas: qual equipe cuida de cada quarteirão / comunidade.
create table if not exists public.atribuicoes (
  quarteirao_id  text primary key,
  equipe         text not null,
  atualizado_em  timestamptz not null default now()
);

-- Configuração privada (ninguém lê pela chave pública).
create table if not exists public.config (
  chave  text primary key,
  valor  text not null
);

-- Segurança: com a chave pública (anon) é possível LER e INSERIR visitas e
-- pontos, e só INSERIR contatos. Ninguém altera nem apaga pela internet;
-- correções são feitas pela coordenação no Table Editor do Supabase.
alter table public.visitas enable row level security;
alter table public.casas_novas enable row level security;
alter table public.contatos enable row level security;
alter table public.config enable row level security;
alter table public.atribuicoes enable row level security;

drop policy if exists "ler visitas" on public.visitas;
drop policy if exists "inserir visitas" on public.visitas;
drop policy if exists "ler casas novas" on public.casas_novas;
drop policy if exists "inserir casas novas" on public.casas_novas;
drop policy if exists "inserir contatos" on public.contatos;
drop policy if exists "ler atribuicoes" on public.atribuicoes;

create policy "ler visitas"         on public.visitas     for select to anon using (true);
create policy "inserir visitas"     on public.visitas     for insert to anon with check (true);
create policy "ler casas novas"     on public.casas_novas for select to anon using (true);
create policy "inserir casas novas" on public.casas_novas for insert to anon with check (true);
create policy "inserir contatos"    on public.contatos    for insert to anon with check (true);
create policy "ler atribuicoes"     on public.atribuicoes for select to anon using (true);

-- Só a coordenação (com o código) muda a divisão das áreas.
create or replace function public.atribuir_quarteirao(codigo text, quarteirao text, equipe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.config where chave = 'codigo_coordenacao' and lower(valor) = lower(trim(codigo))) then
    raise exception 'Código da coordenação incorreto';
  end if;
  if equipe is null then
    delete from public.atribuicoes where quarteirao_id = quarteirao;
  else
    insert into public.atribuicoes (quarteirao_id, equipe, atualizado_em) values (quarteirao, equipe, now())
    on conflict (quarteirao_id) do update set equipe = excluded.equipe, atualizado_em = now();
  end if;
end;
$$;
revoke all on function public.atribuir_quarteirao(text, text, text) from public, authenticated;
grant execute on function public.atribuir_quarteirao(text, text, text) to anon;

-- Permissões da chave pública (o RLS acima decide quais linhas).
-- Primeiro tira tudo (o Supabase dá acesso amplo por padrão), depois dá só o necessário.
revoke all on public.visitas, public.casas_novas, public.contatos, public.atribuicoes, public.config from anon, authenticated;
grant usage on schema public to anon;
grant select, insert on public.visitas to anon;
grant select, insert on public.casas_novas to anon;
grant insert on public.contatos to anon;   -- só inserir: nenhuma leitura
grant select on public.atribuicoes to anon;
revoke all on public.config from anon;

-- Leitura dos contatos pelo painel: só com o código da coordenação.
create or replace function public.contatos_coordenacao(codigo text)
returns setof public.contatos
language sql
security definer
set search_path = public
as $$
  select c.* from public.contatos c
  where exists (
    select 1 from public.config
    where chave = 'codigo_coordenacao' and lower(valor) = lower(trim(codigo))
  )
  order by c.criado_em desc;
$$;
revoke all on function public.contatos_coordenacao(text) from public, authenticated;
grant execute on function public.contatos_coordenacao(text) to anon;

insert into public.config (chave, valor) values ('codigo_coordenacao', 'painel2026')
on conflict (chave) do update set valor = excluded.valor;
