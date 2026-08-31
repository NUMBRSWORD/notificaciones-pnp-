-- ============================================================================
-- Mesa de partes digital: recepción de expedientes cerrados
-- Ejecutar una vez en Supabase SQL Editor.
-- El archivo se guarda en un bucket privado, en una ruta lógica como:
-- expedientes_cerrados/2026/08/2026-08-26 - SOLIS GONZALES.../archivo.pdf
-- ============================================================================

create table if not exists public.expedientes_remitidos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null unique references public.casos(id) on delete cascade,
  investigado_nombre text not null,
  investigado_cip text,
  fecha_hecho date not null,
  codigo_infraccion text,
  remitido_por uuid not null references auth.users(id),
  remitido_por_email text,
  remitido_por_cip text,
  remitido_at timestamptz not null default now(),
  archivo_path text not null,
  archivo_nombre text not null,
  carpeta_archivo text not null,
  estado text not null default 'remitido'
    check (estado in ('remitido', 'recibido', 'observado', 'archivado')),
  observacion text,
  recibido_por uuid references auth.users(id),
  recibido_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.expedientes_remitidos enable row level security;

drop policy if exists "admin ve toda la recepcion" on public.expedientes_remitidos;
create policy "admin ve toda la recepcion"
  on public.expedientes_remitidos for select to authenticated
  using (public.es_admin() or remitido_por = auth.uid());

drop policy if exists "oficial remite su expediente cerrado" on public.expedientes_remitidos;
create policy "oficial remite su expediente cerrado"
  on public.expedientes_remitidos for insert to authenticated
  with check (
    remitido_por = auth.uid()
    and estado = 'remitido'
    and exists (
      select 1 from public.casos c
      where c.id = caso_id
        and (public.es_admin() or c.oficial_constato_cip = public.cip_actual())
        and c.sancion_generada_at is not null
        and c.orden_notificada_at is not null
    )
  );

drop policy if exists "oficial actualiza remision observada" on public.expedientes_remitidos;
create policy "oficial actualiza remision observada"
  on public.expedientes_remitidos for update to authenticated
  using (public.es_admin() or (remitido_por = auth.uid() and estado in ('remitido', 'observado')))
  with check (public.es_admin() or (remitido_por = auth.uid() and estado = 'remitido'));

drop trigger if exists expedientes_remitidos_set_updated_at on public.expedientes_remitidos;
create trigger expedientes_remitidos_set_updated_at
  before update on public.expedientes_remitidos
  for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('expedientes-terminados-pnp', 'expedientes-terminados-pnp', false)
on conflict (id) do nothing;

drop policy if exists "remitentes suben expedientes cerrados" on storage.objects;
create policy "remitentes suben expedientes cerrados"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes-terminados-pnp');

drop policy if exists "autenticados leen expedientes cerrados" on storage.objects;
create policy "autenticados leen expedientes cerrados"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'expedientes-terminados-pnp'
    and exists (
      select 1 from public.expedientes_remitidos e
      where e.archivo_path = name
        and (public.es_admin() or e.remitido_por = auth.uid())
    )
  );
