-- Missão Vargem Bonita: tabelas para sincronizar as visitas entre celulares.
-- Cole no Supabase: SQL Editor > New query > Run.

create table if not exists public.visitas (
  id           uuid primary key,
  casa_id      text not null,             -- COD_UNICO_ENDERECO do CNEFE ou id de casa_novas
  equipe       text not null,
  status       text not null check (status in ('verde', 'amarelo', 'vermelho')),
  biblia       boolean not null default false,
  qtd_biblias  integer not null default 0 check (qtd_biblias between 0 and 20),
  observacao   text check (char_length(observacao) <= 200),
  criado_em    timestamptz not null,      -- horário no celular (vale offline)
  recebido_em  timestamptz not null default now()
);
create index if not exists visitas_casa_idx on public.visitas (casa_id);

create table if not exists public.casas_novas (
  id           uuid primary key,
  lat          double precision not null,
  lng          double precision not null,
  precisao_m   integer,
  descricao    text check (char_length(descricao) <= 120),
  localidade   text,
  equipe       text not null,
  criado_em    timestamptz not null,
  recebido_em  timestamptz not null default now()
);

-- Segurança: com a chave pública (anon) é possível LER e INSERIR,
-- mas não alterar nem apagar. Correções são feitas pela coordenação
-- direto no painel do Supabase (Table Editor).
alter table public.visitas enable row level security;
alter table public.casas_novas enable row level security;

drop policy if exists "ler visitas" on public.visitas;
drop policy if exists "inserir visitas" on public.visitas;
drop policy if exists "ler casas novas" on public.casas_novas;
drop policy if exists "inserir casas novas" on public.casas_novas;

create policy "ler visitas"         on public.visitas     for select to anon using (true);
create policy "inserir visitas"     on public.visitas     for insert to anon with check (true);
create policy "ler casas novas"     on public.casas_novas for select to anon using (true);
create policy "inserir casas novas" on public.casas_novas for insert to anon with check (true);
