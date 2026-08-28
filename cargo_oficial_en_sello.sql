-- Agrega el cargo que debe aparecer en el sello de la imputación.
-- Ejecútelo una sola vez en Supabase: SQL Editor → New query → Run.
-- Los casos antiguos conservan el cargo estándar para que sigan funcionando.

alter table public.casos
  add column if not exists oficial_cargo text;

update public.casos
set oficial_cargo = 'OFICIAL DE PERMANENCIA'
where oficial_cargo is null or btrim(oficial_cargo) = '';

alter table public.casos
  alter column oficial_cargo set default 'OFICIAL DE PERMANENCIA';
