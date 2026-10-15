-- Deshace storage_lectura_por_caso.sql: vuelven las políticas anteriores, en
-- las que cualquier usuario con sesión leía y subía en todo el bucket.
drop policy if exists "imputacion_pnp lee archivos de sus casos" on storage.objects;
drop policy if exists "imputacion_pnp sube a sus casos" on storage.objects;
drop policy if exists "imputacion_pnp autenticados leen sustento" on storage.objects;
drop policy if exists "imputacion_pnp autenticados suben sustento" on storage.objects;
create policy "imputacion_pnp autenticados leen sustento"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'casos-imputacion-pnp');
create policy "imputacion_pnp autenticados suben sustento"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'casos-imputacion-pnp');
