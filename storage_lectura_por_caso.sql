-- ============================================================================
-- Archivos de los casos (bucket "casos-imputacion-pnp"): cada usuario solo
-- LEE y SUBE archivos de los casos que le corresponden.
--
-- Antes, cualquier usuario con sesión podía leer/descargar cualquier archivo
-- del bucket (descargos, sustentos, expedientes firmados) y subir archivos a
-- la carpeta de cualquier caso, aunque la app solo le mostrara los suyos.
--
-- Los archivos están en carpetas con el id del caso ("<id del caso>/...").
-- Reglas nuevas:
--   LEER:  el admin; cualquiera los roles de servicio ("roles_servicio/...",
--          los usa la búsqueda del puesto); y los archivos de un caso que el
--          usuario puede ver. "Puede ver" lo decide la misma política de la
--          tabla casos (oficial que constató, investigado o admin), porque la
--          consulta de abajo se hace con los permisos del usuario.
--   SUBIR: el admin; o el oficial que constató el caso, en la carpeta de ese
--          caso. Los roles de servicio solo los sube el admin.
-- Borrar ya quedó restringido en storage_borrado_propio.sql.
--
-- Ejecutar una vez en el SQL Editor. Para deshacerlo:
-- storage_lectura_por_caso-REVERTIR.sql. No borra ni mueve ningún archivo.
-- ============================================================================

drop policy if exists "imputacion_pnp autenticados leen sustento" on storage.objects;
drop policy if exists "imputacion_pnp lee archivos de sus casos" on storage.objects;
create policy "imputacion_pnp lee archivos de sus casos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'casos-imputacion-pnp'
    and (
      public.es_admin()
      or split_part(name, '/', 1) = 'roles_servicio'
      or exists (select 1 from public.casos c where c.id::text = split_part(name, '/', 1))
    )
  );

drop policy if exists "imputacion_pnp autenticados suben sustento" on storage.objects;
drop policy if exists "imputacion_pnp sube a sus casos" on storage.objects;
create policy "imputacion_pnp sube a sus casos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'casos-imputacion-pnp'
    and (
      public.es_admin()
      or exists (
        select 1 from public.casos c
        where c.id::text = split_part(name, '/', 1)
          and c.oficial_constato_cip = public.cip_actual()
      )
    )
  );
