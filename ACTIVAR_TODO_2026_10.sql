-- ============================================================================
-- ACTIVAR TODO (octubre 2026): los 4 SQL de la portación en un solo archivo.
-- Pegue TODO este archivo en Supabase -> SQL Editor -> New query -> Run.
-- Es aditivo (no borra casos, efectivos ni documentos) y se puede ejecutar
-- más de una vez sin problema. Contiene, en este orden:
--   1. seguridad_claves.sql       2. archivo_procedimiento.sql
--   3. registro_de_errores.sql    4. oficio_remision.sql
-- Se genera con scripts/unir-sql.mjs; no lo edite a mano.
-- ============================================================================

-- ######################## seguridad_claves.sql ########################

-- ============================================================================
-- Seguridad de las claves y del CIP de cada cuenta (portado de
-- moral-y-disciplina, auditoría del 21-sep-2026, y adaptado a "perfiles" y a
-- las cuentas "{cip}@imputacionpnp.local").
--
-- Ejecutar UNA vez en el SQL Editor del proyecto de Notificaciones PNP. Es
-- aditivo: no borra casos, efectivos ni documentos. Para deshacerlo, ejecutar
-- seguridad_claves-REVERTIR.sql.
--
-- Qué arregla:
--   1. cip_actual() tomaba lo que va antes de "@" de CUALQUIER correo. Con el
--      registro abierto, alguien podía crear "400005@otro-dominio.com" y ver y
--      editar los casos del oficial con CIP 400005. Ahora solo cuentan las
--      cuentas internas "@imputacionpnp.local".
--   2. Clave inicial (= CIP): la cuenta queda marcada y no accede a nada hasta
--      que la cambie. Lo exige el SERVIDOR, no solo la ventana del navegador.
--   3. Un administrador puede restablecer la clave de quien la olvidó: se
--      genera una clave temporal y se le obliga a cambiarla al ingresar.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Cambio de clave pendiente ----------
create table if not exists public.cambios_clave_pendientes (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  hash_al_marcar text not null,
  marcado_at     timestamptz not null default now()
);
alter table public.cambios_clave_pendientes enable row level security;
revoke all on public.cambios_clave_pendientes from anon, authenticated;
comment on table public.cambios_clave_pendientes is
  'Cuentas que deben cambiar su clave antes de operar. Sin políticas RLS: solo la leen las funciones SECURITY DEFINER.';

create or replace function public.necesita_cambiar_clave()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.cambios_clave_pendientes where user_id = auth.uid());
$$;

-- Mismas reglas de antes, más: una cuenta con cambio de clave pendiente no es
-- admin ni tiene CIP hasta que la cambie (todas las políticas RLS dependen de
-- estas dos funciones, así que la cuenta no ve ni modifica nada).
create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and role = 'admin'
  ) and not public.necesita_cambiar_clave();
$$;

create or replace function public.cip_actual()
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when public.necesita_cambiar_clave() then null
    when lower(split_part(u.email, '@', 2)) = 'imputacionpnp.local'
     and split_part(u.email, '@', 1) ~ '^\d+$'
      then split_part(u.email, '@', 1)
    else null
  end
  from auth.users u
  where u.id = auth.uid();
$$;

-- El navegador la llama tras cada ingreso: si la clave es igual al CIP, la
-- cuenta queda marcada.
create or replace function public.exigir_cambio_si_clave_inicial()
returns boolean
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
  v_hash  text;
begin
  select email, encrypted_password into v_email, v_hash from auth.users where id = auth.uid();
  if v_email is null or v_hash is null then return false; end if;
  if extensions.crypt(split_part(v_email, '@', 1), v_hash) = v_hash then
    insert into public.cambios_clave_pendientes (user_id, hash_al_marcar)
    values (auth.uid(), v_hash)
    on conflict (user_id) do update set hash_al_marcar = excluded.hash_al_marcar, marcado_at = now();
    return true;
  end if;
  return false;
end;
$$;

-- Levanta la marca solo si la clave cambió de verdad y ya no es el CIP.
create or replace function public.confirmar_cambio_clave()
returns boolean
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_marca text;
  v_email text;
  v_hash  text;
