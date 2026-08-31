-- ============================================================================
-- Notificación de Imputación PNP — script de configuración completo
-- ============================================================================
-- Pégalo entero en el SQL Editor de tu proyecto Supabase NUEVO (Dashboard →
-- SQL Editor → New query) y ejecútalo de una sola vez. Crea las 3 tablas, sus
-- políticas de seguridad (RLS), las funciones/triggers necesarias, y el
-- bucket de almacenamiento para los archivos de sustento — es una copia
-- exacta de lo que ya funciona hoy en el esquema "imputacion_pnp" del
-- proyecto compartido, pero aquí en el esquema "public" de tu proyecto propio
-- (no necesita el paso de "Exposed schemas" del otro proyecto, porque
-- "public" ya está expuesto por defecto).
-- ============================================================================

-- ---------- Tabla: perfiles ----------
-- Un registro por usuario autenticado (creado automáticamente al registrarse
-- vía el trigger más abajo). role: 'admin' puede crear/editar casos y
-- efectivos; 'viewer' solo puede ver.
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

alter table public.perfiles enable row level security;

create policy "usuario ve su propio perfil"
  on public.perfiles for select
  to authenticated
  using (auth.uid() = id);

-- ---------- Tabla: efectivos ----------
create table public.efectivos (
  id uuid primary key default gen_random_uuid(),
  cip text unique,
  dni text unique,
  grado text,
  apellidos_nombres text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.efectivos enable row level security;

create policy "autenticados ven efectivos"
  on public.efectivos for select
  to authenticated
  using (true);

-- ---------- Tabla: casos ----------
create table public.casos (
  id uuid primary key default gen_random_uuid(),
  grado text not null,
  apellidos text not null,
  nombres text not null,
  codigo_infraccion text not null,
  fecha_hecho date not null,
  descripcion_hecho text not null,
  oficial_constato text,
  oficial_cargo text default 'OFICIAL DE PERMANENCIA',
  unidad_investigado text not null default 'DIVOPUS 3-CPNP VENTANILLA.',
  archivo_sustento_path text,
  archivo_sustento_nombre text,
  imputacion_generada_at timestamptz,
  fecha_descargo date,
  numero_descargo text,
  archivo_descargo_path text,
  archivo_descargo_nombre text,
  acta_no_descargo_generada_at timestamptz,
  sancion_generada_at timestamptz,
  sancion_tercio_label text,
  sancion_analisis_texto text,
  sancion_descargo_texto text,
  orden_notificada_at timestamptz,
  archivo_orden_notificacion_path text,
  archivo_orden_notificacion_nombre text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.casos enable row level security;

create policy "autenticados ven casos"
  on public.casos for select
  to authenticated
  using (true);

-- ---------- Función: es_admin() ----------
-- SECURITY DEFINER para poder leer public.perfiles sin quedar bloqueada por
-- su propia política de RLS (que solo deja ver el perfil propio).
create or replace function public.es_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Con es_admin() ya definida, se completan las políticas que dependen de ella.
create policy "admin ve todos los perfiles"
  on public.perfiles for select
  to authenticated
  using (public.es_admin());

create policy "admin cambia el rol de otros usuarios"
  on public.perfiles for update
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy "solo admin crea efectivos"
  on public.efectivos for insert
  to authenticated
  with check (public.es_admin());

create policy "solo admin edita efectivos"
  on public.efectivos for update
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy "solo admin elimina efectivos"
  on public.efectivos for delete
  to authenticated
  using (public.es_admin());

create policy "solo admin crea casos"
  on public.casos for insert
  to authenticated
  with check (public.es_admin());

create policy "solo admin edita casos"
  on public.casos for update
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy "solo admin elimina casos"
  on public.casos for delete
  to authenticated
  using (public.es_admin());

-- ---------- Trigger: crear perfil automáticamente al registrarse ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Trigger: actualizar updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger efectivos_set_updated_at
  before update on public.efectivos
  for each row execute function public.set_updated_at();

create trigger casos_set_updated_at
  before update on public.casos
  for each row execute function public.set_updated_at();

-- ---------- Storage: bucket para archivos de sustento ----------
insert into storage.buckets (id, name, public)
values ('casos-imputacion-pnp', 'casos-imputacion-pnp', false);

create policy "imputacion_pnp autenticados suben sustento"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'casos-imputacion-pnp');

create policy "imputacion_pnp autenticados leen sustento"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'casos-imputacion-pnp');

create policy "imputacion_pnp autenticados eliminan sustento"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'casos-imputacion-pnp');

-- ---------- Mesa de partes: expedientes cerrados ----------
create table public.expedientes_remitidos (
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
  estado text not null default 'remitido' check (estado in ('remitido', 'recibido', 'observado', 'archivado')),
  observacion text,
  recibido_por uuid references auth.users(id),
  recibido_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.expedientes_remitidos enable row level security;
create policy "admin ve toda la recepcion" on public.expedientes_remitidos for select to authenticated using (public.es_admin() or remitido_por = auth.uid());
create policy "oficial remite su expediente cerrado" on public.expedientes_remitidos for insert to authenticated with check (remitido_por = auth.uid() and estado = 'remitido');
create policy "oficial actualiza remision observada" on public.expedientes_remitidos for update to authenticated using (public.es_admin() or (remitido_por = auth.uid() and estado in ('remitido', 'observado'))) with check (public.es_admin() or (remitido_por = auth.uid() and estado = 'remitido'));
create trigger expedientes_remitidos_set_updated_at before update on public.expedientes_remitidos for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('expedientes-terminados-pnp', 'expedientes-terminados-pnp', false);
create policy "remitentes suben expedientes cerrados" on storage.objects for insert to authenticated with check (bucket_id = 'expedientes-terminados-pnp');
create policy "autenticados leen expedientes cerrados" on storage.objects for select to authenticated using (bucket_id = 'expedientes-terminados-pnp' and exists (select 1 from public.expedientes_remitidos e where e.archivo_path = name and (public.es_admin() or e.remitido_por = auth.uid())));

-- ============================================================================
-- Fin. Después de ejecutar esto:
-- 1. Ve a Project Settings → API y copia la "Project URL" y la "anon public" key.
-- 2. Pásamelas (son públicas por diseño, no son secretas) para que actualice
--    config.js y quite el SUPABASE_SCHEMA (aquí ya no hace falta, todo vive
--    en "public").
-- 3. Regístrate en la app con "Regístrese aquí" (nace como "viewer").
-- 4. En Table Editor → perfiles, busca tu fila y cambia role a "admin" a mano.
-- 5. Cierra sesión y vuelve a entrar — ya podrás crear casos y efectivos.
-- ============================================================================
