-- ============================================================================
-- Que un oficial pueda BUSCAR a un efectivo por CIP o DNI al crear un caso (y
-- que le funcionen los documentos de sus casos) SIN devolverle el padrón
-- completo. Corre esto ENTERO en el SQL Editor del proyecto Supabase de esta
-- app (el mismo donde corriste roles_cumplimiento_y_padron.sql).
-- ============================================================================
--
-- Síntoma: el usuario escribe un CIP o DNI en "Buscar efectivo por CIP o DNI"
-- y sale "No se encontró ningún efectivo con ese CIP/DNI", pero el
-- administrador sí lo encuentra.
--
-- Causa: roles_cumplimiento_y_padron.sql dejó la lectura de `efectivos` solo
-- para el administrador y para la propia ficha de cada oficial (con razón: el
-- padrón trae DNI de todo el personal, Ley N.° 29733). El botón Buscar solo
-- mira la lista que se cargó al entrar a la app, así que un oficial solo
-- "veía" a una persona: a sí mismo.
--
-- Solución (dos piezas, sin reabrir el padrón):
--   1. buscar_efectivo(): consulta puntual por CIP o DNI EXACTO. Devuelve una
--      sola persona, nunca una lista, y solo a quien es administrador o es un
--      efectivo registrado (una cuenta cualquiera no obtiene nada).
--   2. Cada oficial puede leer también la ficha de los investigados de SUS
--      casos (lo que necesitan sus documentos: Acta de No Descargo, Orden de
--      Sanción), y de nadie más.
--
-- Límite honesto: el CIP del investigado de un caso lo escribe quien crea el
-- caso, así que quien conozca un CIP ajeno podría "abrir" esa ficha creando un
-- caso. Es la misma exposición que buscarla con el CIP exacto (nunca hay
-- forma de listar ni de recorrer el padrón), y cada caso queda a su nombre en
-- el historial de actividad.

-- Columnas que usan las políticas (ya existen si corriste los .sql anteriores).
alter table public.casos add column if not exists oficial_constato_cip text;
alter table public.casos add column if not exists investigado_cip text;

-- 1) Lectura de `efectivos`: administrador, la propia ficha, y los
--    investigados de los casos donde el usuario consta como oficial.
drop policy if exists "autenticados ven efectivos" on public.efectivos;
drop policy if exists "admin ve padrón o usuario ve su propio registro" on public.efectivos;
drop policy if exists "ve su ficha, la de sus investigados o es admin" on public.efectivos;
create policy "ve su ficha, la de sus investigados o es admin" on public.efectivos
  for select to authenticated
  using (
    public.es_admin()
    or cip = split_part(auth.jwt() ->> 'email', '@', 1)
    or exists (
      select 1 from public.casos c
      where c.investigado_cip = efectivos.cip
        and c.oficial_constato_cip = split_part(auth.jwt() ->> 'email', '@', 1)
    )
  );

-- 2) Búsqueda puntual por CIP o DNI exacto (una sola persona, nunca una lista).
create or replace function public.buscar_efectivo(p_q text)
returns table (grado text, apellidos_nombres text, cip text, dni text)
language sql
stable
security definer
set search_path = public
as $$
  select e.grado, e.apellidos_nombres, e.cip, e.dni
  from public.efectivos e
  where btrim(p_q) ~ '^[0-9A-Za-z]{5,12}$'
    and (e.cip = btrim(p_q) or e.dni = btrim(p_q))
    and (
      public.es_admin()
      or exists (
        select 1 from public.efectivos yo
        where yo.cip = split_part(auth.jwt() ->> 'email', '@', 1)
      )
    )
  limit 1;
$$;

revoke all on function public.buscar_efectivo(text) from public, anon;
grant execute on function public.buscar_efectivo(text) to authenticated;

-- Casos creados ANTES de esto por un oficial que no es administrador pueden
-- haber quedado sin investigado_cip (la búsqueda no lo encontraba). Lista para
-- que el administrador los complete a mano (Efectivos → CIP del investigado):
--   select id, grado, apellidos, nombres, oficial_constato_cip
--   from public.casos where investigado_cip is null order by created_at desc;
