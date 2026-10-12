-- Deshace seguridad_claves.sql y deja las funciones como estaban antes.
-- Úselo solo si algo falló tras ejecutarlo.

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

create or replace function public.cip_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid();
$$;

drop function if exists public.restablecer_clave_usuario(text);
drop function if exists public.confirmar_cambio_clave();
drop function if exists public.exigir_cambio_si_clave_inicial();
drop function if exists public.necesita_cambiar_clave();
drop table if exists public.cambios_clave_pendientes;
