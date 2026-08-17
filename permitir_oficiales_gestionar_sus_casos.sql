-- ============================================================================
-- Hasta ahora solo el admin podía crear/editar casos; cada oficial (viewer)
-- solo podía ver los suyos. Esto cambia el permiso de ESCRITURA para que
-- cada oficial pueda crear y gestionar sus propios casos de principio a fin
-- (Imputación, descargo, Orden de Sanción) -- el admin sigue pudiendo todo,
-- sobre cualquier caso.
--
-- Nota de seguridad: el "with check" exige que el caso que se crea o edita
-- quede con SU PROPIO cip en oficial_constato_cip (o que sea admin) -- así
-- un oficial no puede crear ni modificar un caso a nombre de otro.
-- ============================================================================

drop policy if exists "solo admin crea casos" on public.casos;
create policy "oficiales crean sus propios casos o es admin"
  on public.casos for insert
  to authenticated
  with check (es_admin() or oficial_constato_cip = public.cip_actual());

drop policy if exists "solo admin edita casos" on public.casos;
create policy "oficiales editan sus propios casos o es admin"
  on public.casos for update
  to authenticated
  using (es_admin() or oficial_constato_cip = public.cip_actual())
  with check (es_admin() or oficial_constato_cip = public.cip_actual());

-- Eliminar casos se queda solo para admin (sin cambios) -- no se toca esa
-- política.
