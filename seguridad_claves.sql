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
--      registro abierto, alguien podía crear "337635@otro-dominio.com" y ver y
--      editar los casos del oficial con CIP 337635. Ahora solo cuentan las
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
