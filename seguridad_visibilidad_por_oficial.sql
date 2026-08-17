-- ============================================================================
-- Cierra el mismo hueco que ya se corrigió en moral-y-disciplina: hoy
-- cualquier usuario autenticado (no solo admin) puede leer TODOS los casos
-- vía la API, sin importar quién los reportó. Con esto, cada oficial solo
-- ve los casos donde él figura como "oficial que constató"; el admin sigue
-- viendo todo. Corre esto entero en el SQL Editor de tu proyecto Supabase.
-- ============================================================================

-- Columna que fija, al crear el caso, el CIP del oficial que consta como
-- "oficial_constato" (resuelto con el mismo emparejamiento difuso que ya usa
-- la app). Es la base para que RLS decida en el servidor quién puede ver
-- cada caso -- ya no depende de que el navegador filtre por su cuenta.
alter table public.casos
  add column if not exists oficial_constato_cip text;

-- CIP del usuario autenticado, derivado de su correo de login
-- ("{cip}@imputacionpnp.local"), para usar en la política de RLS.
create or replace function public.cip_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid();
$$;

drop policy if exists "autenticados ven casos" on public.casos;
create policy "ve casos propios o es admin"
  on public.casos for select
  to authenticated
  using (es_admin() or oficial_constato_cip = public.cip_actual());

-- Nota: los casos que ya hayas creado ANTES de correr esto no tienen
-- oficial_constato_cip -- solo el admin los verá hasta que se corrija ese
-- dato. Si ya tienes casos reales cargados y quieres que también los vea el
-- oficial correspondiente, avísame los CIP y te preparo el UPDATE puntual
-- (igual que hice con las 33 notas de moral-y-disciplina).