begin
  select hash_al_marcar into v_marca from public.cambios_clave_pendientes where user_id = auth.uid();
  if v_marca is null then return true; end if;
  select email, encrypted_password into v_email, v_hash from auth.users where id = auth.uid();
  if v_hash is null or v_hash = v_marca then return false; end if;
  if extensions.crypt(split_part(v_email, '@', 1), v_hash) = v_hash then return false; end if;
  delete from public.cambios_clave_pendientes where user_id = auth.uid();
  return true;
end;
$$;

-- ---------- Restablecer la clave de un usuario (solo administrador) ----------
-- Las cuentas "{cip}@imputacionpnp.local" no tienen buzón real: la clave
-- temporal la genera un administrador y se entrega en persona.
--   - Solo cuentas internas con rol viewer: la de otro administrador se
--     restablece desde Supabase, para que un admin no tome la cuenta de otro.
--   - Se cierran las sesiones abiertas de esa cuenta.
--   - Queda en el historial (sin la clave).
create or replace function public.restablecer_clave_usuario(p_cip text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_cip    text := btrim(coalesce(p_cip, ''));
  v_user   uuid;
  v_rol    text;
  v_letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- sin 0/O, 1/I/L
  v_bytes  bytea := extensions.gen_random_bytes(8);
  v_clave  text := '';
  v_hash   text;
  v_email  text;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede restablecer claves' using errcode = '42501';
  end if;
  if v_cip !~ '^\d{4,10}$' then
    raise exception 'Escriba un CIP válido (solo números)' using errcode = '22023';
  end if;

  select u.id, coalesce(p.role, 'viewer') into v_user, v_rol
    from auth.users u
    left join public.perfiles p on p.id = u.id
   where lower(u.email) = v_cip || '@imputacionpnp.local';

  if v_user is null then
    raise exception 'No hay una cuenta con el CIP %', v_cip using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'Para su propia cuenta use «Cambiar clave»' using errcode = '22023';
  end if;
  if v_rol = 'admin' then
    raise exception 'La clave de un administrador solo se restablece desde Supabase' using errcode = '42501';
  end if;

  for i in 0..7 loop
    v_clave := v_clave || substr(v_letras, (get_byte(v_bytes, i) % length(v_letras)) + 1, 1);
    if i = 3 then v_clave := v_clave || '-'; end if;
  end loop;
  v_hash := extensions.crypt(v_clave, extensions.gen_salt('bf', 10));

  update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_user;

  insert into public.cambios_clave_pendientes (user_id, hash_al_marcar)
  values (v_user, v_hash)
  on conflict (user_id) do update set hash_al_marcar = excluded.hash_al_marcar, marcado_at = now();

  delete from auth.sessions where user_id = v_user;  -- los refresh_tokens caen en cascada

  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_log (table_name, record_id, action, changed_by, changed_by_email, new_data)
  values ('auth.users', v_user, 'UPDATE', auth.uid(), v_email,
          jsonb_build_object('evento', 'clave_restablecida', 'cip', v_cip));

  return v_clave;
end;
$$;

revoke all on function public.necesita_cambiar_clave()           from public, anon;
revoke all on function public.exigir_cambio_si_clave_inicial()   from public, anon;
revoke all on function public.confirmar_cambio_clave()           from public, anon;
revoke all on function public.restablecer_clave_usuario(text)    from public, anon;
grant execute on function public.necesita_cambiar_clave()          to authenticated;
grant execute on function public.exigir_cambio_si_clave_inicial()  to authenticated;
grant execute on function public.confirmar_cambio_clave()          to authenticated;
grant execute on function public.restablecer_clave_usuario(text)   to authenticated;
-- es_admin() y cip_actual() conservan sus permisos: CREATE OR REPLACE no los cambia.

-- ######################## archivo_procedimiento.sql ########################

-- Archivo del Procedimiento: cierre de una infracción leve sin sanción.
-- Ejecutar una sola vez en Supabase SQL Editor. No elimina datos existentes.
alter table public.casos add column if not exists archivo_procedimiento_generado_at timestamptz;
alter table public.casos add column if not exists archivo_procedimiento_motivo text;
alter table public.casos add column if not exists archivo_procedimiento_resolucion_numero text;
alter table public.casos add column if not exists archivo_procedimiento_correlativo integer;

create index if not exists casos_archivo_procedimiento_idx
  on public.casos (archivo_procedimiento_generado_at)
  where archivo_procedimiento_generado_at is not null;
-- El contador se reinicia cada año: lo único es el número completo (incluye el
-- año), no el correlativo solo. Con un índice sobre el correlativo, el primer
-- Archivo de 2027 (N.º 001) chocaría con el N.º 001 de 2026.
drop index if exists public.casos_archivo_procedimiento_correlativo_unico;
create unique index if not exists casos_archivo_procedimiento_numero_unico
  on public.casos (archivo_procedimiento_resolucion_numero)
  where archivo_procedimiento_resolucion_numero is not null;

-- Un solo contador por año para todos los oficiales de la aplicación.
create table if not exists public.correlativos_documentos (
  clave text primary key,
  ultimo_numero integer not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);
alter table public.correlativos_documentos enable row level security;

-- La función bloquea el expediente mientras asigna el número. Si el mismo caso
-- se intenta generar otra vez, devuelve su número reservado y no incrementa el contador.
drop function if exists public.reservar_correlativo_archivo_procedimiento(integer);
create or replace function public.reservar_correlativo_archivo_procedimiento(
  p_caso_id uuid,
  p_anio integer default extract(year from now())::integer
)
returns table(correlativo integer, resolucion_numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correlativo integer;
  v_numero text;
  v_cip text;
  v_sancion timestamptz;
  v_descargo date;
begin
  if p_anio < 2020 or p_anio > 2100 then
    raise exception 'Año de correlativo no válido';
  end if;

  select archivo_procedimiento_correlativo, archivo_procedimiento_resolucion_numero,
         oficial_constato_cip, sancion_generada_at, fecha_descargo
    into v_correlativo, v_numero, v_cip, v_sancion, v_descargo
    from public.casos
   where id = p_caso_id
   for update;

  if not found then
    raise exception 'No se encontró el caso solicitado';
  end if;

  -- La función corre con permisos elevados: debe exigir lo mismo que RLS
  -- (admin o el oficial dueño del caso) para que nadie reserve números ni
  -- modifique casos ajenos.
  -- coalesce: sin CIP la comparación da NULL, y "if not (false or null)" no
  -- entra al if (dejaría pasar a cualquiera sin CIP).
  if not (public.es_admin() or coalesce(v_cip = public.cip_actual(), false)) then
    raise exception 'No tiene permiso para archivar este caso';
  end if;
  if v_sancion is not null then
    raise exception 'El caso ya tiene Orden de Sanción; no corresponde archivarlo';
  end if;
  if v_descargo is null then
    raise exception 'Primero registre el descargo que será evaluado';
  end if;

  -- Una segunda descarga o reintento conserva el número que ya recibió el caso.
  if v_correlativo is not null then
    v_numero := coalesce(v_numero, 'N.º ' || lpad(v_correlativo::text, 3, '0') || '-' || p_anio::text || '-COMVENT-A');
    update public.casos
       set archivo_procedimiento_resolucion_numero = v_numero
     where id = p_caso_id
       and archivo_procedimiento_resolucion_numero is null;
    return query select v_correlativo, v_numero;
    return;
  end if;

  insert into public.correlativos_documentos (clave, ultimo_numero)
  values ('archivo-procedimiento:' || p_anio::text, 1)
  on conflict (clave) do update
    set ultimo_numero = public.correlativos_documentos.ultimo_numero + 1,
        updated_at = now()
  returning ultimo_numero into v_correlativo;

  v_numero := 'N.º ' || lpad(v_correlativo::text, 3, '0') || '-' || p_anio::text || '-COMVENT-A';
  update public.casos
     set archivo_procedimiento_correlativo = v_correlativo,
         archivo_procedimiento_resolucion_numero = v_numero
   where id = p_caso_id;

  return query select v_correlativo, v_numero;
end;
$$;

revoke all on table public.correlativos_documentos from anon, authenticated;
revoke all on function public.reservar_correlativo_archivo_procedimiento(uuid, integer) from public;
grant execute on function public.reservar_correlativo_archivo_procedimiento(uuid, integer) to authenticated;

-- ######################## registro_de_errores.sql ########################

-- Registro de errores de la web y de la app (para enterarse cuando algo falla).
--
-- Antes, si a un usuario le salía un error, nadie se enteraba salvo que lo contara.
-- Ahora la página manda cada error (fallo de programa, aviso de error mostrado,
-- bloqueo de la política de seguridad) a registrar_error_app() y el administrador
-- los ve en Historial.
--
-- Cuidados:
--   - Solo cuentas con sesión; nadie escribe la tabla directamente.
--   - El mismo error de la misma persona en el mismo día suma «veces» en vez de
--     repetir filas, y hay un tope de 100 errores distintos por persona y día.
--   - Textos recortados; se guardan 30 días (se borran solos al registrar).
--   - Solo el administrador puede leerlos (pueden mencionar datos de un caso).
-- Ejecutar una vez en el SQL Editor de Supabase. Reversión: registro_de_errores-REVERTIR.sql

create table if not exists public.errores_app (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dia         date not null,
  firma       text not null,
  tipo        text not null check (tipo in ('error', 'promesa', 'aviso', 'csp')),
  mensaje     text not null,
  origen      text,
  ruta        text,
  version     text,
  agente      text,
  veces       integer not null default 1,
  primero_at  timestamptz not null default now(),
  ultimo_at   timestamptz not null default now(),
  unique (user_id, dia, firma)
);
create index if not exists errores_app_ultimo_idx on public.errores_app (ultimo_at desc);
create index if not exists errores_app_dia_idx on public.errores_app (dia);

alter table public.errores_app enable row level security;
revoke all on public.errores_app from anon, authenticated;
grant select on public.errores_app to authenticated;
drop policy if exists "solo admin lee los errores" on public.errores_app;
create policy "solo admin lee los errores" on public.errores_app
  for select to authenticated using (public.es_admin());

create or replace function public.registrar_error_app(
  p_tipo text, p_mensaje text, p_origen text default null, p_ruta text default null,
  p_version text default null, p_agente text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid := auth.uid();
  v_dia     date := (now() at time zone 'America/Lima')::date;
  v_tipo    text := case when p_tipo in ('error', 'promesa', 'aviso', 'csp') then p_tipo else 'error' end;
  v_mensaje text := left(coalesce(nullif(btrim(p_mensaje), ''), '(sin mensaje)'), 500);
  v_origen  text := left(nullif(btrim(p_origen), ''), 200);
  v_firma   text;
begin
  if v_user is null then return; end if;
  v_firma := md5(v_tipo || '|' || v_mensaje || '|' || coalesce(v_origen, ''));

  update public.errores_app
     set veces = veces + 1, ultimo_at = now()
   where user_id = v_user and dia = v_dia and firma = v_firma;
  if found then return; end if;

  if (select count(*) from public.errores_app where user_id = v_user and dia = v_dia) >= 100 then
    return;
  end if;

  insert into public.errores_app (user_id, dia, firma, tipo, mensaje, origen, ruta, version, agente)
  values (v_user, v_dia, v_firma, v_tipo, v_mensaje, v_origen,
          left(nullif(btrim(p_ruta), ''), 200), left(nullif(btrim(p_version), ''), 60),
          left(nullif(btrim(p_agente), ''), 160))
  on conflict (user_id, dia, firma) do update set veces = public.errores_app.veces + 1, ultimo_at = now();

  delete from public.errores_app where dia < v_dia - 30;
end;
$$;

revoke all on function public.registrar_error_app(text, text, text, text, text, text) from public, anon;
grant execute on function public.registrar_error_app(text, text, text, text, text, text) to authenticated;

-- ######################## oficio_remision.sql ########################

-- Oficio de remisión: el número de oficio con el que se remite el expediente
-- queda en el caso, para no repetirlo entre casos ni perderlo.
-- Ejecutar una vez en el SQL Editor de Supabase. Es aditivo: no borra datos.
-- Sin este SQL el oficio se genera igual, pero su número no se guarda ni se
-- comprueba que no se repita.
alter table public.casos add column if not exists oficio_remision_numero text;

-- Dos expedientes con el mismo número de oficio se confunden en el archivo.
create unique index if not exists casos_oficio_remision_numero_unico
  on public.casos (oficio_remision_numero)
  where oficio_remision_numero is not null;
