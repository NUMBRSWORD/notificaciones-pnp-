-- Deshace storage_borrado_propio.sql: vuelve a la política anterior, en la que
-- cualquier usuario con sesión podía borrar cualquier archivo del bucket.
drop policy if exists "imputacion_pnp cada uno borra lo suyo o es admin" on storage.objects;
drop policy if exists "imputacion_pnp autenticados eliminan sustento" on storage.objects;
create policy "imputacion_pnp autenticados eliminan sustento"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'casos-imputacion-pnp');
