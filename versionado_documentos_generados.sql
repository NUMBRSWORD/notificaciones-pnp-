-- ============================================================================
-- Versionado de documentos generados, igual que en moral-y-disciplina: cada
-- vez que se genera (o regenera) una Imputación, un Acta de No Descargo o una
-- Orden de Sanción, se archiva una copia exacta del .docx en Storage y se
-- deja un registro con quién y cuándo lo generó. Sirve como respaldo si
-- después se corrige un dato y se vuelve a generar el documento.
-- ============================================================================

create table public.documentos_generados (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id) on delete cascade,
  tipo text not null,
  archivo_path text not null,
  archivo_nombre text not null,
  generado_por uuid references auth.users(id),
  generado_por_email text,
  generado_at timestamptz not null default now()
);

create index documentos_generados_caso_id_idx on public.documentos_generados (caso_id);

alter table public.documentos_generados enable row level security;

create policy "ve versiones de sus casos o es admin"
  on public.documentos_generados for select
  to authenticated
  using (
    es_admin() or exists (
      select 1 from public.casos c
      where c.id = documentos_generados.caso_id
        and c.oficial_constato_cip = cip_actual()
    )
  );

create policy "registra versiones de sus casos o es admin"
  on public.documentos_generados for insert
  to authenticated
  with check (
    es_admin() or exists (
      select 1 from public.casos c
      where c.id = documentos_generados.caso_id
        and c.oficial_constato_cip = cip_actual()
    )
  );
