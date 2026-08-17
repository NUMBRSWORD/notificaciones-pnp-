-- ============================================================================
-- Directivas internas, igual que en moral-y-disciplina: aquí el admin registra
-- el texto REAL de directivas vigentes de la PNP (por ejemplo, los requisitos
-- para que un descanso médico particular sea exonerante). La IA que analiza
-- el descargo y redacta la Orden de Sanción usa esto como única fuente de
-- reglas institucionales específicas -- si algo no está aquí, la IA debe
-- decirlo en vez de inventarlo.
-- ============================================================================

create table public.directivas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  numero_documento text,
  contenido text not null,
  archivo_path text,
  archivo_nombre text,
  activa boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.directivas enable row level security;

create policy "directivas_select_authenticated"
  on public.directivas for select
  to authenticated
  using (true);

create policy "directivas_insert_admin"
  on public.directivas for insert
  to authenticated
  with check (es_admin());

create policy "directivas_update_admin"
  on public.directivas for update
  to authenticated
  using (es_admin())
  with check (es_admin());

create policy "directivas_delete_admin"
  on public.directivas for delete
  to authenticated
  using (es_admin());

-- Bucket privado para los archivos (PDF/imagen) de sustento de cada directiva.
insert into storage.buckets (id, name, public)
values ('directivas', 'directivas', false)
on conflict (id) do nothing;

create policy "directivas_storage_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'directivas');

create policy "directivas_storage_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'directivas' and es_admin());

create policy "directivas_storage_update_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'directivas' and es_admin())
  with check (bucket_id = 'directivas' and es_admin());

create policy "directivas_storage_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'directivas' and es_admin());
