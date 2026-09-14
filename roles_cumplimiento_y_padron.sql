-- Portación de Roles de Servicio, Cumplimiento y protección del padrón.
-- Ejecutar una sola vez en Supabase SQL Editor. No elimina datos existentes.

alter table public.casos add column if not exists puesto_rol text;

create table if not exists public.roles_servicio (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique,
  fecha_fin date,
  archivo_path text not null,
  archivo_nombre text not null,
  texto_extraido text,
  subido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.roles_servicio enable row level security;
drop policy if exists "autenticados ven roles de servicio" on public.roles_servicio;
create policy "autenticados ven roles de servicio" on public.roles_servicio for select to authenticated using (true);
drop policy if exists "admin administra roles de servicio" on public.roles_servicio;
create policy "admin administra roles de servicio" on public.roles_servicio for all to authenticated using (public.es_admin()) with check (public.es_admin());

create table if not exists public.documentos_institucionales (
  id uuid primary key default gen_random_uuid(),
  titulo text not null unique,
  contenido text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.firmas_documentos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_institucionales(id) on delete cascade,
  documento_version integer not null,
  firmante_id uuid not null references auth.users(id) on delete cascade,
  firmante_nombre text not null,
  firmante_grado text,
  firmante_cargo text not null,
  firmado_at timestamptz not null default now(),
  unique(documento_id, documento_version, firmante_id)
);
alter table public.documentos_institucionales enable row level security;
alter table public.firmas_documentos enable row level security;
drop policy if exists "autenticados leen documentos institucionales" on public.documentos_institucionales;
create policy "autenticados leen documentos institucionales" on public.documentos_institucionales for select to authenticated using (true);
drop policy if exists "admin administra documentos institucionales" on public.documentos_institucionales;
create policy "admin administra documentos institucionales" on public.documentos_institucionales for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists "autenticados leen firmas institucionales" on public.firmas_documentos;
create policy "autenticados leen firmas institucionales" on public.firmas_documentos for select to authenticated using (true);
drop policy if exists "usuario firma por si mismo" on public.firmas_documentos;
create policy "usuario firma por si mismo" on public.firmas_documentos for insert to authenticated with check (firmante_id = auth.uid());

insert into public.documentos_institucionales (titulo, contenido)
values (
  'Uso responsable de la aplicación CPNP Ventanilla',
  'Declaro conocer que esta aplicación es de uso interno. Me comprometo a utilizar la información disciplinaria únicamente para fines funcionales autorizados, verificar los documentos antes de generarlos o registrarlos y no compartir datos personales fuera del procedimiento correspondiente.'
) on conflict (titulo) do nothing;

-- El padrón completo queda reservado para administración. Cada oficial puede
-- consultar solo su propio registro (por CIP del correo técnico de sesión).
drop policy if exists "autenticados ven efectivos" on public.efectivos;
drop policy if exists "admin ve padrón o usuario ve su propio registro" on public.efectivos;
create policy "admin ve padrón o usuario ve su propio registro" on public.efectivos
  for select to authenticated
  using (public.es_admin() or cip = split_part(auth.jwt() ->> 'email', '@', 1));