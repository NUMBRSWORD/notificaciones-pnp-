-- ============================================================================
-- Archivos de los casos (bucket "casos-imputacion-pnp"): cada usuario solo
-- puede BORRAR los archivos que él mismo subió; el administrador, cualquiera.
--
-- Antes, la política "imputacion_pnp autenticados eliminan sustento" dejaba a
-- cualquier usuario con sesión borrar cualquier archivo del bucket (descargos,
-- expedientes firmados, sustentos, roles de servicio y las copias de los
-- documentos generados).
--
-- Supabase guarda en storage.objects.owner_id el usuario que subió cada
-- archivo. Ejecutar una vez en el SQL Editor; para deshacerlo:
-- storage_borrado_propio-REVERTIR.sql. No borra ni mueve ningún archivo.
-- ============================================================================

drop policy if exists "imputacion_pnp autenticados eliminan sustento" on storage.objects;
drop policy if exists "imputacion_pnp cada uno borra lo suyo o es admin" on storage.objects;

create policy "imputacion_pnp cada uno borra lo suyo o es admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'casos-imputacion-pnp'
    and (owner_id = (select auth.uid())::text or public.es_admin())
  );
